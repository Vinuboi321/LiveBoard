const assert = require('node:assert/strict');
const Module = require('node:module');
const { buildSync } = require('esbuild');
const m = new Module('notes-model',module);m.paths=module.paths;m._compile(buildSync({entryPoints:['src/teacher/model.ts'],bundle:true,platform:'node',format:'cjs',write:false}).outputFiles[0].text,'notes-model.cjs');
const {validateMarkup,packWorksheet,unpackWorksheet}=m.exports;
const geometry = new Module('note-tools',module);geometry.paths=module.paths;geometry._compile(buildSync({entryPoints:['src/teacher/notetools.ts'],bundle:true,platform:'node',format:'cjs',write:false}).outputFiles[0].text,'note-tools.cjs');
const {insidePolygon,moveMarkup}=geometry.exports;
assert(insidePolygon({x:.3,y:.3},[{x:.1,y:.1},{x:.6,y:.1},{x:.6,y:.6},{x:.1,y:.6}]));
assert(!insidePolygon({x:.8,y:.3},[{x:.1,y:.1},{x:.6,y:.1},{x:.6,y:.6},{x:.1,y:.6}]));
const moving={id:'m',page:1,kind:'pen',color:'#123456',width:3,points:[{x:.8,y:.2},{x:.9,y:.3}]};
moveMarkup(moving,.5,-.5);assert(Math.abs(moving.points[1].x-1)<1e-10);assert(Math.abs(moving.points[0].y)<1e-10);

const examples=[{id:'s',page:1,kind:'shape',color:'#123456',width:3,shape:'ellipse',rects:[{x:.2,y:.3,width:.2,height:.1}]},{id:'img',page:1,kind:'image',color:'#123456',rects:[{x:.2,y:.3,width:.2,height:.1}],image:'data:image/png;base64,iVBORw0KGgo='},{id:'h',page:1,kind:'highlight',color:'#ffdd00',rects:[{x:.1,y:.2,width:.4,height:.02}]},{id:'p',page:1,kind:'pen',color:'#112233',width:5,points:[{x:.1,y:.1},{x:.2,y:.3}]},{id:'t',page:1,kind:'text',color:'#123456',x:.3,y:.4,text:'Teacher note',font:'cursive',size:24,bold:true,italic:true}];
assert.deepEqual(validateMarkup(examples),examples);
for(const bad of [{...examples[2],color:'url(evil)'},{...examples[3],width:100},{...examples[3],points:[{x:2,y:0}]},{...examples[4],font:'bad'},{...examples[4],text:'x'.repeat(10001)},{...examples[2],rects:[{x:.9,y:.2,width:.8,height:.1}]}])assert.throws(()=>validateMarkup([bad]));
(async()=>{const w={id:'w',title:'Note test',instructions:'',filename:'test.txt',sourceKind:'text',source:new Blob(['test']),hubs:[],markup:examples,ocr:{1:[{text:'cached',x:0,y:0,width:1,height:1}]},updatedAt:1};const packed=await packWorksheet(w);assert(!JSON.parse(packed).ocr);assert.deepEqual(unpackWorksheet(packed).markup,examples);console.log('PASS: annotation validation, pen bounds, font allowlist, note length, export/import, disposable OCR cache.');})().catch(e=>{console.error(e);process.exit(1);});
