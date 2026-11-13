/* Where the LiveBoard notes app lives, so a teacher can reach Worksheets or switch to the student side.
   Production reads VITE_LIVEBOARD_NOTES_URL. The notes app also passes ?notes=<its address>; that is only
   trusted when it matches the configured address or points at this computer (local development), so a crafted
   link can't turn these buttons into links to another site. */
const KEY='liveboard-notes-url';
const local=(u:URL)=>['localhost','127.0.0.1','[::1]'].includes(u.hostname);

export function notesUrl():string|null{
  const configured=(import.meta as any).env?.VITE_LIVEBOARD_NOTES_URL as string|undefined;
  let base:URL|null=null;
  try{if(configured)base=new URL(configured)}catch{}
  try{
    const passed=new URLSearchParams(location.search).get('notes');
    if(passed){const u=new URL(passed);if(local(u)||(base&&u.origin===base.origin)){localStorage.setItem(KEY,u.origin+u.pathname);return u.origin+u.pathname}}
    const kept=localStorage.getItem(KEY);
    if(kept){const u=new URL(kept);if(local(u)||(base&&u.origin===base.origin))return kept}
  }catch{}
  return base?base.href:null;
}

/** The notes app with a role set, optionally opening a screen (#teacher is Worksheets). */
export function notesLink(as:'student'|'teacher',hash=''){
  const base=notesUrl();if(!base)return null;
  const u=new URL(base);u.searchParams.set('as',as);u.hash=hash;return u.href;
}
