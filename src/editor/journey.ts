import { mdToHtml } from "../md";
import type { Marker } from '../types';
import { liveMarkers, note, state } from '../store';
import { esc, toast } from '../util';

// Plain Markdown keeps these entries readable in exports, older clients and sync merges.
export const LOST = '◌ Lost me here';
const THEN = '**I thought**\n', NOW = '\n\n**Now I understand**\n';
const drafts = new Map<string, {before:string;after:string}>();
export function journeyHTML(m: Marker) {
  const d = drafts.get(m.id) || {before:'',after:''};
  const entries = m.thread.filter(t => t.text === LOST || (t.role === 'self' && t.text.startsWith(THEN)));
  return `<section class="journey"><h3>Watch your thinking change.</h3><p class="sub">Keep the wrong turn. It makes the breakthrough useful.</p>
    <div class="thoughttrail">${entries.map(t => {
      if (t.text === LOST) return `<article class="thoughtlost"><span>◌</span><div><b>Lost me here</b><small>${esc(new Date(t.at).toLocaleString())}</small></div></article>`;
      const parts=t.text.slice(THEN.length).split(NOW);
      return `<article class="thoughtshift"><small>${esc(new Date(t.at).toLocaleString())}</small><div class="thoughtpair"><div><label>I thought</label><p>${esc(parts[0])}</p></div><span aria-hidden="true">↝</span><div><label>Now I understand</label><p>${esc(parts.slice(1).join(NOW))}</p></div></div></article>`;
    }).join('') || '<p class="wsnote">No breakthroughs yet. Start with what feels uncertain.</p>'}</div>
    <form id="journeyForm"><label>I originally thought<textarea id="thoughtBefore" maxlength="3000" required placeholder="The idea I had…">${esc(d.before)}</textarea></label><label>Now I understand<textarea id="thoughtAfter" maxlength="3000" required placeholder="What changed, and why…">${esc(d.after)}</textarea></label><button class="btn1">Save breakthrough ↝</button><p class="sub">Saved in this marker. Mastery still comes from recall.</p></form></section>`;
}
export function bindJourney(root: HTMLElement, m: Marker, save: (patch: Partial<Marker>)=>Promise<void>) {
  const form=root.querySelector<HTMLFormElement>('#journeyForm'); if(!form)return;
  const before=form.querySelector<HTMLTextAreaElement>('#thoughtBefore')!,after=form.querySelector<HTMLTextAreaElement>('#thoughtAfter')!;
  before.oninput=after.oninput=()=>{
    drafts.set(m.id,{before:before.value,after:after.value});
    const status=root.querySelector('.saved'); if(status)status.textContent='Draft · save your breakthrough to keep it';
  };
  if(before.value || after.value) { const status=root.querySelector('.saved'); if(status)status.textContent='Draft · save your breakthrough to keep it'; }
  form.onsubmit=async e=>{
    e.preventDefault(); if(!before.value.trim()||!after.value.trim())return;
    const button=form.querySelector('button')!; button.disabled=true;
    const latest=state.markers.get(m.id); if(!latest||latest.deleted)return;
    try {
      const text=THEN+before.value.trim()+NOW+after.value.trim();
      drafts.delete(m.id);
      await save({thread:[...latest.thread,{role:'self',text,at:Date.now()}]});
      toast('Breakthrough saved. Your earlier thinking stays with it.');
    } catch { drafts.set(m.id,{before:before.value,after:after.value}); button.disabled=false; toast('Could not save. Your writing is still here.'); }
  };
}
let comparison: HTMLElement|null=null;
export function closeComparison(){comparison?.remove();comparison=null;}
export function compareMarker(first: Marker) {
  closeComparison();
  const others=liveMarkers().filter(m=>m.id!==first.id);
  const panel=document.createElement('section'); comparison=panel;
  panel.className='compareveil'; panel.setAttribute('role','dialog'); panel.setAttribute('aria-modal','true'); panel.setAttribute('aria-label','Compare markers');
  const opener=document.activeElement as HTMLElement|null;
  const close=()=>{closeComparison();if(opener?.isConnected)opener.focus();};
  panel.innerHTML=`<div class="compareboard"><header><div><small>TWO POINTS · ONE CONNECTION</small><h2>Hold that thought.</h2></div><button class="btn2" id="compareClose" aria-label="Close comparison">×</button></header><label>Compare with<select id="comparePick"><option value="">Choose another marker…</option>${others.map(m=>`<option value="${esc(m.id)}">${esc((note(m.noteId)?.title||'Untitled')+' · '+(m.text||m.draft||'Blank point').slice(0,100))}</option>`).join('')}</select></label><div class="comparepair"><article id="compareA"></article><article id="compareB"><p class="sub">Choose a second point to see its source and saved thinking here.${others.length?'':' Place another marker in a note first.'}</p></article></div><p class="sub">Read side by side without losing your place. Close to continue editing.</p></div>`;
  const paint=(target:Element,m:Marker)=>{target.innerHTML=`<small>${esc(note(m.noteId)?.title||'Untitled')}</small><blockquote>${esc(m.text||'Blank point')}</blockquote>${m.draft?`<label>Current draft</label><p>${esc(m.draft)}</p>`:''}${m.thread.filter(t=>t.role!=='user').map(t=>`<div class="comparethought"><small>${t.role==='self'?'Your thinking':'Marker response'}</small><div class="mmd">${t.calc ? `<p>${esc(`${t.calc} = ${t.result}`)}</p>` : mdToHtml(t.text)}</div></div>`).join('')||'<p class="sub">No saved responses yet.</p>'}`;};
  paint(panel.querySelector('#compareA')!,first);
  panel.querySelector<HTMLSelectElement>('#comparePick')!.onchange=e=>{
    const selected=state.markers.get((e.target as HTMLSelectElement).value), slot=panel.querySelector<HTMLElement>('#compareB')!;
    if(!selected||selected.deleted){slot.textContent='Choose another marker.';return;} paint(slot,selected);
    if(!matchMedia('(prefers-reduced-motion: reduce)').matches)slot.animate([{opacity:0,transform:'translateX(20px) rotate(2deg)'},{opacity:1,transform:'none'}],{duration:350,easing:'cubic-bezier(.2,.8,.2,1)'});
  };
  panel.querySelector<HTMLButtonElement>('#compareClose')!.onclick=close;
  panel.onpointerdown=e=>{e.stopPropagation();if(e.target===panel)close();};
  panel.onkeydown=e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();close();}if(e.key==='Tab'){const els=[...panel.querySelectorAll<HTMLElement>('button,select')];const next=els.indexOf(document.activeElement as HTMLElement)+(e.shiftKey?-1:1);e.preventDefault();els[(next+els.length)%els.length].focus();}};
  document.body.append(panel);panel.querySelector<HTMLSelectElement>('select')!.focus();
}
