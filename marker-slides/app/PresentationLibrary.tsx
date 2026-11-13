'use client';
import { useEffect,useRef,useState,type ReactNode } from 'react';
import { deletePresentation,listPresentations,savePresentation,type Presentation } from './presentations';
import HomeIcon from './HomeIcon';
import { importAccept,importPresentation } from './importPresentation';
import { sampleDecks } from './sampleDecks';
import { initialSlides } from './data';

type Group='className'|'unit'|'topic';
type Order='updated'|'title'|Group;
const groups:[Group,string][]=[['className','Class'],['unit','Unit'],['topic','Topic']];

export default function PresentationLibrary({renderVisual}:{renderVisual:(type:string)=>ReactNode}) {
  const [decks,setDecks]=useState<Presentation[]>([]);
  const [order,setOrder]=useState<Order>('updated');
  const [filters,setFilters]=useState({className:'',unit:'',topic:''});
  const [preview,setPreview]=useState<Presentation|null>(null);
  const [previewIndex,setPreviewIndex]=useState(0);
  const [markerId,setMarkerId]=useState('');
  const [edit,setEdit]=useState<Presentation|null>(null);
  const [remove,setRemove]=useState<Presentation|null>(null);
  const [error,setError]=useState('');
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState(false);
  const fileInput=useRef<HTMLInputElement>(null);
  const [progress,setProgress]=useState('');
  const theme=()=>document.documentElement.dataset.theme||'dark';
  const editor=(id:string)=>'/?deck='+encodeURIComponent(id)+'&theme='+theme();

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
    load().catch(()=>setError('Could not open the presentation library.')).finally(()=>setLoading(false));
  },[]);

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

  const ordered=decks.filter(deck=>groups.every(([key])=>!filters[key]||deck[key]===filters[key])).sort((a,b)=>
    order==='updated'?b.updated-a.updated:a[order].localeCompare(b[order],undefined,{numeric:true,sensitivity:'base'})||a.title.localeCompare(b.title));
  const slide=preview?.slides[previewIndex];
  const exampleMarker=preview?.sampleMarkers?.find(marker=>marker.id===markerId&&marker.slide===previewIndex);

  return <main className="deck-library">
    <header className="library-header"><div><a className="classroom-home" href="https://liveboard-classroom-review.zippybeach4.chatgpt.site/" aria-label="LiveBoard homepage" title="LiveBoard homepage"><HomeIcon/></a><h1>Presentations</h1></div>
      <div className="library-header-actions">
        <input ref={fileInput} type="file" accept={importAccept} multiple hidden onChange={event=>{const files=Array.from(event.target.files||[]);event.target.value='';void importFiles(files)}}/>
        <button className="outline" disabled={busy} onClick={()=>fileInput.current?.click()}>Import files</button>
        <button className="primary" disabled={busy} onClick={create}>New presentation</button>
      </div>
    </header>
    <p className="library-import-hint">Import a PDF, LiveBoard JSON export, or PNG, JPEG, and WebP images. For PowerPoint or Google Slides, export the deck as a PDF first.</p>
    {progress&&<p role="status">{progress}</p>}
    <div className="library-filters">
      {groups.map(([key,label])=><label key={key}>{label}<select value={filters[key]} onChange={event=>setFilters({...filters,[key]:event.target.value})}><option value="">All</option>{[...new Set(decks.map(deck=>deck[key]).filter(Boolean))].sort((a,b)=>a.localeCompare(b,undefined,{numeric:true})).map(value=><option key={value}>{value}</option>)}</select></label>)}
      <label>Sort by<select value={order} onChange={event=>setOrder(event.target.value as Order)}><option value="updated">Most recent</option><option value="title">Title</option>{groups.map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
    </div>
    {error&&<p role="alert">{error}</p>}
    {loading?<p>Loading presentations…</p>:ordered.length===0?<p className="library-empty">{decks.length?'No presentations match these filters.':'No saved presentations on this browser yet.'}</p>:<ul className="deck-grid">{ordered.map(deck=><li key={deck.id}>
      <button className="deck-cover" aria-label={'Preview '+deck.title} onClick={()=>{setPreview(deck);setPreviewIndex(0);setMarkerId('')}}>
        {deck.slides[0]?.image&&<img src={deck.slides[0].image} alt=""/>}<span>{deck.slides[0]?.title||deck.title}</span>
      </button>
      <div className="deck-details"><h2><a href={editor(deck.id)}>{deck.title}</a></h2><p>{[deck.className,deck.unit,deck.topic].filter(Boolean).join(' · ')||'Uncategorized'} · {deck.slides.length} {deck.slides.length===1?'slide':'slides'}</p>
      <div className="deck-actions"><button onClick={()=>setEdit(deck)}>Details</button><button disabled={busy} onClick={()=>update(async()=>{await savePresentation({...deck,id:crypto.randomUUID(),title:deck.title+' (copy)',updated:Date.now()});setFilters({className:'',unit:'',topic:''})})}>Copy</button><button className="deck-delete" onClick={()=>setRemove(deck)}>Delete</button></div></div>
    </li>)}</ul>}
    {preview&&slide&&<div className="modal-backdrop" onClick={()=>setPreview(null)}><section className="modal library-preview" role="dialog" aria-modal="true" aria-label={'Preview '+preview.title} onClick={event=>event.stopPropagation()}>
      <button className="modal-close" aria-label="Close preview" onClick={()=>setPreview(null)}>×</button><h2>{preview.title}</h2>
      <div className="slide-canvas"><div className={slide.visual==='uploaded-slide'?'slide-content imported-content':'slide-content'}><div className="slide-kicker">{slide.kicker}</div><h2>{slide.title}</h2><p className="slide-body">{slide.body}{preview.sampleMarkers?.filter(marker=>marker.slide===previewIndex).map(marker=><button key={marker.id} className="example-pin" aria-label="Open example student marker" aria-pressed={markerId===marker.id} onClick={()=>setMarkerId(markerId===marker.id?'':marker.id)}>?</button>)}</p>{slide.image?<img className="slide-upload" src={slide.image} alt={slide.title}/>:renderVisual(slide.visual)}<div className="slide-takeaway">{slide.detail}</div></div>

      </div>
      {exampleMarker&&<section className="sample-marker-thread"><strong>Example student marker</strong><p>{exampleMarker.body}</p><strong>Teacher follow-up</strong><p>{exampleMarker.response}</p></section>}
      <div className="preview-controls"><button className="outline" disabled={previewIndex===0} onClick={()=>setPreviewIndex(previewIndex-1)}>Previous</button><span>{previewIndex+1} / {preview.slides.length}</span><button className="outline" disabled={previewIndex===preview.slides.length-1} onClick={()=>setPreviewIndex(previewIndex+1)}>Next</button><a className="outline" href={editor(preview.id)}>Open presentation</a></div>
    </section></div>}
    {edit&&<div className="modal-backdrop"><section className="modal" role="dialog" aria-modal="true" aria-label="Presentation details"><button className="modal-close" aria-label="Close details" onClick={()=>setEdit(null)}>×</button><h2>Presentation details</h2>
      <form onSubmit={event=>{event.preventDefault();const isNew=!decks.some(deck=>deck.id===edit.id);void update(async()=>{await savePresentation({...edit,title:edit.title.trim(),updated:Date.now()});setEdit(null);if(isNew)location.assign(editor(edit.id))})}}>
        <label>Title<input required value={edit.title} maxLength={100} onChange={event=>setEdit({...edit,title:event.target.value})}/></label>
        {groups.map(([key,label])=><label key={key}>{label}<input value={edit[key]} maxLength={80} onChange={event=>setEdit({...edit,[key]:event.target.value})}/></label>)}
        <button className="primary full" disabled={busy||!edit.title.trim()}>Save presentation</button>
      </form>
    </section></div>}
    {remove&&<div className="modal-backdrop"><section className="modal" role="alertdialog" aria-modal="true" aria-label="Delete presentation"><h2>Delete {remove.title}?</h2><p>This removes the saved presentation from this browser.</p><button className="outline" onClick={()=>setRemove(null)}>Cancel</button> <button className="primary" disabled={busy} onClick={()=>update(async()=>{await deletePresentation(remove.id);setRemove(null)})}>Delete presentation</button></section></div>}
  </main>;
}
