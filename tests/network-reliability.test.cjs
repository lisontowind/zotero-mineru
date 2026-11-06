const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { test } = require('node:test');

const source = fs.readFileSync(require('node:path').join(__dirname, '../mineru.js'), 'utf8');
function harness(fetchImpl) {
  const delays = [], requests = [];
  const context = {
    URL, Headers, AbortController, Uint8Array, setTimeout, clearTimeout,
    Zotero: { debug() {}, logError() {}, Promise: { delay: async ms => { delays.push(ms); } } },
    fetch: async (url, options) => { requests.push({ url, ...options }); return fetchImpl(url, options); }
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  return { m: context.ZoteroMineru, context, delays, requests };
}
function response(status = 200, body = {}, headers = {}) {
  return { ok: status >= 200 && status < 300, status, headers: new Headers(headers),
    text: async () => typeof body === 'string' ? body : JSON.stringify(body),
    json: async () => body, arrayBuffer: async () => new ArrayBuffer(2) };
}
function pendingUntilAborted(signal, onAbort = () => {}) {
  return new Promise((_resolve, reject) => {
    const abort = () => { onAbort(); reject(Object.assign(new Error('aborted'), { name: 'AbortError' })); };
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
  });
}
const settings = { apiBaseURL: 'https://api.example/v4', apiKey: 'LLM_TEST', model: 'test' };

test('third-party download failures never receive a token', async () => {
  const { m, requests } = harness(async () => response(403, 'forbidden'));
  await assert.rejects(m.downloadParseResultZip({ zipURL: 'https://cdn.example/result.zip',
    apiBaseURL: settings.apiBaseURL, token: 'SECRET' }), /403/);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].headers.has('Authorization'), false);
  assert(requests[0].signal);
  await assert.rejects(m.fetchZipWithOptions({ url: 'https://cdn.example/result.zip',
    apiBaseURL: settings.apiBaseURL, token: 'SECRET', withAuth: true }), /已阻止/);
  assert.equal(requests.length, 1);
});

test('only the same HTTPS origin can use authenticated download fallback', async () => {
  const { m, requests } = harness(async (_url, options) =>
    response(options.headers.has('Authorization') ? 200 : 403));
  const bytes = await m.downloadParseResultZip({ zipURL: '/result.zip',
    apiBaseURL: settings.apiBaseURL, token: 'SECRET' });
  assert.equal(bytes.length, 2);
  assert.equal(requests.length, 2);
  assert.equal(requests[1].headers.get('Authorization'), 'Bearer SECRET');
  assert.equal(requests[1].redirect, 'error');
  for (const url of ['http://api.example/a', 'https://api.example:444/a',
    'https://user:pass@api.example/a', 'https://api.example.evil.test/a']) {
    assert.equal(m.canSendDownloadToken(url, settings.apiBaseURL), false);
  }
});

test('HTTP downloads try HTTPS first and never send credentials over HTTP', async () => {
  const { m, requests } = harness(async () => response(403));
  await assert.rejects(m.downloadParseResultZip({ zipURL: 'http://api.example/result.zip',
    apiBaseURL: settings.apiBaseURL, token: 'SECRET' }));
  assert(requests[0].url.startsWith('https://'));
  const http = requests.filter(r => r.url.startsWith('http://'));
  assert.equal(http.length, 1);
  assert.equal(http[0].headers.has('Authorization'), false);
});

test('request timeout aborts a pending fetch before returning', { timeout: 2000 }, async () => {
  let active = 0;
  const { m, requests } = harness(async (_url, options) => {
    active++;
    return pendingUntilAborted(options.signal, () => { active--; });
  });
  await assert.rejects(m.requestMineruJSON({ url: settings.apiBaseURL, token: 'TEST', timeoutMS: 10 }),
    error => error.code === 'ETIMEDOUT');
  assert.equal(active, 0);
  assert.equal(requests[0].signal.aborted, true);
});

