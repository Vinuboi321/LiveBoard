import { env } from 'cloudflare:workers';
const json=(v:unknown,status=200)=>Response.json(v,{status,headers:{'Cache-Control':'no-store'}});
export async function GET(req:Request){
 const params=new URL(req.url).searchParams;const id=params.get('id');if(!id)return json({error:'Enter a room code.'},400);
 try{const db=env.DB!; const room:any=await db.prepare('SELECT id,secret,title,slides,current,until FROM rooms WHERE id=?').bind(id.toUpperCase()).first(); if(!room)return json({error:'Room not found. Check the code with your teacher.'},404);
 const teacher=req.headers.get('authorization')===`Bearer ${room.secret}`;
 const participant=req.headers.get('x-participant')||'';
 const projector=params.get('view')==='projector';
 delete room.secret;
 const imageId=params.get('screenshot');
 if(imageId){
   const row=await db.prepare('SELECT screenshot FROM markers WHERE room=? AND id=?').bind(room.id,imageId).first<{screenshot:string|null}>();
   if(!row?.screenshot)return json({error:'Screenshot not found.'},404);
   const bytes=Uint8Array.from(atob(row.screenshot.split(',')[1]),c=>c.charCodeAt(0));
   return new Response(bytes,{headers:{'Content-Type':'image/jpeg','Cache-Control':'private, max-age=3600'}});
 }
 const marks=await db.prepare('SELECT id,owner,room,slide,x,y,kind,author,body,resolved,created,region,screenshot IS NOT NULL AS has_screenshot FROM markers WHERE room=? ORDER BY created').bind(room.id).all();const replies=await db.prepare('SELECT r.* FROM replies r JOIN markers m ON m.id=r.marker WHERE m.room=? ORDER BY r.created').bind(room.id).all();const permitted=marks.results.filter(m=>teacher&&!projector || m.author==='Teacher' || !projector&&participant&&m.owner===participant);
 const ids=new Set(permitted.map(m=>m.id));
 return json({...room,slides:JSON.parse(room.slides).map((s:any)=>teacher&&!projector?s:{...s,notes:''}),markers:permitted.map(m=>({...m,owner:undefined,screenshot:m.has_screenshot?'/api/rooms?'+new URLSearchParams({id:room.id,screenshot:String(m.id)}):undefined,region:typeof m.region==="string"?JSON.parse(m.region):null})),replies:projector?[]:replies.results.filter(r=>ids.has(r.marker))});}catch{return json({error:'Unable to load the classroom. Please try again.'},503)}
}
export async function POST(req:Request){
 try {if(req.headers.get('origin') && new URL(req.headers.get('origin')!).host!==new URL(req.url).host)return json({error:'Invalid origin'},403);
 if(Number(req.headers.get('content-length')||0)>6000000)return json({error:'Lesson is too large.'},413);
 const participant=req.headers.get('x-participant')?.slice(0,100)||null;const b:any=await req.json();const db=env.DB!;const clean=(s:any,n=2000)=>typeof s==='string'?s.trim().slice(0,n):'';
 if(b.action==='create') {if(!Array.isArray(b.slides)||!b.slides.every((s:any)=>s&&['title','kicker','body','detail','visual','notes'].every(k=>typeof s[k]==='string')&&(!s.image||/^data:image\/(png|jpeg|webp);base64,/.test(s.image)))||!b.slides.length||b.slides.length>40||JSON.stringify(b.slides).length>5000000)return json({error:'Use 1–40 slides, under 5 MB.'},400);
 const id=crypto.randomUUID().replace(/-/g,'').slice(0,8).toUpperCase(),secret=crypto.randomUUID();await db.prepare('INSERT INTO rooms (id,secret,title,slides,current,until,created) VALUES (?,?,?,?,0,0,?)').bind(id,secret,clean(b.title,100)||'Untitled lesson',JSON.stringify(b.slides),Date.now()).run();return json({id,secret});}
 const room:any=await db.prepare('SELECT * FROM rooms WHERE id=?').bind(clean(b.room,20)).first();if(!room)return json({error:'Room not found'},404);
 const teacher=req.headers.get('authorization')===`Bearer ${room.secret}`;
 if(['control','resolve','edit'].includes(b.action)&&!teacher)return json({error:'Only the host can do this.'},403);
 if(b.action==='control'){const count=JSON.parse(room.slides).length;const current=Number.isInteger(b.current)?Math.max(0,Math.min(count-1,b.current)):room.current;const until=b.duration===undefined?room.until:(Number(b.duration)>0?Date.now()+Math.min(900,Number(b.duration))*1000:0);await db.prepare('UPDATE rooms SET current=?,until=? WHERE id=?').bind(current,until,room.id).run();}
 else if(b.action==='marker'){if(!['question','explain','idea'].includes(b.kind)||!clean(b.body))return json({error:'Write your request first.'},400);if(!Number.isInteger(b.slide)||b.slide<0||b.slide>=JSON.parse(room.slides).length||!Number.isFinite(b.x)||!Number.isFinite(b.y))return json({error:'Select a spot on the slide.'},400);const total:any=await db.prepare('SELECT count(*) n FROM markers WHERE room=?').bind(room.id).first();if(total.n>=500)return json({error:'This room has reached its marker limit.'},400);const region = b.region;
 if (region && (![region.left,region.top,region.width,region.height].every(Number.isFinite) || region.left<0 || region.top<0 || region.width<=0 || region.height<=0 || region.left+region.width>100.001 || region.top+region.height>100.001)) return json({error:'Select a region inside the slide.'},400);
 const screenshot = b.screenshot;
 if (screenshot && (!region || typeof screenshot!=='string' || screenshot.length>250000 || !/^data:image\/jpeg;base64,[A-Za-z0-9+/]+=*$/.test(screenshot))) return json({error:'Invalid slide screenshot.'},400);
 const id = crypto.randomUUID();
 await db.prepare('INSERT INTO markers (id,room,slide,x,y,kind,author,body,resolved,created,region,screenshot,owner) VALUES (?,?,?,?,?,?,?,?,0,?,?,?,?)').bind(id,room.id,b.slide,Math.max(2,Math.min(98,b.x)),Math.max(2,Math.min(98,b.y)),b.kind,teacher?'Teacher':(clean(b.author,40).toLowerCase()==='teacher'?'Student':clean(b.author,40))||'Student',clean(b.body),Date.now(),region?JSON.stringify({left:region.left,top:region.top,width:region.width,height:region.height}):null,screenshot||null,participant).run();return json({id});}
 else if(b.action==='resolve'){await db.prepare('UPDATE markers SET resolved=? WHERE id=? AND room=?').bind(b.resolved?1:0,clean(b.id,50),room.id).run();}
 else if(b.action==='reply'){const marker=await db.prepare('SELECT id,author,owner FROM markers WHERE id=? AND room=?').bind(clean(b.id,50),room.id).first();if(!marker||!teacher&&marker.author!=='Teacher'&&(!participant||marker.owner!==participant))return json({error:'Marker not found'},404);if(!clean(b.body)&&!b.image)return json({error:'Add a response or image.'},400);const image=typeof b.image==='string'&&(/^https:\/\/(upload|thumb)\.wikimedia\.org\//.test(b.image)||/^\/visuals\/commons-(0\.jpg|1\.jpg|2\.gif)$/.test(b.image))?b.image:null;const source=typeof b.source==='string'&&/^https:\/\/(commons\.wikimedia\.org|[a-z]+\.wikipedia\.org)\//.test(b.source)?b.source:null;await db.prepare('INSERT INTO replies (id,marker,author,body,image,source,created) VALUES (?,?,?,?,?,?,?)').bind(crypto.randomUUID(),b.id,teacher?'Teacher':(clean(b.author,40).toLowerCase()==='teacher'?'Student':clean(b.author,40))||'Student',clean(b.body),image,source,Date.now()).run();}
 else return json({error:'Unknown action'},400);
 return json({ok:true});
 }catch{return json({error:'Could not save this change. Please try again.'},503)}
}
