'use client';
import { useEffect,useRef,useState,type ReactNode } from 'react';
import { deletePresentation,listPresentations,savePresentation,type Presentation } from './presentations';
import { importAccept,importPresentation } from './importPresentation';
import { sampleDecks } from './sampleDecks';
import { initialSlides } from './data';
import { SlideFace,SlideThumb } from './SlideFace';
import { notesLink } from './notesLink';

/* The teacher's home: every presentation in this browser.

   What it is for, beyond listing decks:
   - Slides viewer. Opening a cover shows the whole deck as one slow, eased scroll, so a teacher can read through a
     lesson the way they would flip through a printout, and step into the editor at any slide.
   - After class. A deck that has been taught live keeps what the class asked (see page.tsx, rememberSession). The card
     says how many questions came in and how many were left open, and Review class lists them slide by slide, shows
     which slides drew the most, and saves them as a file for planning the next lesson.
   - Finding things. Search across title, class, unit and topic; filters appear only for the labels actually in use. */

type Group='className'|'unit'|'topic';
type Order='updated'|'title'|Group;
const groups:[Group,string][]=[['className','Class'],['unit','Unit'],['topic','Topic']];
const isExample=(deck:Presentation)=>deck.id.startsWith('sample-classroom-');
const ago=(at:number)=>{const d=Math.floor((Date.now()-at)/864e5);return d<=0?'today':d===1?'yesterday':d<30?d+' days ago':new Date(at).toLocaleDateString()};

/** Wheel and key scrolling that eases instead of jumping: the wheel moves the target a fraction of what it normally
 *  would and the view glides after it. Touch and scrollbar dragging are left to the browser. */
function useSlowScroll(ref:React.RefObject<HTMLDivElement|null>,enabled:boolean,onIndex:(index:number)=>void) {
  useEffect(()=>{
    const el=ref.current;if(!el||!enabled)return;
    let target=el.scrollTop,raf=0,gliding=false;
    const calm=matchMedia('(prefers-reduced-motion: reduce)').matches;
    const max=()=>el.scrollHeight-el.clientHeight;
    const slides=()=>[...el.querySelectorAll<HTMLElement>('[data-slide]')];
    const step=()=>{
      const gap=target-el.scrollTop;
      if(Math.abs(gap)<0.6){el.scrollTop=target;gliding=false;return}
      el.scrollTop+=gap*0.085;
      raf=requestAnimationFrame(step);
    };
    const glide=(to:number)=>{target=Math.max(0,Math.min(max(),to));if(calm){el.scrollTop=target;return}if(!gliding){gliding=true;raf=requestAnimationFrame(step)}};
    const wheel=(event:WheelEvent)=>{
      if(event.ctrlKey)return; // pinch zoom
      event.preventDefault();
      const delta=event.deltaMode===1?event.deltaY*32:event.deltaMode===2?event.deltaY*el.clientHeight:event.deltaY;
      glide((gliding?target:el.scrollTop)+delta*0.45);
    };
    const current=()=>{const mid=el.scrollTop+el.clientHeight*0.4;const list=slides();let at=0;list.forEach((s,i)=>{if(s.offsetTop<=mid)at=i});return at};
    const scrolled=()=>{if(!gliding)target=el.scrollTop;onIndex(current())};
    const key=(event:KeyboardEvent)=>{
      if((event.target as Element).closest('input,textarea,select'))return;
      const list=slides(),at=current();
      const go=(i:number)=>{const s=list[Math.max(0,Math.min(list.length-1,i))];if(s){event.preventDefault();glide(s.offsetTop-12)}};
      if(['ArrowDown','PageDown','ArrowRight',' '].includes(event.key))go(at+1);
      else if(['ArrowUp','PageUp','ArrowLeft'].includes(event.key))go(at-1);
      else if(event.key==='Home')go(0);
      else if(event.key==='End')go(list.length-1);
    };
    el.addEventListener('wheel',wheel,{passive:false});el.addEventListener('scroll',scrolled,{passive:true});document.addEventListener('keydown',key);
    const jump=(event:Event)=>{const s=slides()[(event as CustomEvent<number>).detail];if(s)glide(s.offsetTop-12)};
    el.addEventListener('viewer-jump',jump);
    return()=>{cancelAnimationFrame(raf);el.removeEventListener('wheel',wheel);el.removeEventListener('scroll',scrolled);document.removeEventListener('keydown',key);el.removeEventListener('viewer-jump',jump)};
  },[ref,enabled,onIndex]);
}