test('timeouts also abort stalled response bodies for JSON and ZIP', { timeout: 2000 }, async () => {
  for (const type of ['json', 'zip']) {
    const { m, requests } = harness(async (_url, options) => ({
      ok: true, text: () => pendingUntilAborted(options.signal),
      arrayBuffer: () => pendingUntilAborted(options.signal)
    }));
    const task = type === 'json'
      ? m.requestMineruJSON({ url: settings.apiBaseURL, token: 'TEST', timeoutMS: 10 })
      : m.downloadParseResultZip({ zipURL: 'https://cdn.example/result.zip',
          apiBaseURL: settings.apiBaseURL, timeoutMS: 10 });
    await assert.rejects(task, /超时/);
    assert.equal(requests[0].signal.aborted, true);
  }
});

test('LLM response-body timeouts abort both summary and translation requests', { timeout: 2000 }, async () => {
  for (const operation of ['summary', 'translation']) {
    const { m, requests } = harness(async (_url, options) => ({
      ok: true, json: () => pendingUntilAborted(options.signal)
    }));
    const original = m.withRequestTimeout;
    m.withRequestTimeout = (fn, _ms, label) => original.call(m, fn, 10, label);
    const task = operation === 'summary'
      ? m.callLLMForSummary('Source', settings, '中文')
      : m.callLLMForTranslation('Source', '中文', settings, 1, 1);
    await assert.rejects(task, error => error.code === 'ETIMEDOUT');
    assert.equal(requests[0].signal.aborted, true);
  }
});

test('PDF upload timeouts abort the upload and retain the parse phase', { timeout: 2000 }, async () => {
  const { m, context, requests } = harness(async (_url, options) => pendingUntilAborted(options.signal));
  context.IOUtils = { read: async () => new Uint8Array([1, 2, 3]) };
  m.requestMineruJSON = async options => {
    assert.equal(options.timeoutMS, 10);
    return { code: 0, data: { batch_id: 'batch', file_urls: ['https://upload.example/file'] } };
  };
  await assert.rejects(m.parseAttachmentWithMineru({ id: 1, getFilePath: () => '/paper.pdf' }, {
    apiBaseURL: settings.apiBaseURL, apiToken: 'TEST', timeoutMS: 10, modelVersion: 'pipeline'
  }), /上传 PDF.*超时.*当前状态: 上传 PDF/);
  assert.equal(requests[0].method, 'PUT');
  assert.equal(requests[0].signal.aborted, true);
  assert.equal(requests[0].headers, undefined);
});

test('a timed out translation is aborted before its retry starts', { timeout: 2000 }, async () => {
  let active = 0, attempts = 0;
  const { m } = harness(async (_url, options) => {
    assert.equal(active, 0);
    attempts++;
    if (attempts === 2) return response(200, { choices: [{ message: { content: 'complete' } }] });
    active++;
    return pendingUntilAborted(options.signal, () => { active--; });
  });
  const original = m.withRequestTimeout;
  m.withRequestTimeout = (fn, _ms, label) => original.call(m, fn, 10, label);
  const result = await m.translateChunkWithRetry({ chunkText: 'Source', chunkIndex: 0, totalChunks: 1,
    autoRetryCount: 1, translateChunk: text => m.callLLMForTranslation(text, '中文', settings, 1, 1) });
  assert.equal(result.ok, true);assert.equal(result.attempts, 2);assert.equal(active, 0);
});

test('poll requests use the remaining deadline and sleep never exceeds it', async () => {
  const { m, context, delays } = harness();
  let now = 0;
  context.Date = { now: () => now };
  context.Zotero.Promise.delay = async ms => { delays.push(ms); now += ms; };
  m.requestMineruJSON = async options => {
    assert.equal(options.timeoutMS, 20);
    now += 7;
    return { code: 0, data: { extract_result: [{ state: 'running' }] } };
  };
  await assert.rejects(m.pollMineruExtractResult({ apiBaseURL: settings.apiBaseURL,
    token: 'TEST', batchID: 'batch', dataID: 'data', timeoutMS: 20, pollIntervalMS: 3000 }), /解析超时/);
  assert.deepEqual(delays, [13]);
});

