import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import ts from 'typescript';
import assert from 'node:assert/strict';
const sqlite = new DatabaseSync(':memory:');
for (const migration of fs.readdirSync('drizzle').filter(name=>name.endsWith('.sql')).sort()) {
  sqlite.exec(fs.readFileSync('drizzle/'+migration,'utf8'));
}
globalThis.__testEnv = { DB: {
  prepare(sql) {
    return { bind(...args) {
      const statement = sqlite.prepare(sql);
      return {
        async first() { return statement.get(...args); },
        async all() { return { results: statement.all(...args) }; },
        async run() { return statement.run(...args); }
      };
    } };
  }
} };

let code=fs.readFileSync('app/api/rooms/route.ts','utf8').replace("import { env } from 'cloudflare:workers';",'const env=globalThis.__testEnv;');
const {GET,POST}=await import('data:text/javascript;base64,'+Buffer.from(ts.transpileModule(code,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText).toString('base64'));
const slide={title:'Test',kicker:'Test',body:'Test',detail:'Test',notes:'Test',visual:'reaction'};
const request=(data,token)=>new Request('https://test.local/api/rooms',{method:'POST',headers:{'Content-Type':'application/json','x-participant':'test-learner',...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify(data)});
let r=await POST(request({action:'create',slides:[slide,slide],title:'Test lesson'}));assert.equal(r.status,200);const room=await r.json();const post=(b,host=false)=>POST(request({room:room.id,...b},host?room.secret:undefined));
assert.equal((await post({action:'control',current:1})).status,403);
const mark={action:'marker',slide:0,x:50,y:50,kind:'question',author:'Learner',body:'Why?'};
assert.equal((await post(mark)).status,200);
assert.equal((await post({action:'control',current:1,duration:120},true)).status,200);
assert.equal((await post(mark)).status,200);
const get=async()=>await(await GET(new Request('https://test.local/api/rooms?id='+room.id,{headers:{Authorization:'Bearer '+room.secret}}))).json();
let state=await get();assert.equal(state.current,1);assert.equal(state.markers.length,2);assert.equal(state.secret,undefined);
const id=state.markers[0].id;
assert.equal((await post({action:'resolve',id,resolved:true})).status,403);
assert.equal((await post({action:'reply',id,body:'Rates balance.'},true)).status,200);
assert.equal((await post({action:'reply',id,body:'Impersonation test',author:'Teacher'})).status,200);
assert.equal((await post({action:'resolve',id,resolved:true},true)).status,200);
state=await get();assert.equal(state.markers[0].resolved,1);assert.equal(state.replies[0].author,'Teacher');assert.equal(state.replies[1].author,'Student');
assert.equal((await post({...mark,slide:99})).status,400);
assert.equal((await post({...mark,x:NaN})).status,400);
assert.equal((await post({action:'control',duration:0},true)).status,200);
assert.equal((await post(mark)).status,200);
assert.equal((await POST(request({action:'create',slides:[{oops:true}]}))).status,400);
const region={left:10,top:10,width:40,height:30};
const capture=await post({...mark,region,screenshot:'data:image/jpeg;base64,/9j/2Q=='});
assert.equal(capture.status,200);
const saved=await capture.json();
const regionMarker=(await get()).markers.find(marker=>marker.id===saved.id);
assert.deepEqual(regionMarker.region,region);
const screenshot=await GET(new Request('https://test.local'+regionMarker.screenshot));
assert.equal(screenshot.headers.get('Content-Type'),'image/jpeg');
assert.equal((await screenshot.arrayBuffer()).byteLength,4);
console.log('PASS: persistence, slide sync, question windows, host authorization, replies, resolution, author roles, invalid input, secret exclusion');

const studentState=await(await GET(new Request('https://test.local/api/rooms?id='+room.id,{headers:{'x-participant':'other-learner'}}))).json();
assert.equal(studentState.markers.length,0);
assert.equal(studentState.slides[0].notes,'');
const projectorState=await(await GET(new Request('https://test.local/api/rooms?id='+room.id+'&view=projector'))).json();
assert.equal(projectorState.markers.length,0);
assert.equal(projectorState.replies.length,0);
console.log('PASS: student marker isolation and projector filtering');
const teacherMarkResponse=await post({...mark,author:'Teacher',body:'Explore this example'},true);
const teacherMark=await teacherMarkResponse.json();
const learnerView=await(await GET(new Request('https://test.local/api/rooms?id='+room.id,{headers:{'x-participant':'other-learner'}}))).json();
assert.equal(learnerView.markers.length,1);
assert.equal(learnerView.markers[0].author,'Teacher');
assert.equal((await post({action:'reply',id:teacherMark.id,body:'I have a follow-up'})).status,200);
const projection=await(await GET(new Request('https://test.local/api/rooms?id='+room.id+'&view=projector'))).json();
assert.equal(projection.markers.length,1);
assert.equal(projection.replies.length,0);
console.log('PASS: teacher marker visibility and student interaction');
