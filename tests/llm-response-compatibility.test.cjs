const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const {test} = require('node:test');

const settings = {apiBaseURL:'https://llm.example/v1',apiKey:'TEST',model:'test'};
function harness(body) {
  const context = {
    URL, Headers, AbortController, Uint8Array, setTimeout, clearTimeout,
    Zotero: {locale:'en-US',debug() {},logError() {}},
    fetch: async () => ({
      ok:true,status:200,
      text:async()=>typeof body === 'string' ? body : JSON.stringify(body),
      json:async()=>body
    })
  };
  vm.createContext(context);
  for (const file of ['mineru.js','preferences.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname,'..',file),'utf8'),context);
  }
  return {m:context.ZoteroMineru,p:context.ZoteroMineruPreferences};
}
function operations(h) {
  return [
    () => h.m.callLLMForSummary('Source',settings,'English'),
    () => h.m.callLLMForTranslation('Source','English',settings,1,1),
    async () => (await h.p.sendLLMTestRequest({
      endpoint:settings.apiBaseURL+'/chat/completions',apiKey:settings.apiKey,payload:{model:settings.model}
    })).reply
  ];
}
const partial = 'data: {"choices":[{"index":0,"delta":{"content":"Partial"}}]}\n\n';
for (const [name,body] of [
  ['EOF without completion marker',partial],
  ['malformed event followed by DONE',partial+'data: {bad JSON}\n\ndata: [DONE]\n\n'],
  ['upstream error event',partial+'data: {"error":{"message":"overloaded"}}\n\n'],
  ['named SSE error event',partial+'event: error\ndata: {"message":"upstream failed"}\n\n'],
  ['truncated completion with DONE',partial+'data: {"choices":[{"index":0,"delta":{},"finish_reason":"length"}]}\n\ndata: [DONE]\n\n'],
  ['content after DONE',partial+'data: [DONE]\n\n'+partial]
]) {
  test('summary, translation and connection test reject '+name, async () => {
    for (const run of operations(harness(body))) {
      await assert.rejects(run(),error=>error.code==='LLM_INCOMPLETE');
    }
  });
}

test('SSE handles multiline events, CRLF, usage records and multiple choices',async () => {
  const body = [
    ': heartbeat','',
    'data: {"choices":[',
    'data: {"index":1,"delta":{"content":"Other answer"}},',
    'data: {"index":0,"delta":{"content":"Complete answer"}}]}','',
    'data: {"choices":[{"index":0,"delta":{},"finish_reason":"STOP"}]}','',
    'data: {"choices":[],"usage":{"total_tokens":2}}','',
    'data: [DONE]',''
  ].join('\r\n');
  for(const run of operations(harness(body))) assert.equal(await run(),'Complete answer');
});

test('SSE accepts explicit finish reasons and legacy DONE-only termination',async () => {
  for(const ending of [
    'data: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n',
    'data: [DONE]\n\n'
  ]) {
    for(const run of operations(harness(partial+ending))) assert.equal(await run(),'Partial');
  }
});

for(const [name,body] of [
  ['Gemini MAX_TOKENS',{candidates:[{finishReason:'MAX_TOKENS',content:{parts:[{text:'Truncated'}]}}]}],
  ['Gemini SAFETY',{candidates:[{finishReason:'SAFETY',content:{parts:[{text:'Partial'}]}}]}],
  ['Ollama unfinished response',{response:'Partial',done:false}],
  ['Ollama output limit',{response:'Partial',done:true,done_reason:'length'}]
]) {
  test('all LLM entry points reject '+name,async () => {
    for(const run of operations(harness(body))) {
      await assert.rejects(run(),error=>error.code==='LLM_INCOMPLETE');
    }
  });
}

test('native completed responses preserve every text part and exclude thinking',async () => {
  for(const body of [
    {candidates:[{finishReason:'STOP',content:{parts:[
      {thought:true,text:'Internal reasoning'},{text:'First '},{text:'second'}
    ]}}]},
    {choices:[{finish_reason:'end_turn',message:{content:[{type:'text',text:'First '},{type:'text',text:'second'}]}}]},
    {response:'First second',done:true,done_reason:'stop'}
  ]) {
    for(const run of operations(harness(body))) assert.equal(await run(),'First second');
  }
});

test('image-separated translation preserves code fences and quoted brackets in JSON strings',async () => {
  const marker='zotero-mineru-image://img-1';
  const source='Before image\n\n![Figure]('+marker+')\n\nAfter image';
  const translations=['Code:\n```python\nprint("array [1, 2]")\n```\nPath C:\\temp','Last paragraph [ok]'];
  const json=JSON.stringify(translations);
  for(const content of [json,'Here is [not JSON]:\n```json\n'+json+'\n```\nEnd [note]']) {
    const {m}=harness({choices:[{finish_reason:'stop',message:{content}}]});
    const result=await m.callLLMForTranslation(source,'English',settings,1,1);
    assert(result.includes(translations[0]));
    assert(result.includes(translations[1]));
    assert(result.includes(marker));
  }
});

test('connection test accepts valid JSON whose reply contains HTML markup',async () => {
  const content='Example <html> markup and <!DOCTYPE html>';
  for(const run of operations(harness({choices:[{finish_reason:'stop',message:{content}}]}))) {
    assert.equal(await run(),content);
  }
});