test('HTTP errors retain status and Retry-After, with backoff only between attempts', async () => {
  let calls = 0;
  const { m, delays } = harness(async () => ++calls === 1
    ? response(429, 'rate limited', { 'Retry-After': '5' })
    : response(200, { choices: [{ finish_reason: 'stop', message: { content: '译文' } }] }));
  const result = await m.translateChunkWithRetry({ chunkText: 'Source', chunkIndex: 0,
    totalChunks: 1, autoRetryCount: 2,
    translateChunk: text => m.callLLMForTranslation(text, '中文', settings, 1, 1) });
  assert.equal(result.ok, true);
  assert.equal(result.attempts, 2);
  assert.deepEqual(delays, [5000]);
  const dated = m.createHTTPError(response(503, '', { 'Retry-After': new Date(Date.now() + 10000).toUTCString() }), '', 'Test');
  assert(dated.retryAfterMS > 8000 && dated.retryAfterMS <= 10000);
  assert.equal(m.createHTTPError(response(503, '', { 'Retry-After': 'bad' }), '', 'Test').retryAfterMS, undefined);
});

test('permanent HTTP errors are not retried, transient failures back off exponentially', async () => {
  for (const status of [400, 401, 403, 404, 422]) {
    const { m, delays, requests } = harness(async () => response(status, 'permanent'));
    const result = await m.translateChunkWithRetry({ chunkText: 'Source', chunkIndex: 0,
      totalChunks: 1, autoRetryCount: 2,
      translateChunk: text => m.callLLMForTranslation(text, '中文', settings, 1, 1) });
    assert.equal(result.ok, false);assert.equal(result.attempts, 1);
    assert.equal(requests.length, 1);assert.equal(delays.length, 0);
  }
  const { m, delays } = harness();
  const result = await m.translateChunkWithRetry({ chunkText: 'Source', chunkIndex: 0,
    totalChunks: 1, autoRetryCount: 2, translateChunk: async () => { throw Error('temporary'); } });
  assert.equal(result.attempts, 3);
  assert.equal(delays.length, 2);
  assert(delays[0] >= 800 && delays[0] <= 1200);
  assert(delays[1] >= 1600 && delays[1] <= 2400);
});

test('both LLM operations reject truncated and otherwise incomplete responses', async () => {
  for (const reason of ['length', 'content_filter', 'tool_calls']) {
    const { m } = harness(async () => response(200, {
      choices: [{ finish_reason: reason, message: { content: 'incomplete output' } }]
    }));
    await assert.rejects(m.callLLMForSummary('Source', settings, '中文'), e => e.code === 'LLM_INCOMPLETE');
    await assert.rejects(m.callLLMForTranslation('Source', '中文', settings, 1, 1), e => e.code === 'LLM_INCOMPLETE');
  }
  for (const reason of ['stop', undefined]) {
    const { m } = harness(async () => response(200, { choices: [{ finish_reason: reason, message: { content: 'complete' } }] }));
    assert.equal(await m.callLLMForSummary('Source', settings, '中文'), 'complete');
    assert.equal(await m.callLLMForTranslation('Source', '中文', settings, 1, 1), 'complete');
  }
});

test('truncated chunks remain failures while completed chunks are retained', async () => {
  const { m } = harness(async (_url, options) => {
    const text = JSON.parse(options.body).messages[1].content;
    return response(200, { choices: [{ finish_reason: text === 'B' ? 'length' : 'stop',
      message: { content: text === 'B' ? 'incomplete' : 'translated A' } }] });
  });
  const result = await m.translateChunksWithConcurrency({ chunks: ['A', 'B'], concurrency: 2,
    autoRetryCount: 1, translateChunk: text => m.callLLMForTranslation(text, '中文', settings, 1, 2) });
  assert.equal(result.successes.size, 1);
  assert.equal(result.successes.get(0), 'translated A');
  assert.equal(result.failures.length, 1);
  assert.equal(result.failures[0].chunkIndex, 1);
  assert.equal(result.failures[0].error.code, 'LLM_INCOMPLETE');
});

