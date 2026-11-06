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

test('AbortController fallback works when window is completely missing', async () => {
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
  const ctrl = m.createAbortController();
  assert(ctrl);
  assert.equal(ctrl.signal.aborted, false);
  ctrl.abort();
  assert.equal(ctrl.signal.aborted, true);
});
