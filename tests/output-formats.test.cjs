const fs = require("node:fs");
const vm = require("node:vm");
const assert = require("node:assert/strict");
const path = require("node:path").posix;
const files = new Map(), prefs = new Map();
let serial = 0, reply = "", request, erased = 0, failWrite = false;
const context = {
  TextDecoder, Uint8Array, atob, btoa,
  PathUtils: { join: path.join, parent: path.dirname, tempDir: "/tmp" },
  IOUtils: {
    makeDirectory: async () => {},
    writeUTF8: async (p, s) => files.set(p, new TextEncoder().encode(s)),
    write: async (p, bytes) => { if (failWrite) throw Error("disk full"); files.set(p, bytes); },
    read: async p => { if (!files.has(p)) throw Error("missing " + p); return files.get(p); },
    remove: async () => {}
  },
  Zotero: {
    Prefs: { get: k => prefs.get(k), set: (k, v) => prefs.set(k, v) },
    debug: () => {}, logError: () => {},
    Attachments: { importFromFile: async options => {
      const p = "/storage/" + (++serial) + "/" + path.basename(options.file);
      files.set(p, files.get(options.file));
      return { ...options, isAttachment: () => true, attachmentContentType: options.contentType,
        getTags: () => [{tag:"#MinerU-Parse"}], getFilePath: async () => p,
        addTag: () => {}, saveTx: async () => {}, eraseTx: async () => { erased++; } };
    } }
  },
  fetch: async (_u, options) => {
    request = JSON.parse(options.body);
    return { ok: true, json: async () => ({ choices: [{message:{content:reply}}] }) };
  }
};
vm.createContext(context);
vm.runInContext(fs.readFileSync("mineru.js", "utf8"), context);
vm.runInContext(fs.readFileSync("preferences.js", "utf8"), context);
const m = context.ZoteroMineru, panel = context.ZoteroMineruPreferences;
m.mathRenderer = require("../vendor/katex/katex.min.js");
m.withTimeout = fn => fn();
const image = {marker:"zotero-mineru-image://img-1", mimeType:"image/png", fileName:"a.png",
 bytes:Uint8Array.from([137,80,78,71]), dataURI:"data:image/png;base64,iVBORw=="};