test('summary chunks preserve the whole source, including giant paragraphs and Unicode', () => {
  const { m } = harness();
  const text = 'A'.repeat(49999) + '😀' + 'B'.repeat(20000) + '\n\nFINAL FINDING';
  const chunks = m.splitSummaryText(text);
  assert.equal(chunks.join(''), text);
  assert(chunks.every(c => c.length <= 50000 && !/[\uD800-\uDBFF]$/.test(c)));
});

test('long summaries retain custom prompts and synthesize all parts before returning', async () => {
  const calls = [];
  const { m } = harness(async (_url, options) => {
    const payload = JSON.parse(options.body);calls.push(payload);
    return response(200, { choices: [{ finish_reason: 'stop', message: {
      content: payload.messages[1].content.startsWith('Synthesize') ? 'final synthesis' : 'short notes'
    } }] });
  });
  const input = 'A'.repeat(61000) + '\nTAIL FINDING';
  assert.equal(await m.summarizeFullDocument(input, { ...settings, summaryPrompt: 'Custom {{language}}',
    summaryRequestParams: { max_tokens: 2000 } }, '中文'), 'final synthesis');
  assert.equal(calls.length, 3);
  assert(calls[1].messages[1].content.includes('TAIL FINDING'));
  assert(calls[2].messages[1].content.includes('Part 1/2'));
  assert(calls[2].messages[1].content.includes('Part 2/2'));
  assert(calls.every(c => c.messages[0].content === 'Custom 中文' && c.max_tokens === 2000));
});

test('hierarchical summaries reduce oversized intermediate notes and stop non-converging prompts', async () => {
  const { m } = harness();
  const stages = [];
  m.callLLMForSummary = async (_text, _settings, _language, context) => {
    stages.push(context.stage);
    return context.stage === 'chunk' ? 'N'.repeat(35000) : 'compact synthesis';
  };
  assert.equal(await m.summarizeFullDocument('A'.repeat(100000), settings, '中文'), 'compact synthesis');
  assert.equal(stages.filter(s => s === 'chunk').length, 2);
  assert.equal(stages.filter(s => s === 'merge').length, 3);
  m.callLLMForSummary = async text => text;
  await assert.rejects(m.summarizeFullDocument('A'.repeat(61000), settings, '中文'), /未能缩短/);
});

test('buildLLMURL normalizes trailing slashes and prevents duplicate /chat/completions', () => {
  const { m } = harness();
  assert.equal(m.buildLLMURL('https://api.openai.com/v1'), 'https://api.openai.com/v1/chat/completions');
  assert.equal(m.buildLLMURL('https://api.openai.com/v1/'), 'https://api.openai.com/v1/chat/completions');
  assert.equal(m.buildLLMURL('https://api.openai.com/v1/chat/completions'), 'https://api.openai.com/v1/chat/completions');
  assert.equal(m.buildLLMURL('https://api.openai.com/v1/chat/completions/'), 'https://api.openai.com/v1/chat/completions');
  assert.equal(m.buildLLMURL(''), '');
});

test('callLLMForSummary succeeds when LLM API returns SSE stream (data: ...)', async () => {
  const sseBody = [
    'data: {"id":"1","choices":[{"delta":{"content":"# Summary\\n"}}]}',
    'data: {"id":"2","choices":[{"delta":{"content":"Key findings here."}}]}',
    'data: [DONE]'
  ].join('\n\n');
  const { m, requests } = harness(async () => response(200, sseBody));
  const res = await m.callLLMForSummary('Platonic solids paper', settings, 'en');
  assert.equal(res, '# Summary\nKey findings here.');
  assert.equal(requests.length, 1);
  const sentPayload = JSON.parse(requests[0].body);
  assert.equal(sentPayload.stream, false);
  const acceptHeader = requests[0].headers?.get?.('Accept') || requests[0].headers?.['Accept'];
  assert.equal(acceptHeader, 'application/json');
});

