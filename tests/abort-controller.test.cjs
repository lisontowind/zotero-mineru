const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { test } = require('node:test');

test('AbortController resolution works when missing from global scope', async () => {
  const mineruSource = fs.readFileSync(path.join(__dirname, '../mineru.js'), 'utf8');

  class MockWindowAbortController {
    constructor() {
      this.isFromMainWindow = true;
      this.signal = { aborted: false };
    }
    abort() {
      this.signal.aborted = true;
    }
  }

  // Environment without global AbortController
  const context = {
    URL, Headers, Uint8Array, setTimeout, clearTimeout,
    Zotero: {
      debug() {},
      logError() {},
      getMainWindow() {
        return { AbortController: MockWindowAbortController };
      }
    }
  };

  vm.createContext(context);
  vm.runInContext(mineruSource, context);

  const m = context.ZoteroMineru;
  const ctrl = m.createAbortController();
  assert.equal(ctrl.isFromMainWindow, true);
  assert.equal(ctrl.signal.aborted, false);
  ctrl.abort();
  assert.equal(ctrl.signal.aborted, true);

  // Test withRequestTimeout executes without AbortController is not defined error
  let signalReceived = null;
  const res = await m.withRequestTimeout(async (signal) => {
    signalReceived = signal;
    return "ok";
  }, 1000, "test");

  assert.equal(res, "ok");
  assert.equal(signalReceived.aborted, false);
});

test('requests fail before starting when no native AbortController is available', async () => {
  const mineruSource = fs.readFileSync(path.join(__dirname, '../mineru.js'), 'utf8');

  // Environment without any AbortController or Window
  const context = {
    URL, Headers, Uint8Array, setTimeout, clearTimeout,
    Zotero: {
      debug() {},
      logError() {},
      getMainWindow() { return null; },
      getMainWindows() { return []; }
    }
  };

  vm.createContext(context);
  vm.runInContext(mineruSource, context);

  const m = context.ZoteroMineru;
  assert.throws(() => m.createAbortController(), error => error.code === 'ABORT_CONTROLLER_UNAVAILABLE');
  let started = false;
  await assert.rejects(m.withRequestTimeout(() => { started = true; }, 10),
    error => error.code === 'ABORT_CONTROLLER_UNAVAILABLE' && error.retryable === false);
  assert.equal(started, false);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../preferences.js'), 'utf8'), context);
  const panel = context.ZoteroMineruPreferences;
  context.fetch = () => { started = true; throw new Error('must not fetch'); };
  await assert.rejects(panel.sendLLMTestRequest({endpoint:'https://example.invalid', payload:{}, timeoutMS:10}),
    error => error.code === 'ABORT_CONTROLLER_UNAVAILABLE');
  panel.saveSettings = () => true;
  panel.readCurrentSettings = () => ({apiBaseURL:'https://example.invalid',apiToken:'TEST',timeoutMS:10});
  let status;
  panel.setStatus = message => { status = message; };
  panel.setOutput = () => {};
  await panel.testConnection();
  assert.match(status, /AbortController/);
  assert.equal(started, false);
});

test('window-native controllers cancel core and preferences requests on timeout', async () => {
  const context = {
    URL, Headers, Uint8Array, setTimeout, clearTimeout,
    Zotero: {debug() {}, logError() {}, getMainWindow: () => ({AbortController})}
  };
  vm.createContext(context);
  for (const file of ['mineru.js','preferences.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), context);
  }
  let active = 0, signals = [];
  const pending = signal => new Promise((_resolve,reject) => {
    signals.push(signal);
    active++;
    signal.addEventListener('abort', () => {
      active--;
      reject(Object.assign(new Error('aborted'), {name:'AbortError'}));
    }, {once:true});
  });
  await assert.rejects(context.ZoteroMineru.withRequestTimeout(pending, 10),
    error => error.code === 'ETIMEDOUT');
  assert.equal(active, 0);
  context.fetch = (_url,options) => pending(options.signal);
  await assert.rejects(context.ZoteroMineruPreferences.sendLLMTestRequest({
    endpoint:'https://example.invalid',payload:{},timeoutMS:10
  }), /超时|timed out/);
  assert.equal(active, 0);
  assert(signals.every(signal => signal.aborted));
});
