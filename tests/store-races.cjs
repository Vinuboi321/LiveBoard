// Deterministic transaction-boundary tests: a local edit starts while sync is awaiting IndexedDB.
const { transformSync } = require('esbuild');
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const clone = x => x === undefined ? x : structuredClone(x);
const deferred = () => { let resolve; const promise = new Promise(r => resolve=r); return {promise,resolve}; };
class Table {
  constructor(){ this.rows=new Map(); this.hook=null; }
  async get(id){ return clone(this.rows.get(id)); }
  async put(row){this.rows.set(row.key||row.id,clone(row));if(this.hook)await this.hook();}
  async bulkPut(rows){for(const row of rows)this.rows.set(row.id,clone(row));if(this.hook)await this.hook();}
  async delete(id){this.rows.delete(id);}
}
class Dexie {
  constructor(){this.tail=Promise.resolve();for(const k of ['notes','markers','courses','meta','outbox'])this[k]=new Table();}
  version(){return {stores:()=>{for(const k of ['notes','markers','courses','meta','outbox'])this[k] ||= new Table();}};}
  transaction(...args){const cb=args.at(-1);const p=this.tail.then(cb);this.tail=p.catch(()=>{});return p;}
}
function store(){
  const output=transformSync(fs.readFileSync('src/store.ts','utf8'),{loader:'ts',format:'cjs'}).code;
  const module={exports:{}};
  vm.runInNewContext(output,{module,exports:module.exports,require:name=>name==='dexie'?Dexie:{COURSE_COLORS:['#123456'],DAY:86400000,uid:()=> 'id'},Date,Map,Set,console});
  return module.exports;
}
async function exercise(action){
  const s=store(), initial={id:'n',title:'Before',updatedAt:1,rev:1};
  s.state.notes.set('n',initial);await s.db.notes.put(initial);
  if(action==='ack'){s.state.pending.add('notes:n');await s.db.outbox.put({key:'notes:n',ver:1});}
  const paused=deferred(),release=deferred();
  s.db.notes.hook=async()=>{s.db.notes.hook=null;paused.resolve();await release.promise;};
  const sync=action==='ack'?s.ack('notes','n',1,2):s.applyRemote('notes',[{...initial,title:'Remote',rev:2}],action==='force');
  await paused.promise;
  const edit=s.putNote({...s.state.notes.get('n'),title:'Typed during sync'});
  release.resolve();await Promise.all([sync,edit]);
  assert.equal(s.state.notes.get('n').title,'Typed during sync',`${action}: memory keeps newer edit`);
  assert.equal((await s.db.notes.get('n')).title,'Typed during sync',`${action}: disk keeps newer edit`);
  assert(s.state.pending.has('notes:n'),`${action}: edit stays pending`);
  assert.equal((await s.db.notes.get('n')).rev,2,`${action}: queued write keeps acknowledged revision`);
  assert(await s.db.outbox.get('notes:n'),`${action}: edit remains queued`);
  await s.patchNote('n',{plain:'Next keystroke'});
  assert.equal((await s.db.notes.get('n')).title,'Typed during sync',`${action}: next edit cannot restore stale title`);
  console.log('ok  ',action,'preserves edits across transaction boundaries');
}
(async()=>{
  for(const action of ['ack','remote','force'])await exercise(action);
  const s=store(),note={id:'n',title:'Old content',updatedAt:1,rev:1,openedAt:1};
  s.state.notes.set('n',note);await s.db.notes.put(note);
  await s.recordOpened('n');
  assert.equal(s.state.pending.size,0,'opening does not queue a content upload');
  assert.equal(await s.db.outbox.get('notes:n'),undefined);
  await s.applyRemote('notes',[{...note,title:'New content from other device',updatedAt:2,rev:2}]);
  assert.equal(s.state.notes.get('n').title,'New content from other device');
  assert(s.state.notes.get('n').openedAt>1,'local recency survives the remote update');
  console.log('ok   opening an older note accepts newer remote content without a conflict');
})().catch(e=>{console.error(e);process.exit(1);});