test('callLLMForSummary succeeds when response has UTF-8 BOM or markdown code fence', async () => {
  const jsonText = JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: 'Clean summary' } }] });
  // BOM test
  const { m: mBom } = harness(async () => response(200, '\uFEFF' + jsonText));
  assert.equal(await mBom.callLLMForSummary('Paper', settings, 'en'), 'Clean summary');

  // Code fence test
  const { m: mFence } = harness(async () => response(200, '```json\n' + jsonText + '\n```'));
  assert.equal(await mFence.callLLMForSummary('Paper', settings, 'en'), 'Clean summary');
});

test('callLLMForSummary handles Gemini STOP, Anthropic end_turn, and strips DeepSeek <think> tags', async () => {
  // Case-insensitive STOP
  const { m: mStop } = harness(async () => response(200, { choices: [{ finish_reason: 'STOP', message: { content: 'Gemini reply' } }] }));
  assert.equal(await mStop.callLLMForSummary('Paper', settings, 'en'), 'Gemini reply');

  // Anthropic end_turn
  const { m: mEndTurn } = harness(async () => response(200, { choices: [{ finish_reason: 'end_turn', message: { content: 'Claude reply' } }] }));
  assert.equal(await mEndTurn.callLLMForSummary('Paper', settings, 'en'), 'Claude reply');

  // DeepSeek-R1 <think> tags
  const { m: mThink } = harness(async () => response(200, {
    choices: [{ finish_reason: 'stop', message: { content: '<think>Let me reason about platonic solids...\n</think>\n\nFinal structured summary.' } }]
  }));
  assert.equal(await mThink.callLLMForSummary('Platonic solids', settings, 'en'), 'Final structured summary.');
});

test('callLLMForSummary throws informative error when server returns HTML instead of raw SyntaxError', async () => {
  const htmlBody = '<!DOCTYPE html><html><head><title>Cloudflare</title></head><body>Just a moment...</body></html>';
  const { m } = harness(async () => response(200, htmlBody));
  await assert.rejects(
    m.callLLMForSummary('Paper', settings, 'en'),
    /HTML/
  );
});

test('callLLMForSummary throws informative error when server returns invalid JSON instead of unhandled SyntaxError', async () => {
  const badBody = 'Service unavailable or unexpected plain text';
  const { m } = harness(async () => response(200, badBody));
  await assert.rejects(
    m.callLLMForSummary('Paper', settings, 'en'),
    /JSON/
  );
});

test('callLLMForTranslation succeeds with SSE stream, BOM, and conversational JSON array wrapping', async () => {
  // SSE stream translation
  const sseBody = [
    'data: {"id":"1","choices":[{"delta":{"content":"# 译文\\n"}}]}',
    'data: {"id":"2","choices":[{"delta":{"content":"主要发现如下。"}}]}',
    'data: [DONE]'
  ].join('\n\n');
  const { m: mSse, requests } = harness(async () => response(200, sseBody));
  const res = await mSse.callLLMForTranslation('Source markdown', '中文', settings, 1, 1);
  assert.equal(res, '# 译文\n主要发现如下。');
  const sentPayload = JSON.parse(requests[0].body);
  assert.equal(sentPayload.stream, false);

  // Batch translation with conversational text wrapping JSON array
  const imageMarker = 'zotero-mineru-image://img-1';
  const textWithImage = `Paragraph 1\n\n![Figure](${imageMarker})\n\nParagraph 2`;
  const chattyReply = 'Here is the translated JSON:\n```json\n["第一段", "第二段"]\n```\nHope this helps!';
  const { m: mBatch } = harness(async () => response(200, { choices: [{ finish_reason: 'stop', message: { content: chattyReply } }] }));
  const batchRes = await mBatch.callLLMForTranslation(textWithImage, '中文', settings, 1, 1);
  assert(batchRes.includes('第一段'));
  assert(batchRes.includes('第二段'));
  assert(batchRes.includes(imageMarker));

  // HTML response throws informative error
  const { m: mHtml } = harness(async () => response(200, '<html><head><title>Error</title></head><body>502 Bad Gateway</body></html>'));
  await assert.rejects(
    mHtml.callLLMForTranslation('Source', '中文', settings, 1, 1),
    /HTML/
  );
});
