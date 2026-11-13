'use client';
import { useEffect,useRef,type ReactNode } from 'react';
import type { Slide } from './data';

/* One slide, drawn the way the editor draws it. The library uses it at two sizes: full width in the slides viewer and
   shrunk to a thumbnail on a deck card. A thumbnail is the real slide laid out 1000px wide and scaled down, so covers
   show what the deck actually looks like instead of an empty box. */
export function SlideFace({slide,footer,number,renderVisual,children}:{slide:Slide;footer?:string;number?:number;renderVisual:(type:string)=>ReactNode;children?:ReactNode}) {
  return <div className={slide.visual==='uploaded-slide'?'slide-content imported-content':'slide-content'}>
    <div className="slide-kicker">{slide.kicker}</div>
    <h2>{slide.title}</h2>
    <p className="slide-body">{slide.body}{children}</p>
    {slide.image?<img className="slide-upload" src={slide.image} alt={slide.title}/>:renderVisual(slide.visual)}
    {slide.detail&&<div className="slide-takeaway"><span>↳</span>{slide.detail}</div>}
    {number!==undefined&&<footer><span>{footer||'LIVEBOARD'}</span><span>{String(number+1).padStart(2,'0')}</span></footer>}
  </div>;
}

export function SlideThumb({slide,renderVisual}:{slide:Slide;renderVisual:(type:string)=>ReactNode}) {
  const box=useRef<HTMLDivElement>(null);
  useEffect(()=>{
    const el=box.current;if(!el)return;
    const fit=()=>el.style.setProperty('--k',String(el.clientWidth/1000));
    fit();const ro=new ResizeObserver(fit);ro.observe(el);return()=>ro.disconnect();
  },[]);
  return <div className="slide-thumb" ref={box} aria-hidden="true"><div className="slide-thumb-inner slide-canvas"><SlideFace slide={slide} renderVisual={renderVisual}/></div></div>;
}
