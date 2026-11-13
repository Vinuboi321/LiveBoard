'use client';
import { useRef, useState, type PointerEvent } from 'react';

type Point = { x:number; y:number };
type Stroke = { color:string; points:Point[] };
export default function WaitingRoom({code,setCode,name,setName,onJoin,busy,onFullscreen}:{code:string;setCode:(v:string)=>void;name:string;setName:(v:string)=>void;onJoin:()=>void;busy:boolean;onFullscreen:()=>void}) {
 const [strokes,setStrokes]=useState<Stroke[]>([]);
 const [color,setColor]=useState('#9488FF');
 const drawing=useRef(false);
 function point(event:PointerEvent<SVGSVGElement>):Point {
   const rect=event.currentTarget.getBoundingClientRect();
   return {x:(event.clientX-rect.left)/rect.width*1000,y:(event.clientY-rect.top)/rect.height*600};
 }
 return <main className="waiting-room">
   <header><a className="brand" href="/">LiveBoard</a><button className="outline" onClick={onFullscreen}>Fullscreen</button></header>
   <section className="join-card"><span className="eyebrow">STUDENT SPACE</span><h1>Your lesson starts here.</h1><p>Enter your teacher’s code. Draw while you wait.</p>
   <form onSubmit={event=>{event.preventDefault();onJoin()}}>
     <label>Your name<input value={name} maxLength={40} onChange={event=>setName(event.target.value)} placeholder="First name or nickname"/></label>
     <label>Lesson code<input autoComplete="off" value={code} maxLength={8} onChange={event=>setCode(event.target.value.toUpperCase())} placeholder="8-character code"/></label>
     <button className="primary" disabled={busy||code.trim().length!==8}>{busy?'Joining…':'Join lesson'}</button>
   </form></section>
   <section className="drawing-space"><div className="drawing-toolbar"><span>Sketch space</span>{['#9488FF','#FF77B9','#3CCFEA','#FFC53D'].map(value=><button key={value} aria-label={'Pen '+value} aria-pressed={color===value} style={{background:value}} onClick={()=>setColor(value)}/>)}<button onClick={()=>setStrokes(value=>value.slice(0,-1))}>Undo</button><button onClick={()=>setStrokes([])}>Clear</button></div>
   <svg viewBox="0 0 1000 600" preserveAspectRatio="none" aria-label="Drawing canvas. Drag to draw." onPointerDown={event=>{event.preventDefault();drawing.current=true;event.currentTarget.setPointerCapture(event.pointerId);setStrokes(value=>[...value,{color,points:[point(event)]}])}} onPointerMove={event=>{if(!drawing.current)return;const next=point(event);setStrokes(value=>value.map((stroke,i)=>i===value.length-1?{...stroke,points:[...stroke.points,next]}:stroke))}} onPointerUp={()=>{drawing.current=false}} onPointerCancel={()=>{drawing.current=false}}>
     {strokes.map((stroke,i)=><polyline key={i} points={stroke.points.map(p=>p.x+','+p.y).join(' ')} fill="none" stroke={stroke.color} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>)}
   </svg><small>Your sketch stays on this screen until you join.</small></section>
 </main>;
}
