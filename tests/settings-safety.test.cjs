const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { test } = require('node:test');

function harness() {
  const prefs = new Map(), inputs = new Map(), writes = [];
  const context = { Zotero: { Prefs: {
    get: key => prefs.get(key),
    set: (key, value) => { writes.push([key, value]); prefs.set(key, value); }
  } } };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../preferences.js'), 'utf8'), context);
  const panel = context.ZoteroMineruPreferences;
  for (const field of panel.FIELDS) {
    inputs.set(field.id, {
      value: field.type === 'int' ? String(field.min) : '', checked: false,
      attributes: new Map(), focused: false,
      setAttribute(name, value) { this.attributes.set(name, value); },
      removeAttribute(name) { this.attributes.delete(name); },
      focus() { this.focused = true; }
    });
  }
  let status;
  panel.$ = id => inputs.get(id);
  panel.setStatus = (message, error) => { status = { message, error }; };
  return { panel, inputs, prefs, writes, status: () => status };
}

test('invalid later fields leave every preference unchanged, including booleans', () => {
  const h = harness();
  h.prefs.set(h.panel.PREF_BRANCH + 'apiBaseURL', 'https://old.example');
  h.inputs.get('mineru-api-base-url').value = 'https://new.example';
  h.inputs.get('mineru-parseGenerateHTML').checked = true;
  const invalid = h.inputs.get('mineru-translate-request-json');
  invalid.value = '{';
  assert.equal(h.panel.saveSettings(), false);
  assert.equal(h.writes.length, 0);
  assert.equal(h.prefs.get(h.panel.PREF_BRANCH + 'apiBaseURL'), 'https://old.example');
  assert.equal(invalid.attributes.get('aria-invalid'), 'true');
  assert.equal(invalid.focused, true);
  assert.equal(h.status().error, true);
  invalid.value = '{}';
  assert.equal(h.panel.saveSettings({ silent: true }), true);
  assert.equal(h.prefs.get(h.panel.PREF_BRANCH + 'apiBaseURL'), 'https://new.example');
  assert.equal(h.prefs.get(h.panel.PREF_BRANCH + 'parseGenerateHTML'), true);
  assert.equal(invalid.attributes.has('aria-invalid'), false);
  assert.equal(h.status().message, '');
});

test('numeric settings reject partial numbers and enforce the UI bounds before writes', () => {
  for (const [id, values] of [
    ['mineru-timeout-sec', ['', '0', '4', '3601', '5.5', '10abc', '1e2']],
    ['mineru-poll-interval-sec', ['61']],
    ['mineru-translate-chunk-size', ['4999', '60001']],
    ['mineru-translate-concurrency', ['9']],
    ['mineru-translate-retry-count', ['6']]
  ]) {
    for (const value of values) {
      const h = harness();
      h.inputs.get(id).value = value;
      assert.equal(h.panel.saveSettings({ silent: true }), false, `${id}: ${value}`);
      assert.equal(h.writes.length, 0);
      assert.equal(h.status().error, true);
      assert.equal(h.inputs.get(id).focused, false);
    }
  }
});

test('JSON parameters reject reserved fields during validation and credentials are normalized', () => {
  for (const value of ['[]', 'null', '{"model":"override"}', '{"messages":[]}']) {
    const h = harness();
    h.inputs.get('mineru-summary-request-json').value = value;
    assert.equal(h.panel.saveSettings(), false);
    assert.equal(h.writes.length, 0);
  }
  const h = harness();
  h.inputs.get('mineru-api-token').value = '  Bearer TOKEN  ';
  h.inputs.get('mineru-llm-api-key').value = '  bearer KEY  ';
  assert.equal(h.panel.saveSettings(), true);
  assert.equal(h.prefs.get(h.panel.PREF_BRANCH + 'apiToken'), 'TOKEN');
  assert.equal(h.prefs.get(h.panel.PREF_BRANCH + 'llmApiKey'), 'KEY');
});

test('both connectivity tests stop when settings are invalid', async () => {
  const h = harness();
  h.inputs.get('mineru-timeout-sec').value = '0';
  h.panel.readCurrentSettings = () => { throw Error('must not read stale settings'); };
  h.panel.readLLMSettings = () => { throw Error('must not read stale settings'); };
  await h.panel.testConnection();
  await h.panel.testLLMConnection();
  assert.equal(h.writes.length, 0);
});
