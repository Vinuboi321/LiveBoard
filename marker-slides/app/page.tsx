'use client';
import { useEffect, useRef, useState, type PointerEvent } from 'react';
import HomeIcon from './HomeIcon';
import PresentationLibrary from './PresentationLibrary';
import { getPresentation,savePresentation,type Presentation } from './presentations';
import WaitingRoom from './WaitingRoom';
import suggestedImages from './api/images/suggested.json';
import { initialSlides, sampleMarkers, type Slide } from './data';
type Region = { left:number; top:number; width:number; height:number };
type Spot = { x:number; y:number; slide:number; region?:Region; screenshot?:string };
type Mark={region?:Region; screenshot?:string;id:string;slide:number;x:number;y:number;kind:string;author:string;body:string;resolved:number;created:number};
type Reply={id:string;marker:string;author:string;body:string;image?:string;source?:string};
const kinds:any={question:{label:'Question',verb:'Ask a question',icon:'?',color:'var(--t-question)'},explain:{label:'Elaboration',verb:'Explain further',icon:'↗',color:'var(--t-explain)'},idea:{label:'Idea',verb:'Explore an idea',icon:'✧',color:'var(--t-link)'}};
function Visual({type}:{type:string}){if(type==='none')return null;if(type==='graph')return <svg viewBox="0 0 500 270" className="chart" aria-label="Two concentrations become constant at different levels"><path d="M40 20V230H480" fill="none" stroke="#b9b1cc" strokeWidth="2"/><path d="M40 35 C120 35 120 170 285 170H470" fill="none" stroke="#9873d8" strokeWidth="4"/><path d="M40 210 C120 210 120 100 285 100H470" fill="none" stroke="#dca64c" strokeWidth="4"/><path d="M285 25V230" stroke="#b9b1cc" strokeDasharray="6 6"/><text x="300" y="45">Equilibrium</text><text x="390" y="88">Product</text><text x="390" y="193">Reactant</text><text x="380" y="260">Time →</text></svg>;
 if(type==='bottle')return <div className="bottle-visual"><div className="bottle"><i/><div className="water">{Array.from({length:12},(_,i)=><span key={i} style={{left:(15+i*23%70)+'%',bottom:(12+i*37%75)+'%',width:5+i%4*3,height:5+i%4*3}}/>)}</div></div><div className="bottle-copy"><span className="eyebrow">A FAMILIAR EQUILIBRIUM</span><h3>CO₂(g) ⇌ CO₂(aq)</h3><p>Same particles.<br/>A different balance.</p></div></div>;
 if(type==='questions'||type==='exit')return <div className="question-visual">{Object.entries(kinds).map(([key,k]:any)=><div key={key}><span style={{color:k.color,borderColor:k.color}}>{k.icon}</span><h4>{k.verb}</h4><p>{key==='question'?'“What happens if…?”':key==='explain'?'“Can we revisit…?”':'“Could we try…?”'}</p></div>)}</div>;
 return <div className="reaction-visual"><div className="molecule-cloud purple">{[0,1,2,3,4,5].map(i=><i key={i} style={{left:[18,55,34,72,20,60][i]+'%',top:[20,12,48,40,75,75][i]+'%'}}/>)}<span>Reactants</span></div><div className="reaction-arrows"><span className="arrow forward">⟶</span><span className="arrow back">⟵</span><small>{type==='shift'?'a new balance':'equal rates'}</small></div><div className="molecule-cloud gold">{[0,1,2,3].map(i=><i key={i} style={{left:[25,60,25,60][i]+'%',top:[20,28,66,72][i]+'%'}}/>)}<span>Products</span></div></div>}
