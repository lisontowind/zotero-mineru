const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');
const prefs = new Map(), db = new Map();
let active = false, fail = null, count = 0, serial = 10;
const ctx = {Zotero:{Prefs:{get:k=>prefs.get(k),set:(k,v)=>prefs.set(k,v)},logError:()=>{},
DB:{executeTransaction:async fn=>{
const snapshot = new Map(db); active=true;
try {await fn();} catch(e) {db.clear(); for(const [k,v] of snapshot) db.set(k,v); throw e;} finally {active=false;}
}}}};
vm.createContext(ctx);
for(const f of ['mineru.js','preferences.js']) vm.runInContext(fs.readFileSync(f,'utf8'),ctx);
const m=ctx.ZoteroMineru,p=ctx.ZoteroMineruPreferences;
function item(id) {
db.set(id,[]);
return {id,libraryID:1,related:new Set(),getField:()=> 'same',getFilePath:()=>'/same.pdf',
addRelatedItem(other){if(this.related.has(other.id))return false;this.related.add(other.id);return true;},
async save(){assert(active);if(id===fail)throw Error('save failed');count++;db.set(id,[...this.related]);},
async reload(types,force){assert.equal(types[0],'relations');assert(force);this.related=new Set(db.get(id));}};
}
async function run(){
assert.equal(m.getSettings().parseLinkSourcePDF,true);
const input={checked:false};p.$=id=>id==='mineru-parseLinkSourcePDF'?input:null;
p.loadSettings();assert(input.checked);
input.checked=false;p.saveSettings({silent:true});assert.equal(m.getSettings().parseLinkSourcePDF,false);
p.loadSettings();assert.equal(input.checked,false);
input.checked=true;p.saveSettings({silent:true});assert(m.getSettings().parseLinkSourcePDF);
const a=item(1),b=item(2);a.related.add(99);db.set(1,[99]);
await m.linkParseSource(a,b);assert.deepEqual(db.get(1),[99,2]);assert.deepEqual(db.get(2),[1]);
const before=count;await m.linkParseSource(a,b);assert.equal(count,before);
const c=item(3);fail=3;await assert.rejects(m.linkParseSource(a,c),/save failed/);
assert.deepEqual(db.get(1),[99,2]);assert.deepEqual(db.get(3),[]);
assert.deepEqual([...a.related],[99,2]);assert.equal(c.related.size,0);fail=null;
let options;m.saveDocumentAttachment=async o=>{options=o;return item(++serial);};
const parent={id:5,addTag(){},async saveTx(){}};
for(const format of ['md','html'])for(const source of [a,b]){
const r=await m.saveResultAsMarkdownAttachment({attachment:source,parentItem:parent,parsedResult:{markdownText:'text'},settings:{outputFormat:format}});
assert.equal(r.warning,null);assert.deepEqual(db.get(r.attachment.id),[source.id]);assert.equal(options.format,format);assert.equal(options.parentItem,parent);
}
let r=await m.saveResultAsMarkdownAttachment({attachment:a,parsedResult:{markdownText:'text'},settings:{parseLinkSourcePDF:false}});
assert.deepEqual(db.get(r.attachment.id),[]);assert.equal(options.parentItem,undefined);
fail=serial+1;r=await m.saveResultAsMarkdownAttachment({attachment:a,parsedResult:{markdownText:'text'},settings:{}});
assert.equal(r.warning,'解析附件已保存，但关联失败');assert(db.has(r.attachment.id));assert.deepEqual(db.get(r.attachment.id),[]);
fail=null;r=await m.saveResultAsMarkdownAttachment({attachment:b,parsedResult:{markdownText:'text'},settings:{}});
assert.equal(r.warning,null);assert.deepEqual(db.get(r.attachment.id),[b.id]);
console.log('Related items tests passed');
}
run().catch(e=>{console.error(e);process.exitCode=1;});
