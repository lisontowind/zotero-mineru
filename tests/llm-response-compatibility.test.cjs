const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const {test} = require('node:test');

const settings = {apiBaseURL:'https://llm.example/v1',apiKey:'TEST',model:'test'};
function harness(body) {
  const requests=[];
  const context = {
    URL, Headers, AbortController, Uint8Array, setTimeout, clearTimeout,
    Zotero: {locale:'en-US',debug() {},logError() {}},
    fetch: async (url,options) => {
      requests.push({url,options});
      return {
        ok:true,status:200,
        text:async()=>typeof body === 'string' ? body : JSON.stringify(body),
        json:async()=>body
      };
    }
  };
  vm.createContext(context);
  for (const file of ['mineru.js','preferences.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname,'..',file),'utf8'),context);
  }
  return {context,requests,m:context.ZoteroMineru,p:context.ZoteroMineruPreferences};
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

test('literal think elements survive in inline code, fenced code and ordinary prose',async () => {
  for(const content of [
    'Example: `<think>literal paper content</think>`.',
    'Example XML:\n```xml\n<think>literal paper content</think>\n```\nEnd.',
    'The paper discusses <think>literal content</think> in its method.'
  ]) {
    for(const run of operations(harness({choices:[{finish_reason:'stop',message:{content}}]}))) {
      assert.equal(await run(),content);
    }
  }
});

test('leading thinking is removed without deleting literal examples in the final answer',async () => {
  const final='Example: `<think>literal content</think>`.';
  const content=' \n<think>reasoning</think>\n<think>more reasoning</think>\n'+final;
  for(const run of operations(harness({choices:[{finish_reason:'stop',message:{content}}]}))) {
    assert.equal(await run(),final);
  }
});

test('reasoning-only replies are rejected instead of saved as complete output',async () => {
  for(const run of operations(harness({choices:[{finish_reason:'stop',message:{content:'<think>reasoning only</think>'}}]}))) {
    await assert.rejects(run(),/empty|为空/);
  }
});

test('batch translation preserves think tags inside JSON string values',async () => {
  const marker='zotero-mineru-image://img-1';
  const source='Before\n\n![Figure]('+marker+')\n\nAfter';
  const translated=['First <think>literal content</think> end','Second'];
  for(const prefix of ['', '<think>actual reasoning</think>\n']) {
    const content=prefix+JSON.stringify(translated);
    const {m}=harness({choices:[{finish_reason:'stop',message:{content}}]});
    const result=await m.callLLMForTranslation(source,'English',settings,1,1);
    assert(result.includes(translated[0]));
    assert(result.includes(translated[1]));
    assert(result.includes(marker));
  }
});

test('ambiguous translation arrays are rejected so labels cannot become saved translations',async () => {
  const source='Before\n\n![Figure](zotero-mineru-image://img-1)\n\nAfter';
  for(const content of [
    'The labels ["left", "right"] correspond to these fragments: ["译文一", "译文二"].',
    '```json\n["example one","example two"]\n```\n```json\n["译文一","译文二"]\n```'
  ]) {
    const {m}=harness({choices:[{finish_reason:'stop',message:{content}}]});
    await assert.rejects(m.callLLMForTranslation(source,'中文',settings,1,1),/格式无效/);
  }
});

test('a malformed enclosing array cannot be replaced with a valid nested array',async () => {
  const content='Result: [invalid, ["wrong one","wrong two"]]';
  const {m}=harness({choices:[{finish_reason:'stop',message:{content}}]});
  await assert.rejects(m.callLLMForTranslation('Before\n\n![Fig](zotero-mineru-image://img-1)\n\nAfter',
    'English',settings,1,1),/格式无效/);
});

test('chat endpoint normalization preserves query parameters, fragments and slash-valued parameters',() => {
  const cases=[
    ['https://proxy.example/v1/chat/completions?api-version=test',
      'https://proxy.example/v1/chat/completions?api-version=test'],
    ['https://proxy.example/v1/?api-version=test&route=a%2Fb',
      'https://proxy.example/v1/chat/completions?api-version=test&route=a%2Fb'],
    ['https://proxy.example/v1/chat/completions/?route=https://upstream.example/',
      'https://proxy.example/v1/chat/completions?route=https://upstream.example/'],
    ['https://proxy.example/v1?api-version=test#section',
      'https://proxy.example/v1/chat/completions?api-version=test#section']
  ];
  const {m,p}=harness({});
  for(const obj of [m,p]) {
    for(const [input,expected] of cases) assert.equal(obj.buildLLMURL(input),expected);
  }
});

test('LLM settings readers preserve trailing slashes belonging to query parameter values',() => {
  const endpoint='https://proxy.example/v1/chat/completions?route=https://upstream.example/';
  const h=harness({});
  // Both VM objects share the same mocked Zotero preference store.
  const prefs=new Map([
    ['extensions.zotero-mineru.llmApiBaseURL',endpoint],
    ['extensions.zotero-mineru.llmApiKey','TEST'],
    ['extensions.zotero-mineru.llmModel','test']
  ]);
  h.context.Zotero.Prefs={get:key=>prefs.get(key)};
  assert.equal(h.m.getLLMSettings().apiBaseURL,endpoint);
  assert.equal(h.p.readLLMSettings().apiBaseURL,endpoint);
});

test('summary, translation and both connection checks send to the correctly normalized URL',async () => {
  const base='https://proxy.example/v1/?api-version=test&route=https://upstream.example/';
  const expected='https://proxy.example/v1/chat/completions?api-version=test&route=https://upstream.example/';
  const h=harness({choices:[{finish_reason:'stop',message:{content:'OK'}}]});
  const prefs=new Map([
    ['extensions.zotero-mineru.llmApiBaseURL',base],
    ['extensions.zotero-mineru.llmApiKey','TEST'],
    ['extensions.zotero-mineru.llmModel','test']
  ]);
  h.context.Zotero.Prefs={get:key=>prefs.get(key)};
  const llm=h.m.getLLMSettings();
  assert.equal(await h.m.callLLMForSummary('Paper',llm,'English'),'OK');
  assert.equal(await h.m.callLLMForTranslation('Paper','English',llm,1,1),'OK');
  h.p.saveSettings=()=>true;
  h.p.setOutput=()=>{};
  let status;
  h.p.setStatus=message=>{status=message;};
  await h.p.testLLMConnection();
  assert.match(status,/succeeded/);
  assert.equal(h.requests.length,4);
  assert(h.requests.every(request=>request.url===expected));
});