export default function PresentationLibrary({renderVisual}:{renderVisual:(type:string)=>ReactNode}) {
  const [decks,setDecks]=useState<Presentation[]>([]);
  const [order,setOrder]=useState<Order>('updated');
  const [filters,setFilters]=useState({className:'',unit:'',topic:''});
  const [search,setSearch]=useState('');
  const [viewer,setViewer]=useState<Presentation|null>(null);
  const [viewerIndex,setViewerIndex]=useState(0);
  const [markerId,setMarkerId]=useState('');
  const [review,setReview]=useState<Presentation|null>(null);
  const [edit,setEdit]=useState<Presentation|null>(null);
  const [remove,setRemove]=useState<Presentation|null>(null);
  const [menu,setMenu]=useState('');
  const [error,setError]=useState('');
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState(false);
  const fileInput=useRef<HTMLInputElement>(null);
  const scroller=useRef<HTMLDivElement>(null);
  const [progress,setProgress]=useState('');
  const theme=()=>document.documentElement.dataset.theme||'dark';
  const editor=(id:string,slide?:number)=>'/?deck='+encodeURIComponent(id)+(slide?'&slide='+slide:'')+'&theme='+theme();
  useSlowScroll(scroller,!!viewer,setViewerIndex);

  useEffect(()=>{
    async function load(){
      const saved=await listPresentations();
      if(!localStorage.getItem('liveboard-sample-lessons-v1')){
        for(const deck of sampleDecks){
          if(saved.some(item=>item.id===deck.id))continue;
          await savePresentation(deck);saved.push(deck);
        }
        localStorage.setItem('liveboard-sample-lessons-v1','1');
      }
      const raw=localStorage.getItem('marker-slides-host');
      if(raw){
        const host=JSON.parse(raw);
        const key='room-'+host.id;
        // Older versions retained only the most recent host room in this browser.
        if(!host.presentationId && !localStorage.getItem('imported-'+key)){
          if(!saved.some(deck=>deck.id===key)){
            try{
              const response=await fetch('/api/rooms?id='+encodeURIComponent(host.id),{headers:{Authorization:'Bearer '+host.secret}});
              if(response.ok){
                const room=await response.json() as Pick<Presentation,'title'|'slides'>;
                const deck={id:key,title:room.title,slides:room.slides,className:'',unit:'',topic:'',updated:Date.now()};
                await savePresentation(deck);
                saved.push(deck);
                localStorage.setItem('imported-'+key,'1');
              }
            }catch{ /* Saved decks remain available if the previous live room cannot be reached. */ }
          }else localStorage.setItem('imported-'+key,'1');
        }
      }
      setDecks(saved);
    }
    load().catch(()=>setError('Could not open your presentations.')).finally(()=>setLoading(false));
  },[]);
  useEffect(()=>{
    const key=(event:KeyboardEvent)=>{if(event.key!=='Escape')return;if(menu)setMenu('');else if(viewer)setViewer(null);else if(review)setReview(null)};
    const away=(event:PointerEvent)=>{if(menu&&!(event.target as Element).closest('.deck-menu'))setMenu('')};
    document.addEventListener('keydown',key);document.addEventListener('pointerdown',away);
    return()=>{document.removeEventListener('keydown',key);document.removeEventListener('pointerdown',away)};
  },[menu,viewer,review]);

  async function update(run:()=>Promise<void>){
    setBusy(true);setError('');
    try{await run();setDecks(await listPresentations())}
    catch{setError('Could not save the change. Check that this browser allows storage.')}
    finally{setBusy(false)}
  }
  async function importFiles(files:File[]){
    if(!files.length)return;
    setBusy(true);setError('');setProgress('Preparing presentation…');
    try{
      const imported=await importPresentation(files,setProgress);
      setEdit({...imported,id:crypto.randomUUID(),className:'',unit:'',topic:'',updated:Date.now()});
    }catch(error){
      setError(error instanceof Error?error.message:'Unable to import the presentation.');
    }finally{
      setBusy(false);setProgress('');
    }
  }
  function create(){
    setEdit({id:crypto.randomUUID(),title:'Untitled presentation',slides:[{...initialSlides[0],title:'Untitled slide',body:'',detail:'',notes:'',visual:'questions'}],className:'',unit:'',topic:'',updated:Date.now()});
  }
  function download(name:string,text:string,type:string){
    const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([text],{type}));a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);
  }
  const fileName=(title:string)=>title.replace(/[^\p{L}\p{N}]+/gu,'-').replace(/^-|-$/g,'').slice(0,60)||'presentation';
  /** The class's questions as a plain document a teacher can paste into their planning notes. */
  function questionsFile(deck:Presentation){
    const s=deck.lastSession!;
    const lines=['# Questions from class: '+deck.title,'',new Date(s.at).toLocaleDateString()+' · '+s.total+' question'+(s.total===1?'':'s')+', '+s.open+' left open',''];
    deck.slides.forEach((slide,i)=>{
      const here=s.questions.filter(q=>q.slide===i);if(!here.length)return;
      lines.push('## Slide '+(i+1)+': '+slide.title.replace(/\n/g,' '),'');
      for(const q of here){lines.push('- '+(q.resolved?'[answered] ':'[open] ')+q.body+' ('+q.author+')');for(const r of q.replies)lines.push('  - '+r)}
      lines.push('');
    });
    download(fileName(deck.title)+'-questions.md',lines.join('\n'),'text/markdown');
  }

  const facets=groups.filter(([key])=>decks.some(deck=>deck[key]));
  const words=search.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const ordered=decks.filter(deck=>groups.every(([key])=>!filters[key]||deck[key]===filters[key])&&words.every(word=>[deck.title,deck.className,deck.unit,deck.topic].join(' ').toLowerCase().includes(word))).sort((a,b)=>
    order==='updated'?b.updated-a.updated:a[order].localeCompare(b[order],undefined,{numeric:true,sensitivity:'base'})||a.title.localeCompare(b.title));
  const [links,setLinks]=useState<{lessons?:string|null,student?:string|null}>({});
  useEffect(()=>setLinks({lessons:notesLink('teacher','#teacher'),student:notesLink('student')}),[]);
  const taught=decks.filter(deck=>deck.lastSession),collected=taught.reduce((n,deck)=>n+deck.lastSession!.total,0),examples=decks.filter(isExample);
  const exampleMarker=viewer?.sampleMarkers?.find(marker=>marker.id===markerId);
  const peak=review?.lastSession?Math.max(1,...review.lastSession.bySlide):1;

  return <main className="deck-library">
    <header className="library-header"><div><span className="brand library-brand"><span className="brandmark"><i/><i/><i/></span>LiveBoard<span className="brand-tag">SLIDES</span></span><h1>Presentations</h1>
      <p className="library-stats">{decks.length} presentation{decks.length===1?'':'s'}{taught.length?<> · {taught.length} taught live · {collected} question{collected===1?'':'s'} from your classes</>:<> · teach one live to collect your class’s questions here</>}</p></div>
      <div className="library-header-actions">
        {links.lessons&&<a className="outline" href={links.lessons} title="Turn a PDF or document into a worksheet with marker questions and hints">Worksheets</a>}
        {links.student&&<a className="library-switch" href={links.student} title="Use LiveBoard as a student on this device">Switch to student notes</a>}
        <input ref={fileInput} type="file" accept={importAccept} multiple hidden onChange={event=>{const files=Array.from(event.target.files||[]);event.target.value='';void importFiles(files)}}/>
        <button className="outline" disabled={busy} onClick={()=>fileInput.current?.click()} title="A PDF, a LiveBoard file, or PNG, JPEG and WebP images. From PowerPoint or Google Slides, export a PDF first.">Import slides</button>
        <button className="primary" disabled={busy} onClick={create}>New presentation</button>
      </div>
    </header>
    {progress&&<p role="status">{progress}</p>}
    <div className="library-filters">
      <label className="library-search">Search<input type="search" value={search} placeholder="Title, class, unit or topic" onChange={event=>setSearch(event.target.value)}/></label>
      {facets.map(([key,label])=><label key={key}>{label}<select value={filters[key]} onChange={event=>setFilters({...filters,[key]:event.target.value})}><option value="">All</option>{[...new Set(decks.map(deck=>deck[key]).filter(Boolean))].sort((a,b)=>a.localeCompare(b,undefined,{numeric:true})).map(value=><option key={value}>{value}</option>)}</select></label>)}
      <label>Sort by<select value={order} onChange={event=>setOrder(event.target.value as Order)}><option value="updated">Most recent</option><option value="title">Title</option>{facets.map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
    </div>
    {error&&<p role="alert">{error}</p>}
    {loading?<p>Loading presentations…</p>:ordered.length===0?<p className="library-empty">{decks.length?'No presentations match.':'Nothing here yet. Import the slides you already teach from, or start a new presentation.'}</p>:<ul className="deck-grid">{ordered.map(deck=><li key={deck.id}>
      <button className="deck-cover" aria-label={'Look through the slides of '+deck.title} onClick={()=>{setViewer(deck);setViewerIndex(0);setMarkerId('')}}>
        {deck.slides[0]&&<SlideThumb slide={deck.slides[0]} renderVisual={renderVisual}/>}
        <span className="deck-count">{deck.slides.length} slide{deck.slides.length===1?'':'s'}</span>{isExample(deck)&&<span className="deck-example">Example</span>}
      </button>
      <div className="deck-details"><h2><a href={editor(deck.id)}>{deck.title}</a></h2><p>{[deck.className,deck.unit,deck.topic].filter(Boolean).join(' · ')||'No class set'}</p>
      {deck.lastSession&&<button className="deck-session" onClick={()=>setReview(deck)}><b>{deck.lastSession.total}</b> question{deck.lastSession.total===1?'':'s'} from class{deck.lastSession.open?<> · <em>{deck.lastSession.open} open</em></>:' · all answered'}<small>{ago(deck.lastSession.at)} · Review class →</small></button>}
      <div className="deck-actions"><a className="deck-open" href={editor(deck.id)}>Open</a><button onClick={()=>{setViewer(deck);setViewerIndex(0);setMarkerId('')}}>Slides</button>
        <span className="deck-menu"><button aria-label={'More for '+deck.title} aria-haspopup="menu" aria-expanded={menu===deck.id} onClick={()=>setMenu(menu===deck.id?'':deck.id)}>•••</button>
          {menu===deck.id&&<span className="deck-menu-list" role="menu">
            <button role="menuitem" onClick={()=>{setMenu('');setEdit(deck)}}>Title and class…</button>
            <button role="menuitem" disabled={busy} onClick={()=>{setMenu('');void update(async()=>{await savePresentation({...deck,id:crypto.randomUUID(),title:deck.title+' (copy)',updated:Date.now(),lastSession:undefined});setFilters({className:'',unit:'',topic:''})})}}>Duplicate</button>
            <button role="menuitem" onClick={()=>{setMenu('');download(fileName(deck.title)+'.liveboard.json',JSON.stringify({title:deck.title,slides:deck.slides},null,2),'application/json')}}>Save as a file</button>
            <button role="menuitem" className="deck-delete" onClick={()=>{setMenu('');setRemove(deck)}}>Delete…</button>
          </span>}</span></div></div>
    </li>)}</ul>}
    {examples.length>0&&decks.length>examples.length&&<p className="library-examples">The {examples.length} example{examples.length===1?'':'s'} can go once you have your own. <button disabled={busy} onClick={()=>update(async()=>{for(const deck of examples)await deletePresentation(deck.id)})}>Remove examples</button></p>}

    {viewer&&<div className="modal-backdrop" onClick={()=>setViewer(null)}><section className="modal slides-viewer" role="dialog" aria-modal="true" aria-label={'Slides of '+viewer.title} onClick={event=>event.stopPropagation()}>
      <header className="viewer-head"><div><span className="eyebrow">{[viewer.className,viewer.unit,viewer.topic].filter(Boolean).join(' / ')||'PRESENTATION'}</span><h2>{viewer.title}</h2></div>
        <span className="viewer-count">{viewerIndex+1} / {viewer.slides.length}</span>
        <a className="primary" href={editor(viewer.id,viewerIndex)}>Open at slide {viewerIndex+1}</a>
        <button className="modal-close" aria-label="Close slides" onClick={()=>setViewer(null)}>×</button></header>
      <div className="viewer-body">
        <nav className="viewer-rail" aria-label="Jump to a slide">{viewer.slides.map((_,i)=><button key={i} aria-current={i===viewerIndex} aria-label={'Slide '+(i+1)} onClick={()=>scroller.current?.dispatchEvent(new CustomEvent('viewer-jump',{detail:i}))}>{i+1}{viewer.lastSession?.bySlide[i]?<i title={viewer.lastSession.bySlide[i]+' questions from class'}/>:null}</button>)}</nav>
        <div className="viewer-scroll" ref={scroller} tabIndex={0}>
          {viewer.slides.map((slide,i)=><article key={i} data-slide={i} className={i===viewerIndex?'on':''}>
            <div className="slide-canvas"><SlideFace slide={slide} number={i} footer={[viewer.className,viewer.topic].filter(Boolean).join(' / ').toUpperCase()||'LIVEBOARD'} renderVisual={renderVisual}>
              {viewer.sampleMarkers?.filter(marker=>marker.slide===i).map(marker=><button key={marker.id} className="example-pin" aria-label="Open example student marker" aria-pressed={markerId===marker.id} onClick={()=>setMarkerId(markerId===marker.id?'':marker.id)}>?</button>)}
            </SlideFace></div>
            {exampleMarker&&exampleMarker.slide===i&&<section className="sample-marker-thread"><strong>Example student marker</strong><p>{exampleMarker.body}</p><strong>Teacher follow-up</strong><p>{exampleMarker.response}</p></section>}
            {slide.notes&&<p className="viewer-notes"><b>Your notes</b>{slide.notes}</p>}
          </article>)}
          <p className="viewer-end">End of the deck. <a href={editor(viewer.id)}>Open it to edit or teach →</a></p>
        </div>
      </div>
    </section></div>}

    {review?.lastSession&&<div className="modal-backdrop" onClick={()=>setReview(null)}><section className="modal class-review" role="dialog" aria-modal="true" aria-label={'Questions from class for '+review.title} onClick={event=>event.stopPropagation()}>
      <button className="modal-close" aria-label="Close review" onClick={()=>setReview(null)}>×</button>
      <span className="eyebrow">AFTER CLASS · {ago(review.lastSession.at).toUpperCase()}</span><h2>{review.title}</h2>
      <p className="review-sum"><b>{review.lastSession.total}</b> question{review.lastSession.total===1?'':'s'} · <b>{review.lastSession.open}</b> left open · room {review.lastSession.room}</p>
      <div className="review-bars" role="img" aria-label="Questions per slide">{review.slides.map((slide,i)=><div key={i} title={'Slide '+(i+1)+': '+(review.lastSession!.bySlide[i]||0)+' questions'}><i style={{height:Math.round(100*(review.lastSession!.bySlide[i]||0)/peak)+'%'}}/><span>{i+1}</span></div>)}</div>
      <div className="review-list">{review.lastSession.total===0?<p className="library-empty">No one placed a marker in this class.</p>:review.slides.map((slide,i)=>{const here=review.lastSession!.questions.filter(q=>q.slide===i);return here.length?<section key={i}><h3><a href={editor(review.id,i)}>Slide {i+1} · {slide.title.replace(/\n/g,' ')}</a><span>{here.length}</span></h3>
        {here.map((q,n)=><div className={'review-q'+(q.resolved?' done':'')} key={n}><p>{q.body}</p><small>{q.author} · {q.resolved?'answered':'still open'}</small>{q.replies.map((r,k)=><blockquote key={k}>{r}</blockquote>)}</div>)}</section>:null})}</div>
      <div className="preview-controls"><a className="primary" href={editor(review.id)}>Open presentation</a><button className="outline" disabled={!review.lastSession.total} onClick={()=>questionsFile(review)}>Save the questions</button></div>
    </section></div>}

    {edit&&<div className="modal-backdrop"><section className="modal" role="dialog" aria-modal="true" aria-label="Presentation details"><button className="modal-close" aria-label="Close details" onClick={()=>setEdit(null)}>×</button><h2>Title and class</h2>
      <form onSubmit={event=>{event.preventDefault();const isNew=!decks.some(deck=>deck.id===edit.id);void update(async()=>{await savePresentation({...edit,title:edit.title.trim(),updated:Date.now()});setEdit(null);if(isNew)location.assign(editor(edit.id))})}}>
        <label>Title<input required value={edit.title} maxLength={100} onChange={event=>setEdit({...edit,title:event.target.value})}/></label>
        {groups.map(([key,label])=><label key={key}>{label}<input value={edit[key]} maxLength={80} placeholder={key==='className'?'e.g. AP Chemistry, period 3':key==='unit'?'e.g. Unit 7':'e.g. Equilibrium'} onChange={event=>setEdit({...edit,[key]:event.target.value})}/></label>)}
        <button className="primary full" disabled={busy||!edit.title.trim()}>Save presentation</button>
      </form>
    </section></div>}
    {remove&&<div className="modal-backdrop"><section className="modal" role="alertdialog" aria-modal="true" aria-label="Delete presentation"><h2>Delete {remove.title}?</h2><p>This removes the presentation{remove.lastSession?' and the questions kept from its last class':''} from this browser.</p><button className="outline" onClick={()=>setRemove(null)}>Cancel</button> <button className="primary" disabled={busy} onClick={()=>update(async()=>{await deletePresentation(remove.id);setRemove(null)})}>Delete presentation</button></section></div>}
  </main>;
}