const markdown = "# 标题\n\nText **bold** ![图](" + image.marker + ")\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n$$\nx+y\n\n=z\n$$\n\n~~~js\nconst x = 1;\n\nx++;\n~~~";
async function run() {
 const brokenEquation = String.raw`$$x=1\tag{ð<sup>12</sup>Þ}$$`;
 const fixedEquation = m.renderDocumentBody(brokenEquation);
 assert(fixedEquation.includes('<mtext>(12)</mtext>'));
 assert(!fixedEquation.includes('ð'));
 assert.equal(m.normalizeEquationNumbers('ð<sup>7</sup>Þ'), '(7)');
 assert.equal(m.normalizeEquationNumbers('Text ð and Þ; author<sup>12</sup>'), 'Text ð and Þ; author<sup>12</sup>');
 assert.equal(m.normalizeEquationNumbers(String.raw`\tag{14}`),String.raw`\tag{14}`);
 const embeddedForms = [
  '![图](' + image.dataURI + ')',
  '![图][ref]\n\n[ref]: ' + image.dataURI,
  '<img src=' + image.dataURI + '>',
  '&lt;img src="' + image.dataURI + '"&gt;'
 ];
 for (const source of embeddedForms) {
  const prepared = await m.inlineStoredImagesInMarkdownAttachment({markdownText:source,markdownPath:'/source.md'});
  assert(!prepared.markdownText.includes('base64'));
  assert(prepared.markdownText.includes(image.marker));
  assert.equal(prepared.embeddedImages.length,1);
  reply=JSON.stringify(m.prepareTranslationText(prepared.markdownText).texts);
  await m.callLLMForTranslation(prepared.markdownText,'中文',{},1,1);
  assert(!JSON.stringify(request || {}).includes('base64'));
 }
 const previousRequest=request;
 assert.equal(await m.callLLMForTranslation('![图]('+image.dataURI+')','中文',{},1,1),'![图]('+image.dataURI+')');
 assert.equal(request,previousRequest);
 reply=image.dataURI;
 await assert.rejects(()=>m.callLLMForTranslation('text','中文',{},1,1),/图片数据/);
 for (const input of ['Author<sup>a,b</sup>', String.raw`Author\<sup>a,b\</sup>`, 'Author&lt;sup&gt;a,b&lt;/sup&gt;']) {
  assert(m.renderDocumentBody(input).includes('Author<sup>a,b</sup>'));
 }
 assert(m.renderDocumentBody('H<sub>2</sub>O<br/>line').includes('H<sub>2</sub>O<br>line'));
 assert(m.renderDocumentBody('<sup onclick="alert(1)">a</sup>').includes('<sup>a</sup>'));
 assert(!m.renderDocumentBody('<script>alert(1)</script>').includes('<script>'));
 assert(m.renderDocumentBody('`<sup>a</sup>`').includes('<code>&lt;sup&gt;a&lt;/sup&gt;</code>'));
 assert(!m.renderDocumentBody('```html\n<sup>a</sup>\n```').includes('<sup>'));
 // img-1 must not replace the prefix of img-10 or img-100.
 const manyImages = Array.from({length:101}, (_, i) => ({...image, marker:'zotero-mineru-image://img-' + (i+1), mimeType:'image/jpeg', fileName:'source.jpg', bytes:Uint8Array.from([i+1])}));
 const manyMarkdown = [1,10,11,100,101].map(n => '![图](' + manyImages[n-1].marker + ')').join('\n') + '\n<img src="' + manyImages[9].marker + '">';
 for (const format of ['md','html']) for (const imageMode of ['folder','inline']) {
  const item = await m.saveDocumentAttachment({libraryID:1,title:'多图回归',markdown:manyMarkdown,images:manyImages,format,imageMode,tag:'#MinerU-Parse'});
  const p = await item.getFilePath();
  const restored = m.decodeDocumentMarkdown(new TextDecoder().decode(files.get(p)),p);
  for (const n of [1,10,11,100,101]) {
   const expected = (format === 'md' || imageMode === 'folder') ? 'images/image-' + n + '.jpg' : 'data:image/jpeg;base64,' + m.bytesToBase64(manyImages[n-1].bytes);
   assert(restored.includes('(' + expected + ')'));
   if ((format === 'md' || imageMode === 'folder')) assert.equal(files.get(path.join(path.dirname(p),expected))[0],n);
  }
  assert(!restored.includes('.jpg0'));
 }
 for (const formula of [String.raw`$\frac{a}{b}$`, String.raw`$$\sum_{i=1}^{n} i$$`, String.raw`\(x^2\)`, String.raw`\[\int_0^1 x\,dx\]`]) {
  const html = m.renderDocumentBody(formula);
  assert(html.includes("<math"), formula);
  assert(!html.includes('class="math"'), formula);
 }
 assert(!m.renderDocumentBody('`$x$`').includes('<math'));
 assert(!m.renderDocumentBody('```tex\n$x$\n```').includes('<math'));
 assert(m.renderDocumentBody(String.raw`$\invalidcommand{$`).includes('katex-error'));
 for (const tag of ["#MinerU-Parse","#MinerU-Translation"]) {
  for (const format of ["md","html"]) for (const imageMode of ["folder","inline"]) {
   const item = await m.saveDocumentAttachment({libraryID:1,title:"测试",markdown,images:[image],format,imageMode,tag});
   const p = await item.getFilePath(), content = new TextDecoder().decode(files.get(p));
   assert.equal(item.contentType, format === "html" ? "text/html" : "text/markdown");
   assert.equal(p.endsWith("."+format), true);
   const restored = m.decodeDocumentMarkdown(content, p);
   assert(restored.includes(format === "html" && imageMode === "inline" ? image.dataURI : "images/image-1.png"));
   assert.equal(files.has(path.join(path.dirname(p),"images/image-1.png")),format === "md" || imageMode === "folder");
   assert(m.isMineruParseMarkdownAttachment(item));
   const source = await m.inlineStoredImagesInMarkdownAttachment({markdownText:restored,markdownPath:p});
   assert.equal(source.embeddedImages.length,1);
   assert(source.markdownText.includes(image.marker));
   assert(!source.markdownText.includes("base64"));
   const note = await m.buildParsedResultFromMarkdownAttachment(item,{includeImages:true});
   assert.equal(note.embeddedImages.length,1);
   assert(!m.removeLocalImageReferences(restored).includes("base64"));
   if(format==="html") {
    assert(content.includes('<meta charset="utf-8">'));
    assert(content.includes('<img src="'));
    assert(content.includes("<table"));
    assert(content.includes("<math"));
   }
  }
 }
 for(const imageMode of ["folder","inline"]) {
  const item=await m.saveDocumentAttachment({libraryID:1,title:"对照",markdown,images:[image],format:"html",imageMode,tag:"#MinerU-Translation",
   pairs:[{id:"block-1",source:"原文",translated:"译文"}]});
  const content=new TextDecoder().decode(files.get(await item.getFilePath()));
  assert(content.includes('data-block="block-1"'));
  assert(content.indexOf("原文</p>")<content.indexOf("译文</p>"));
 }
 const blocks=m.splitTranslationBlocks(markdown);
 assert.equal(blocks.length,5);
 assert(blocks[3].includes("\n\n=z"));
 assert(blocks[4].includes("\n\nx++"));
 assert.equal(m.splitMarkdownIntoChunks(markdown,5).length,5);
 await assert.rejects(()=>m.saveDocumentAttachment({libraryID:1,title:"missing",markdown:"![x](missing.png)"}),/图片/);
 await assert.rejects(()=>m.inlineStoredImagesInMarkdownAttachment({markdownText:"![x](missing.png)",markdownPath:"/storage/doc.md"}),/图片读取失败/);
 failWrite=true;
 await assert.rejects(()=>m.saveDocumentAttachment({libraryID:1,title:"fail",markdown,images:[image]}),/disk full/);
 failWrite=false; assert.equal(erased,1);
 const settings={outputFormat:"html",translationMode:"bilingual",apiBaseURL:"https://test",model:"test"};
 reply=JSON.stringify(["译文"]);
 assert((await m.callLLMForTranslation("Text ![图]("+image.marker+")","中文",settings,1,1)).includes("译文"));
 assert(!JSON.stringify(request).includes("base64"));
 assert(!JSON.stringify(request).includes(image.marker));
 reply="译文";
 assert.equal(await m.callLLMForTranslation("Text","中文",settings,1,1),"译文");
 reply="translation";
 assert.equal(await m.callLLMForTranslation("![图]("+image.marker+")","中文",{},1,1),"![图]("+image.marker+")");
 // Multiple image boundaries are batched in ONE request; images never leave the client.
 const imageText='Before ![one]('+image.marker+') middle <img src="'+image.marker+'"> after';
 reply=JSON.stringify(['前','中','后']);
 const restoredImages=await m.callLLMForTranslation(imageText,'中文',{},1,1);
 assert.equal(restoredImages,'前 ![one]('+image.marker+') 中 <img src="'+image.marker+'"> 后');
 assert.deepEqual(JSON.parse(request.messages[1].content),['Before','middle','after']);
 assert(!JSON.stringify(request).includes(image.marker));assert(!JSON.stringify(request).includes('<img'));
 reply=JSON.stringify(['缺失']);
 await assert.rejects(()=>m.callLLMForTranslation(imageText,'中文',{},1,1),/分片数量/);
 reply='invalid';await assert.rejects(()=>m.callLLMForTranslation(imageText,'中文',{},1,1),/分片返回格式/);
 const result=await m.translateChunksWithConcurrency({chunks:["A","B"],concurrency:2,autoRetryCount:1,
  translateChunk:async(text,i)=>{ if(i===0&&!run.retried){run.retried=true;throw Error("retry");}return text+" translated"; }});
 assert.equal(result.failures.length,0); assert.equal(result.successes.get(0),"A translated");
 const inputs=new Map(panel.FIELDS.map(f=>[f.id,{value:f.type==="int"?"1":"",checked:false}]));
 panel.$=id=>inputs.get(id); inputs.set("mineru-bilingual-option",{disabled:false});
 inputs.get("mineru-translateOutputFormat").value="html";
 inputs.get("mineru-translateMode").value="bilingual"; panel.saveSettings();
 assert.equal(m.getOutputSettings("translate").translationMode,"bilingual");
 inputs.get("mineru-translateOutputFormat").value="md"; panel.saveSettings();
 assert.equal(inputs.get("mineru-translateMode").value,"bilingual");
 assert.equal(inputs.get("mineru-translateMode").disabled,true);
 assert.equal(inputs.get("mineru-bilingual-option").disabled,true);
 panel.loadSettings(); assert.equal(inputs.get("mineru-translateOutputFormat").value,"md");

 // Parsed HTML registers once and retains a folder-based companion Markdown.
 for (const imageMode of ["folder", "inline"]) {
  const before = serial;
  const item = await m.saveDocumentAttachment({libraryID:1,title:"parse",markdown,images:[image],format:"html",imageMode,keepMarkdown:true,tag:"#MinerU-Parse"});
  assert.equal(serial,before+1);
  const htmlPath=await item.getFilePath(), mdPath=htmlPath.replace(/\.html$/,'.md');
  const md=new TextDecoder().decode(files.get(mdPath));
  assert(md.includes('images/image-1.png')); assert(!md.includes('base64'));
  assert(files.has(path.join(path.dirname(mdPath),'images/image-1.png')));
 }
 // Exercise the full translation loop, including repeated retries and partial output.
 const saved=[], descriptions=[], alerts=[];
 const originalCollect=m.collectTranslateTasks, originalCall=m.callLLMForTranslation;
 const originalConfirm=m.confirmRetryFailedChunks;
 const originalSave=m.saveTranslationAsMarkdownAttachment;
 const sourceAttachment={getFilePath:()=>'/source.md',getField:()=> 'source'};
 files.set('/source.md',new TextEncoder().encode('A\n\nB'));
 const parent={id:1,libraryID:1,getField:()=> 'Paper'};
 m.getLLMSettings=()=>({apiBaseURL:'https://test',apiKey:'test',model:'test',outputFormat:run.format||'md',translationMode:run.bilingual?'bilingual':'translation',translateChunkSize:run.chunkSize||1,translateRetryCount:1});
 m.collectTranslateTasks=()=>Array.from({length:run.taskCount||1},()=>({parentItem:parent,mineruSource:sourceAttachment}));
 context.Zotero.ProgressWindow=function(){this.ItemProgress=function(){this.setText=()=>{};this.setProgress=()=>{};this.setError=()=>{}};this.changeHeadline=()=>{};this.show=()=>{};this.addDescription=t=>descriptions.push(t);this.startCloseTimer=()=>{}};
 m.showAlert=(_w,_t,msg)=>alerts.push(msg);
 m.saveTranslationAsMarkdownAttachment=async args=>{saved.push(args);return originalSave.call(m,args)};
 let calls=[],actions=[];
 m.callLLMForTranslation=async text=>{calls.push(text);if(text==='B'&&run.fail)throw Error('failed B');return 'translated '+text};
 m.confirmRetryFailedChunks=()=>actions.shift()||'discard';
 for (const format of ['md','html']) for (const bilingual of [false,true]) {
  if(format==='md'&&bilingual)continue;
  run.format=format;run.bilingual=bilingual;run.fail=true;calls=[];actions=['retry','save'];saved.length=0;
  await m.handleTranslateCommand();
  assert.equal(saved.length,1);assert.equal(saved[0].partial.completed,1);
  assert.equal(calls.filter(t=>t==='A').length,1);assert.equal(calls.filter(t=>t==='B').length,4);
  assert(saved[0].translatedText.includes('未翻译\n\nB'));
  if(bilingual)assert.equal(saved[0].pairs[1].translated,'**未翻译**');
  const output=[...files.entries()].filter(([p])=>p.startsWith('/storage/'+serial+'/')&&p.endsWith('.'+format))[0];
  const content=new TextDecoder().decode(output[1]);assert(content.includes('未完成'));assert(content.includes('1/2'));
 }
 run.format='md';run.bilingual=false;run.fail=true;actions=['discard'];saved.length=0;
 await m.handleTranslateCommand();assert.equal(saved.length,0);
 m.confirmRetryFailedChunks=()=>{run.fail=false;return 'retry'};calls=[];saved.length=0;
 await m.handleTranslateCommand();assert.equal(saved[0].partial,null);assert.equal(calls.filter(t=>t==='A').length,1);
 // Partial save does not stop the next document.
 run.fail=true;run.taskCount=2;actions=['save','save'];saved.length=0;
 m.confirmRetryFailedChunks=()=>actions.shift();
 await m.handleTranslateCommand();assert.equal(saved.length,2);assert(descriptions.some(t=>t.includes('部分保存 2/2')));

 // All chunks fail: nothing is saved, and the UI receives zero completed chunks.
 run.taskCount=1;saved.length=0;
 m.callLLMForTranslation=async()=>{throw Error('all failed')};
 m.confirmRetryFailedChunks=(_w,info)=>{assert.equal(info.completed,0);return 'discard'};
 await m.handleTranslateCommand();assert.equal(saved.length,0);
 // Reading an HTML main attachment uses its sibling Markdown, never its HTML body.
 sourceAttachment.getFilePath=()=>'/source.html';
 files.set('/source.html',new TextEncoder().encode('<html>SHOULD NOT TRANSLATE</html>'));
 calls=[];m.callLLMForTranslation=async text=>{calls.push(text);return 'translated '+text};
 await m.handleTranslateCommand();assert.deepEqual(calls,['A','B']);
 sourceAttachment.getFilePath=()=>'/source.md';
 // Bilingual layout uses the same chunk budget as Markdown, not one request per paragraph.
 const longMarkdown=Array.from({length:217},(_,i)=>`Paragraph ${i} `+'x'.repeat(80)).join('\n\n');
 files.set('/source.md',new TextEncoder().encode(longMarkdown));run.chunkSize=1500;
 let requestCounts=[];
 for(const format of ['md','html']) {
  run.format=format;run.bilingual=format==='html';calls=[];
  await m.handleTranslateCommand();requestCounts.push(calls.length);
 }
 assert.equal(requestCounts[0],requestCounts[1]);assert(requestCounts[1]<20);
 files.set('/source.md',new TextEncoder().encode('A\n\nB'));
 run.chunkSize=1;run.format='md';run.bilingual=false;
 // Failure while saving a partial attachment is reported, not counted as saved.
 m.callLLMForTranslation=async text=>{if(text==='B')throw Error('failed');return text};
 m.confirmRetryFailedChunks=()=> 'save';
 m.saveTranslationAsMarkdownAttachment=async()=>{throw Error('disk full')};
 const alertCount=alerts.length;await m.handleTranslateCommand();
 assert.equal(alerts.length,alertCount+1);assert(alerts.at(-1).includes('disk full'));
 m.saveTranslationAsMarkdownAttachment=originalSave;
 // Native prompt exposes save only when some chunks succeeded; closing cancels.
 let promptArgs, button=2;
 context.Services={prompt:{BUTTON_POS_0:1,BUTTON_POS_1:256,BUTTON_POS_2:65536,BUTTON_TITLE_IS_STRING:127,
 confirmEx:(...args)=>{promptArgs=args;return button}}};
 const failure={chunkIndex:0,totalChunks:2,attempts:2,error:'failed'};
 assert.equal(originalConfirm.call(m,null,{title:'T',failures:[failure],completed:1,total:2}),'save');
 assert.equal(promptArgs[6],'保存已完成译文');
 assert.equal(originalConfirm.call(m,null,{title:'T',failures:[failure],completed:0,total:2}),'discard');assert.equal(promptArgs[6],null);
 button=1;assert.equal(originalConfirm.call(m,null,{title:'T',failures:[failure],completed:1}),'discard');
 // Partial tags do not count as completed translations.
 const source={isAttachment:()=>true,getTags:()=>[{tag:'#MinerU-Parse'}]};
 const partial={isAttachment:()=>true,getTags:()=>[{tag:'#MinerU-Translation-Partial'}]};
 const parentForCollection={id:9,isNote:()=>false,isRegularItem:()=>true,getAttachments:()=>[1,2]};
 context.Zotero.Items={get:id=>id===1?source:partial};
 assert.equal(originalCollect.call(m,[parentForCollection]).length,1);
 // Explicitly selected parse attachment wins even when the parent is selected first.
 const chosen={parentItemID:9,isNote:()=>false,isRegularItem:()=>false,isAttachment:()=>true,getTags:()=>[{tag:'#MinerU-Parse'}]};
 context.Zotero.Items.get=id=>id===9?parentForCollection:id===1?source:partial;
 assert.equal(originalCollect.call(m,[parentForCollection,chosen])[0].mineruSource,chosen);
 // Summary uses sibling Markdown rather than HTML or embedded source metadata.
 const originalSummaryCollect=m.collectSummaryTasks;
 parentForCollection.getNotes=()=>[];
 assert.equal(originalSummaryCollect.call(m,[parentForCollection,chosen])[0].mineruSource,chosen);
 sourceAttachment.getFilePath=()=>'/source.html';
 files.set('/source.md',new TextEncoder().encode('# Original Markdown\n\nUnique source text.'));
 m.collectSummaryTasks=()=>[{parentItem:parent,mineruSource:sourceAttachment,mineruSourceType:'attachment'}];
 let summaryInput=null,summarySaved=false;
 m.callLLMForSummary=async text=>{summaryInput=text;return 'Summary'};
 m.saveSummaryAsNote=async()=>{summarySaved=true};
 await m.handleSummaryCommand();
 assert.equal(summaryInput,'# Original Markdown\n\nUnique source text.');assert(summarySaved);
 files.delete('/source.md');summaryInput=null;summarySaved=false;
 await m.handleSummaryCommand();assert.equal(summaryInput,null);assert.equal(summarySaved,false);
 assert(alerts.at(-1).includes('原始 Markdown'));
 m.callLLMForTranslation=originalCall;
 console.log("PASS: parse companions, Markdown-only requests, output/image roundtrips, partial saves, retry/discard, batch continuation, settings and rollback.");

}
run().catch(error=>{console.error(error);process.exitCode=1;});