export default function Page(){
 const [slides,setSlides]=useState<Slide[]>(initialSlides),[title,setTitle]=useState('The quiet motion of equilibrium'),[index,setIndex]=useState(1),[role,setRole]=useState('teacher'),[markers,setMarkers]=useState<Mark[]>(sampleMarkers),[replies,setReplies]=useState<Reply[]>([]),[selected,setSelected]=useState<string|null>(null),[placing,setPlacing]=useState(false),[spot,setSpot]=useState<Spot|null>(null),[kind,setKind]=useState('question'),[body,setBody]=useState(''),[reply,setReply]=useState(''),[tab,setTab]=useState('conversation'),[filter,setFilter]=useState('all'),[scope,setScope]=useState('slide'),[until,setUntil]=useState(0),[now,setNow]=useState(Date.now()),[duration,setDuration]=useState(120),[modal,setModal]=useState(''),[room,setRoom]=useState(''),[secret,setSecret]=useState(''),[joinCode,setJoinCode]=useState(''),[name,setName]=useState(''),[follow,setFollow]=useState(true),[liveIndex,setLiveIndex]=useState(0),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[query,setQuery]=useState('chemical equilibrium'),[images,setImages]=useState<any[]>(suggestedImages),[searching,setSearching]=useState(false),[imageError,setImageError]=useState(''),[edit,setEdit]=useState<Slide|null>(null),[focus,setFocus]=useState(false);
 const [library,setLibrary]=useState(false);
 const [deck,setDeck]=useState<Presentation|null>(null);
 const [ready,setReady]=useState(false);
 const participantRef=useRef('');
 const credentialsRef=useRef({role,secret});credentialsRef.current={role,secret};
 const appRef = useRef<HTMLDivElement>(null);
 const slideRef = useRef<HTMLDivElement>(null);
 const origin = useRef<{x:number;y:number}|null>(null);
 const [selection,setSelection] = useState<Region|null>(null);
 const [capturing,setCapturing] = useState(false);
 const captureVersion = useRef(0);

 useEffect(() => {
   const update = () => setFocus(document.fullscreenElement === appRef.current);
   document.addEventListener('fullscreenchange', update);
   return () => document.removeEventListener('fullscreenchange', update);
 }, []);

 async function toggleFullscreen() {
   if (document.fullscreenElement) {
     await document.exitFullscreen();
     return;
   }
   if (focus) { setFocus(false); return; }
   try {
     if (!appRef.current?.requestFullscreen) throw new Error();
     await appRef.current.requestFullscreen();
   } catch {
     setFocus(true);
     setNotice('Browser fullscreen is unavailable. Expanded view is on.');
   }
 }

 function pointerPosition(event:PointerEvent<HTMLDivElement>) {
   const bounds = event.currentTarget.getBoundingClientRect();
   const percent = (value:number) => Math.max(0, Math.min(100,value));
   return {x:percent(100*(event.clientX-bounds.left)/bounds.width),y:percent(100*(event.clientY-bounds.top)/bounds.height)};
 }

 function regionBetween(start:{x:number;y:number}, end:{x:number;y:number}):Region {
   return {left:Math.min(start.x,end.x),top:Math.min(start.y,end.y),width:Math.abs(end.x-start.x),height:Math.abs(end.y-start.y)};
 }

 function cancelPlacement() {
   origin.current=null;
   setSelection(null);
   setPlacing(false);
 }

 async function finishPlacement(event:PointerEvent<HTMLDivElement>) {
   if (!origin.current) return;
   const point = pointerPosition(event);
   const region = regionBetween(origin.current, point);
   const bounds = event.currentTarget.getBoundingClientRect();
   const isRegion = region.width*bounds.width/100 >= 8 && region.height*bounds.height/100 >= 8;
   cancelPlacement();
   setSelected(null);
   const draft:Spot = isRegion
     ? {x:region.left+region.width/2,y:region.top+region.height/2,slide:index,region}
     : {...point,slide:index};
   setSpot(draft);
   if (!isRegion || !slideRef.current) return;
   const version = ++captureVersion.current;
   setCapturing(true);
   try {
     const {toCanvas} = await import('html-to-image');
     const source = await toCanvas(slideRef.current,{pixelRatio:1,skipFonts:true});
     const width = source.width*region.width/100;
     const height = source.height*region.height/100;
     const scale = Math.min(1,640/Math.max(width,height));
     const cropped = document.createElement('canvas');
     cropped.width = Math.max(1,Math.round(width*scale));
     cropped.height = Math.max(1,Math.round(height*scale));
     const context = cropped.getContext('2d');
     if (!context) throw new Error();
     context.drawImage(source,source.width*region.left/100,source.height*region.top/100,width,height,0,0,cropped.width,cropped.height);
     const screenshot = cropped.toDataURL('image/jpeg',0.78);
     if (screenshot.length > 250000) throw new Error();
     if (version === captureVersion.current) setSpot(current => current === draft ? {...draft,screenshot} : current);
   } catch {
     if (version === captureVersion.current) setNotice('The selected region is saved. Its screenshot preview could not be created.');
   } finally {
     if (version === captureVersion.current) setCapturing(false);
   }
 }

 function regionStyle(region:Region) {
   return {left:region.left+'%',top:region.top+'%',width:region.width+'%',height:region.height+'%'};
 }

 const stateRef=useRef({follow,role});stateRef.current={follow,role};const active=markers.find(m=>m.id===selected);const open=until>now;const seconds=Math.max(0,Math.ceil((until-now)/1000));const slide=slides[index]||slides[0];
 useEffect(()=>{const t=setInterval(()=>setNow(Date.now()),1000);const params=new URLSearchParams(location.search);const participant=localStorage.getItem('liveboard-participant')||crypto.randomUUID();localStorage.setItem('liveboard-participant',participant);participantRef.current=participant;
 const code=params.get('room');const view=params.get('view');
 const theme=params.get('theme');
 if(theme==='light'||theme==='dark')document.documentElement.dataset.theme=theme;
 if(view==='library')setLibrary(true);
 const deckId=params.get('deck');
 if(deckId&&!code&&view!=='library'){
   getPresentation(deckId).then(saved=>{
     if(!saved){setLibrary(true);return}
     setDeck(saved);setTitle(saved.title);setSlides(saved.slides);setIndex(0);setMarkers(saved.sampleMarkers||[]);setReplies((saved.sampleMarkers||[]).map(marker=>({id:marker.id+'-reply',marker:marker.id,author:'Teacher follow-up',body:marker.response})));
   }).catch(()=>setNotice('Could not open this presentation.')).finally(()=>setReady(true));
 }else setReady(true);
 if(view==='projector'&&code){setRole('projector');credentialsRef.current={role:'projector',secret:''};setRoom(code.toUpperCase());loadRoom(code.toUpperCase()).catch(e=>setNotice(e.message))}
 else if(code||view==='student'){setRole('student');setJoinCode(code||'')}else{const r=localStorage.getItem('marker-slides-host');if(r){try{const v=JSON.parse(r);setJoinCode(v.id)}catch{}}}return()=>clearInterval(t)},[]);
 useEffect(()=>{if(!notice)return;const t=setTimeout(()=>setNotice(''),5500);return()=>clearTimeout(t)},[notice]);
 async function loadRoom(id:string){const r=await fetch('/api/rooms?id='+encodeURIComponent(id)+(credentialsRef.current.role==='projector'?'&view=projector':''),{headers:{'x-participant':participantRef.current,...(credentialsRef.current.role==='teacher'&&credentialsRef.current.secret?{Authorization:'Bearer '+credentialsRef.current.secret}:{})}});const d:any=await r.json();if(!r.ok)throw Error(d.error);setSlides(d.slides);setTitle(d.title);setMarkers(d.markers);setReplies(d.replies);setUntil(d.until);setLiveIndex(d.current);if(stateRef.current.follow||stateRef.current.role==='teacher'||stateRef.current.role==='projector')setIndex(d.current);return d;}
 useEffect(()=>{if(!room)return;let stopped=false;const t=setInterval(()=>{if(!stopped)loadRoom(room).catch(()=>setNotice('Connection interrupted. Retrying…'))},2500);return()=>{stopped=true;clearInterval(t)}},[room]);
 async function api(data:any){const r=await fetch('/api/rooms',{method:'POST',headers:{'Content-Type':'application/json','x-participant':participantRef.current,...(secret&&role==='teacher'?{Authorization:'Bearer '+secret}:{})},body:JSON.stringify({...data,room})});const d:any=await r.json();if(!r.ok)throw Error(d.error);return d;}
 async function action(fn:()=>Promise<void>){setBusy(true);try{await fn()}catch(e:any){setNotice(e.message||'Something went wrong. Please try again.')}finally{setBusy(false)}}
 async function navigate(i:number){if(i<0||i>=slides.length)return;setIndex(i);setSelected(null);setSpot(null);if(role==='student')setFollow(false);if(room&&role==='teacher')await action(async()=>{await api({action:'control',current:i});setLiveIndex(i)});}
 async function questionTime(){await action(async()=>{if(room){await api({action:'control',duration:open?0:duration});await loadRoom(room)}else setUntil(open?0:Date.now()+duration*1000)})}
 useEffect(()=>{
   if(!deck||room)return;
   if(title===deck.title&&slides===deck.slides)return;
   const timer=setTimeout(()=>{
     savePresentation({...deck,title,slides,updated:Date.now()}).catch(()=>setNotice('Could not save this presentation.'));
   },200);
   return()=>clearTimeout(timer);
 },[deck,title,slides,room]);
 async function saveDeck(){
   const saved={id:deck?.id||crypto.randomUUID(),className:deck?.className||'',unit:deck?.unit||'',topic:deck?.topic||'',sampleMarkers:deck?.sampleMarkers,title,slides,updated:Date.now()};
   await savePresentation(saved);
   setDeck(saved);
   return saved;
 }
 async function start(){await action(async()=>{const saved=await saveDeck();const d=await api({action:'create',title,slides});setSecret(d.secret);credentialsRef.current={role:'teacher',secret:d.secret};setRoom(d.id);localStorage.setItem('marker-slides-host',JSON.stringify({...d,presentationId:saved.id}));setRole('teacher');setFollow(true);setIndex(0);setSelected(null);await loadRoom(d.id);setModal('share');setNotice('Your live room is ready. Share its code with your class.');})}
 async function join(){await action(async()=>{const code=joinCode.trim().toUpperCase();
 let savedHost:any=null;try{savedHost=JSON.parse(localStorage.getItem('marker-slides-host')||'null')}catch{}
 credentialsRef.current=modal==='resume'&&savedHost?.id===code?{role:'teacher',secret:savedHost.secret}:{role:'student',secret:''};
 const d=await loadRoom(code);setRoom(d.id);let host:any=null;try{host=JSON.parse(localStorage.getItem('marker-slides-host')||'null')}catch{};if(modal==='resume'&&host?.id===code){setSecret(host.secret);setRole('teacher')}else{setSecret('');setRole('student')}setIndex(d.current);setFollow(true);setSelected(null);setModal('');})}
 async function createMarker(){if(!body.trim()||!spot)return;await action(async()=>{const mark={...spot,kind,author:role==='teacher'?'Teacher':name||'Student',body:body.trim()};if(room){const saved=await api({action:'marker',...mark});await loadRoom(room);setSelected(saved.id);setTab('conversation')}else{const m={...mark,id:crypto.randomUUID(),resolved:0,created:Date.now()};setMarkers(marks=>[...marks,m]);setSelected(m.id)}setSpot(null);setBody('');setPlacing(false);setNotice('Marker added to this slide.');})}
 async function sendReply(image?:any){if(!active)return;await action(async()=>{const data={id:active.id,body:image?image.title+' — '+(image.author||'See source')+' · '+image.license:reply,image:image?.url,source:image?.source,author:role==='teacher'?'Teacher':name||'Student'};if(room){await api({action:'reply',...data});await loadRoom(room)}else setReplies(r=>[...r,{...data,id:crypto.randomUUID(),marker:active.id}]);setReply('');if(image){setTab('conversation');setNotice('Image attached to this marker.')}})}
 async function resolve(){if(!active)return;await action(async()=>{if(room){await api({action:'resolve',id:active.id,resolved:!active.resolved});await loadRoom(room)}else setMarkers(ms=>ms.map(m=>m.id===active.id?{...m,resolved:m.resolved?0:1}:m))})}
 async function findImages(e:any){e.preventDefault();setSearching(true);setImageError('');try{const r=await fetch('/api/images?q='+encodeURIComponent(query));const d:any=await r.json();if(!r.ok)throw Error(d.error);setImages(d.images);if(d.notice)setImageError(d.notice);if(!d.images.length)setImageError('No images found. Try a broader phrase.')}catch(e:any){setImageError(e.message)}finally{setSearching(false)}}
 function markerColor(marker:Mark){return marker.author==='Teacher'?'var(--teacher-marker)':'var(--student-marker)'}
 function openProjector(){
   if(!room){setNotice('Start a live lesson to connect a projector.');return}
   const url = new URL(location.origin);
   url.searchParams.set('view','projector');
   url.searchParams.set('room',room);
   url.searchParams.set('theme',document.documentElement.dataset.theme||'dark');
   window.open(url.href,'_blank','noopener');
 }
 const visible=markers.filter(m=>(scope==='all'||m.slide===index)&&(filter==='all'||(filter==='resolved'?m.resolved:!m.resolved&&m.kind===filter)));
 function pick(m:Mark){if(m.slide!==index){setIndex(m.slide);if(role==='student')setFollow(false);else if(room)action(async()=>{await api({action:'control',current:m.slide})})}setSelected(m.id);setTab('conversation');setSpot(null);setPlacing(false);setQuery(slides[m.slide].title.replace('\n',' '));}
 function exportLesson(){const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify({title,slides,markers,replies},null,2)],{type:'application/json'}));a.download='liveboard-lesson.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)}
 async function importLesson(file:File){try{const d=JSON.parse(await file.text());if(!Array.isArray(d.slides)||!d.slides.length||d.slides.length>40||!d.slides.every((s:any)=>['title','body','kicker','detail','visual','notes'].every(k=>typeof s[k]==='string')))throw Error();setSlides(d.slides);setTitle(typeof d.title==='string'?d.title:'Imported lesson');setIndex(0);setMarkers([]);setReplies([]);setSelected(null);setNotice('Lesson imported. Start a live room when you are ready.')}catch{setNotice('Choose a valid LiveBoard lesson JSON file.')}}
 if(!ready)return <div className="app" role="status" style={{padding:40}}>Opening LiveBoard…</div>;
 if(library)return <PresentationLibrary renderVisual={type=><Visual type={type}/>}/>;
 if(role==='student'&&!room)return <div ref={appRef} className="app student-waiting"><WaitingRoom code={joinCode} setCode={setJoinCode} name={name} setName={setName} busy={busy} onJoin={join} onFullscreen={toggleFullscreen}/>{notice&&<div className="toast" role="status">{notice}</div>}</div>;
 return <div ref={appRef} className={'app '+(focus?'focus':'')+' '+role+'-view'+((active||spot)?' workspace-open':'')}><header className="topbar"><a className="brand" href="/" aria-label="LiveBoard home"><span className="brandmark"><i/><i/><i/></span>LiveBoard<span className="brand-tag">SLIDES</span></a><div className="top-middle"><span className="status-dot"/>{room?'Room '+room:'Interactive lesson studio'}</div><a className="classroom-home" aria-label="Presentation library" title="Presentation library" href="/?view=library" onClick={event=>{event.preventDefault();void action(async()=>{if(!room&&(deck||slides!==initialSlides))await saveDeck();location.assign('/?view=library&theme='+(document.documentElement.dataset.theme||'dark'))})}}><HomeIcon/></a></header>
 <div className="workspace">{role==='teacher'&&<aside className="slide-rail"><div className="rail-heading"><span>YOUR LESSON</span><button title="Lesson options" aria-label="Lesson options" onClick={()=>setModal('lesson')}>•••</button></div><h3>Dynamic<br/>equilibrium</h3><div className="rail-sub">{slides.length} slides <span>•</span> Chemistry</div><nav aria-label="Slides">{slides.map((s,i)=><button className={'thumbnail '+(index===i?'current':'')} key={i} onClick={()=>navigate(i)}><span className="slide-number">{String(i+1).padStart(2,'0')}</span><div className="mini-slide"><span>{s.kicker.split(' / ')[1]||'SLIDE'}</span><strong>{s.title}</strong><div className={'mini-drawing '+s.visual}><i/><i/><i/></div></div><span className="thumb-title">{s.title.replace('\n',' ')}</span>{markers.some(m=>m.slide===i&&!m.resolved)&&<i className="thumb-dot"/>}</button>)}</nav>{role==='teacher'&&<button className="add-slide" disabled={!!room} onClick={()=>{const s={title:'A new perspective.',kicker:String(slides.length+1).padStart(2,'0')+' / EXPLORE',body:'What would you like your students to explore?',detail:'Drop a marker to start the conversation.',visual:'questions',notes:''};setSlides([...slides,s]);setIndex(slides.length);setEdit(s);setModal('edit')}}>＋ Add a slide</button>}</aside>}
 <main><section className="lesson-heading"><div><div className="eyebrow">CHEMISTRY <span>/</span> LIVE LESSON</div><h1>{title}</h1></div><div className="lesson-actions">{role==='teacher'&&!room&&<button className="outline" disabled={busy} onClick={()=>action(async()=>{await saveDeck();setNotice('Presentation saved.')})}>Save presentation</button>}{room&&role==='teacher'&&<button className="outline" onClick={()=>setModal('share')}>Invite students</button>}{role==='teacher'&&<button className="primary" disabled={busy} onClick={()=>room?openProjector():start()}>{room?'Open projector':'▶ Start live lesson'}</button>}</div></section>
 <div className={'question-bar '+(open?'is-open':'')}><div className="q-icon">{open?'◷':'◉'}</div><div><strong>{open?'Question time is open':role==='teacher'?'Question time':'Follow along. Your next question starts with a marker.'}</strong><p>{open?'Review slide markers together while the timer runs.':role==='teacher'?'Open a question window when you’re ready to hear from your class.':'Drop a marker whenever you have a question.'}</p></div>{open&&<span className="timer">{Math.floor(seconds/60)}:{String(seconds%60).padStart(2,'0')}</span>}{role==='teacher'?<div className="q-controls">{!open&&<select aria-label="Question time duration" value={duration} onChange={e=>setDuration(Number(e.target.value))}><option value={60}>1 minute</option><option value={120}>2 minutes</option><option value={180}>3 minutes</option><option value={300}>5 minutes</option></select>}<button disabled={busy} onClick={questionTime}>{open?'Close question time':'Open question time'} <span>↗</span></button></div>:<span className="live-pill">{open?'Your turn':'Markers open'}</span>}</div>
 <div className="presentation-area"><section className="presentation"><div className="canvas-toolbar"><span><span className="status-dot"/>{room?'LIVE CLASSROOM':'EXAMPLE LESSON'}</span><div>{role==='student'&&room&&<button onClick={()=>{setFollow(true);setIndex(liveIndex);setSelected(null)}}>{follow?'● Following live':'↻ Follow live'}</button>}{role==='teacher'&&<button disabled={!!room} onClick={()=>{setEdit({...slide});setModal('edit')}}>✎ Edit slide</button>}<button onClick={toggleFullscreen}>{focus?"Exit fullscreen":"⛶ Fullscreen"}</button></div></div>
 <div className={'slide-canvas '+(placing?'placing':'')} onPointerDown={event=>{
   if (!placing || event.button!==0 || (event.target as Element).closest('button')) return;
   event.preventDefault();
   origin.current=pointerPosition(event);
   event.currentTarget.setPointerCapture(event.pointerId);
 }} onPointerMove={event=>{
   if (origin.current) setSelection(regionBetween(origin.current,pointerPosition(event)));
 }} onPointerUp={finishPlacement} onPointerCancel={cancelPlacement}
 onKeyDown={event=>{
   if (event.key==='Escape') cancelPlacement();
   if (placing && event.target===event.currentTarget && (event.key==='Enter'||event.key===' ')) {
     event.preventDefault();
     cancelPlacement();
     setSpot({x:50,y:50,slide:index});
   }
 }} tabIndex={placing?0:-1} aria-label={placing?"Click to pin, drag to select a region, or press Enter to pin the center":undefined}><div ref={slideRef} className={slide.visual==='uploaded-slide'?'slide-content imported-content':'slide-content'}><div className="slide-kicker">{slide.kicker}</div><h2>{slide.title.split('\n').map((line,i)=><span key={i}>{line}<br/></span>)}</h2><p className="slide-body">{slide.body}{!room&&deck?.sampleMarkers?.filter(marker=>marker.slide===index).map(marker=><button key={marker.id} className="example-pin" aria-label="Open example student marker" aria-pressed={selected===marker.id} onClick={()=>pick(marker)}>?</button>)}</p>{slide.image?<img className="slide-upload" src={slide.image} alt={slide.title}/>:<Visual type={slide.visual}/>}<div className="slide-takeaway"><span>↳</span>{slide.detail}</div><footer><span>LIVEBOARD <i>/</i> CHEMISTRY</span><span>{String(index+1).padStart(2,'0')}</span></footer></div>{markers.filter(m=>m.slide===index&&(role!=='projector'||m.author==='Teacher')&&(room||!deck?.sampleMarkers?.some(example=>example.id===m.id))).map(m=><button key={m.id} className={'pin free '+(m.resolved?'resolved':'')+(selected===m.id?' selected':'')} style={{left:m.x+'%',top:m.y+'%','--tc':markerColor(m)} as any} title={m.author+': '+m.body} aria-label={'Open '+kinds[m.kind]?.label+' from '+m.author} onClick={e=>{e.stopPropagation();if(role!=='projector')pick(m)}}/>)}{(selection || (spot?.slide===index ? spot.region : undefined) || (active?.slide===index ? active.region : undefined)) && <span className="region-outline" aria-hidden="true" style={regionStyle((selection || spot?.region || active?.region)!)}/>}
 {spot?.slide===index&&<span className="pin free draft-pin" style={{left:spot.x+'%',top:spot.y+'%','--tc':role==='teacher'?'var(--teacher-marker)':'var(--student-marker)'} as any}/>} {placing&&<div className="placement-hint">Click to pin or drag to capture a region <button onClick={e=>{e.stopPropagation();cancelPlacement()}}>Cancel</button></div>}</div>
 <div className="marker-legend"><span className="teacher-key">● Teacher</span><span className="student-key">● {role==='student'?'Yours':'Students'}</span></div><div className="slide-controls"><div><button aria-label="Previous slide" disabled={index===0} onClick={()=>navigate(index-1)}>←</button><span>{String(index+1).padStart(2,'0')} <i>/ {String(slides.length).padStart(2,'0')}</i></span><button aria-label="Next slide" disabled={index===slides.length-1} onClick={()=>navigate(index+1)}>→</button></div><span className="marker-count">{markers.filter(m=>m.slide===index).length} markers on this slide</span><button className="place-button" disabled={capturing} onClick={()=>{if(placing){cancelPlacement();return}if(role==='student'&&room)setFollow(false);setPlacing(true);setSpot(null);setSelected(null)}}><span className="small-pin"/>{placing?'Cancel placement':'Drop a marker'}</button></div>
 {role==='teacher'&&<details className="speaker-notes" open><summary>✧ Teacher’s notes <span>Only in teacher view</span></summary><p>{slide.notes||'Add speaking notes using Edit slide.'}</p></details>}
 </section>
 {role!=='projector'&&<aside className="discussion"><div className="discussion-header"><div><span className="eyebrow">THE CONVERSATION</span><h2>{spot?'New marker':active?kinds[active.kind]?.label:'Markers'}</h2></div>{(active||spot)&&<button className="icon-button" aria-label="Close marker" onClick={()=>{setSelected(null);setSpot(null)}}>×</button>}</div>
 {spot?<div className="composer"><p className="context-tag">◉ Anchored to slide {spot.slide+1}</p>{capturing&&<p role="status">Capturing slide region…</p>}{spot.screenshot&&<img className="marker-screenshot" src={spot.screenshot} alt="Selected slide region"/>}<h3>What’s on your mind?</h3><div className="intent-list">{Object.entries(kinds).map(([id,k]:any)=><button key={id} className={kind===id?'chosen':''} onClick={()=>setKind(id)}><i style={{color:k.color}}>{k.icon}</i>{k.verb}<span>{kind===id?'●':'○'}</span></button>)}</div>{role==='student'&&<label>Your name<input value={name} maxLength={40} placeholder="First name or nickname" onChange={e=>setName(e.target.value)}/></label>}<label>{kinds[kind].verb}<textarea autoFocus value={body} maxLength={2000} placeholder={kind==='question'?'What are you wondering about?':kind==='explain'?'Which part would you like explained further?':'What possibility would you like to explore?'} onChange={e=>setBody(e.target.value)}/></label><button className="primary full" disabled={!body.trim()||busy||capturing} onClick={createMarker}>Add marker ↗</button><p className="fineprint">Your request stays connected to this exact place on the slide.</p></div>:active?<div className="marker-workspace"><div className="context-tag">◉ Slide {active.slide+1} <span>{active.resolved?'Resolved':'Open conversation'}</span></div><div className="request-card" style={{'--tc':markerColor(active)} as any}><div><span className="mini-avatar">{active.author.slice(0,1)}</span><b>{active.author}</b><small>{kinds[active.kind]?.label}</small></div><p>{active.body}</p>{active.screenshot&&<img className="marker-screenshot" src={active.screenshot} alt="Slide region attached to this marker"/>}</div><div className="workspace-tabs"><button className={tab==='conversation'?'on':''} onClick={()=>setTab('conversation')}>Conversation</button><button className={tab==='images'?'on':''} onClick={()=>setTab('images')}>▧ Find images</button></div>{tab==='conversation'?<><div className="thread">{replies.filter(r=>r.marker===active.id).length===0?<div className="thread-empty"><span>↳</span><p>This is where understanding grows.</p><small>Add an explanation, a follow-up, or an image.</small></div>:replies.filter(r=>r.marker===active.id).map(r=><div className={'reply '+(r.author==='Teacher'?'teacher-reply':'')} key={r.id}><b>{r.author}</b><p>{r.body}</p>{r.image&&<><img src={r.image} alt={r.body}/><a target="_blank" rel="noreferrer" href={r.source}>Image source & attribution ↗</a></>}</div>)}</div><label className="sr-only" htmlFor="reply">Write a response</label><textarea id="reply" value={reply} maxLength={2000} placeholder={role==='teacher'?'Help connect the dots…':'Add to the conversation…'} onChange={e=>setReply(e.target.value)}/><button className="primary full" disabled={busy||!reply.trim()} onClick={()=>sendReply()}>Send response ↗</button></>:<div className="image-search"><p>Bring a visual into this conversation. Start with a lesson visual or search for something new.</p><form onSubmit={findImages}><input aria-label="Search images" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search Wikimedia Commons"/><button disabled={searching||!query.trim()}>{searching?'…':'Search'}</button></form><small>Wikimedia Commons · Check source attribution</small>{imageError&&<p className="error-text">{imageError}</p>}<div className="image-results">{images.map(i=><div key={i.url}><img src={i.url} alt={i.title}/><span>{i.title}</span><small>{i.author} · {i.license}</small><div><a href={i.source} target="_blank" rel="noreferrer">Source ↗</a><button disabled={busy} onClick={()=>sendReply(i)}>＋ Add</button></div></div>)}</div></div>}{role==='teacher'&&<button className="resolve-button" disabled={busy} onClick={resolve}>{active.resolved?'↺ Reopen marker':'✓ Mark as resolved'}</button>}</div>:<><div className="queue-top"><span>{markers.filter(m=>!m.resolved).length} open markers</span><select aria-label="Marker scope" value={scope} onChange={e=>setScope(e.target.value)}><option value="slide">This slide</option><option value="all">All slides</option></select></div><div className="filter-row">{['all','question','explain','idea','resolved'].map(k=><button key={k} title={k==='all'?'All markers':k==='resolved'?'Resolved':kinds[k].label} className={filter===k?'on':''} onClick={()=>setFilter(k)}>{k==='all'?'All':k==='resolved'?'✓':kinds[k].icon}</button>)}</div><div className="marker-list">{visible.length?visible.map(m=><button className="marker-card" key={m.id} onClick={()=>pick(m)} style={{'--tc':markerColor(m)} as any}><div><span className="intent-dot">{kinds[m.kind]?.icon}</span><b>{kinds[m.kind]?.label}</b><span className="card-chevron">↗</span></div><p>{m.body}</p><footer><span className="mini-avatar">{m.author.slice(0,1)}</span>{m.author}<i>•</i>Slide {m.slide+1}{!!m.resolved&&<span>✓</span>}</footer></button>):<div className="queue-empty"><span>◎</span><h3>A little space for curiosity.</h3><p>{filter==='all'?'Markers placed on the slide will appear here.':'No markers match this filter yet.'}</p></div>}</div></>}
 </aside>}</div></main></div>
 {notice&&<div className="toast" role="status">{notice}<button aria-label="Dismiss notification" onClick={()=>setNotice('')}>×</button></div>}
 {modal&&<div className="modal-backdrop" onClick={()=>setModal('')}><section className="modal" role="dialog" aria-modal="true" aria-label={modal==='edit'?'Edit slide':'Lesson options'} onClick={e=>e.stopPropagation()}><button className="modal-close" aria-label="Close dialog" onClick={()=>setModal('')}>×</button>{modal==='join'||modal==='resume'?<><span className="eyebrow">STEP INTO THE LESSON</span><h2>{modal==='resume'?'Resume your classroom.':'A shared slide.\nYour own questions.'}</h2><p>Enter the room code from your teacher.</p><label>Your name<input value={name} maxLength={40} onChange={e=>setName(e.target.value)} placeholder="First name or nickname"/></label><label>Room code<input value={joinCode} onChange={e=>setJoinCode(e.target.value.toUpperCase())} placeholder="8-character room code" maxLength={8}/></label><button className="primary full" disabled={busy||joinCode.length!==8} onClick={join}>{busy?'Connecting…':modal==='resume'?'Resume lesson':'Join lesson ↗'}</button></>:modal==='share'?<><span className="eyebrow">BETTER TOGETHER</span><h2>Invite a little curiosity.</h2><p>Students join using this code or the lesson link.</p><div className="room-code">{room}</div><button className="primary full" onClick={()=>navigator.clipboard.writeText(location.origin+'/?room='+room+'&theme='+(document.documentElement.dataset.theme||'dark')).then(()=>setNotice('Student link copied.')).catch(()=>setNotice('Copy the room code above to share.'))}>Copy student link ↗</button><p className="fineprint">Send the room code or link to your students.</p></>:modal==='edit'&&edit?<><span className="eyebrow">MAKE IT YOURS</span><h2>Edit slide {index+1}</h2>{(['title','kicker','body','detail','notes'] as const).map(k=><label key={k}>{({title:'Title',kicker:'Section label',body:'Main idea',detail:'Takeaway',notes:'Teacher notes'})[k]}<textarea value={edit[k]} onChange={e=>setEdit({...edit,[k]:e.target.value})}/></label>)}<label>Visual<select value={edit.visual} onChange={e=>setEdit({...edit,visual:e.target.value,image:undefined})}><option value="reaction">Reaction model</option><option value="graph">Concentration graph</option><option value="bottle">Carbonated water</option><option value="questions">Marker prompts</option></select></label><label>Or upload a slide image<input type="file" accept="image/png,image/jpeg,image/webp" onChange={e=>{const f=e.target.files?.[0];if(!f)return;if(f.size>500000){setNotice('Use an image smaller than 500 KB.');return}const r=new FileReader();r.onload=()=>setEdit({...edit,image:String(r.result)});r.readAsDataURL(f)}}/></label><button className="primary full" onClick={()=>{setSlides(s=>s.map((v,i)=>i===index?edit:v));setModal('')}}>Save slide</button></>:modal==='lesson'?<><span className="eyebrow">LESSON STUDIO</span><h2>Your next conversation.</h2><label>Lesson title<input value={title} disabled={!!room} onChange={e=>setTitle(e.target.value)}/></label><button className="outline full" onClick={exportLesson}>Download lesson & discussion</button>{!room&&<><label>Import a LiveBoard lesson<input type="file" accept="application/json,.json" onChange={e=>{if(e.target.files?.[0])importLesson(e.target.files[0]);setModal('')}}/></label><button className="outline full" onClick={()=>setModal('resume')}>Resume a saved room</button></>}<p className="fineprint">Edit slides before starting a room. Your live room preserves its lesson and discussion.</p></>:<><span className="eyebrow">MEET THE MARKER</span><h2>A point on a slide.<br/>A door to understanding.</h2><div className="help-step"><b>01</b><div><h3>Present, then pause.</h3><p>Move through the slides. Open a timed question window when the class needs room to think.</p></div></div><div className="help-step"><b>02</b><div><h3>Point to what matters.</h3><p>Click to pin a spot or drag around part of the slide to attach a screenshot. Teachers and students can add questions, elaboration requests, and ideas.</p></div></div><div className="help-step"><b>03</b><div><h3>Explore it together.</h3><p>Open the marker, reply, pull in images, and resolve it when the explanation lands. Every thread keeps its context.</p></div></div><p className="fineprint">Marker appearance and anchored-workspace behavior adapted from Vinuboi321/LiveBoard. Replies are written by participants; image search retrieves real Wikimedia Commons results.</p></>}</section></div>}
 </div>
}
