'use client';

/* Where a student lands: a name, the code from the board, and in. */
export default function WaitingRoom({code,setCode,name,setName,onJoin,busy}:{code:string;setCode:(v:string)=>void;name:string;setName:(v:string)=>void;onJoin:()=>void;busy:boolean;onFullscreen?:()=>void}) {
 return <main className="waiting-room">
   <header><span className="brand"><span className="brandmark"><i/><i/><i/></span>LiveBoard</span></header>
   <section className="join-card"><span className="eyebrow">JOIN YOUR CLASS</span><h1>Your lesson starts here.</h1><p>Enter the code your teacher is showing. You’ll see the slides and can drop a marker on anything you want explained.</p>
   <form onSubmit={event=>{event.preventDefault();onJoin()}}>
     <label>Your name<input value={name} maxLength={40} onChange={event=>setName(event.target.value)} placeholder="First name or nickname"/></label>
     <label>Lesson code<input autoComplete="off" autoCapitalize="characters" value={code} maxLength={8} onChange={event=>setCode(event.target.value.toUpperCase())} placeholder="8-character code"/></label>
     <button className="primary" disabled={busy||code.trim().length!==8}>{busy?'Joining…':'Join lesson'}</button>
   </form></section>
 </main>;
}
