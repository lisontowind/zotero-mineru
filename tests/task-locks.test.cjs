const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { test } = require('node:test');

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

const operations = [
  ['parse', 'handleParseCommand', 'collectPDFTasks', 'parseAttachmentWithMineru', 'saveResultAsMarkdownAttachment'],
  ['note', 'handleMarkdownToNoteCommand', 'collectMarkdownToNoteTasks', 'buildParsedResultFromMarkdownAttachment', 'saveResultAsNote'],
  ['summary', 'handleSummaryCommand', 'collectSummaryTasks', 'summarizeFullDocument', 'saveSummaryAsNote'],
  ['translate', 'handleTranslateCommand', 'collectTranslateTasks', 'callLLMForTranslation', 'saveTranslationAsMarkdownAttachment']
];

function task(id, sourceID = id + 1000) {
  const item = itemID => ({ id: itemID, libraryID: 1, getField: () => `Paper ${id}`, getFilePath: () => `/paper-${id}.md` });
  return { parentItem: item(id), attachment: item(sourceID), sourceAttachment: item(sourceID), mineruSource: item(sourceID) };
}

function harness() {
  const alerts = [], descriptions = [], progressWindows = [];
  const context = { Zotero: {
    debug() {}, logError() {},
    Promise: { delay: async () => {} },
    ProgressWindow: function () {
      progressWindows.push(this);
      this.ItemProgress = function () { this.setText = () => {}; this.setProgress = () => {}; this.setError = () => {}; };
      this.changeHeadline = () => {};
      this.show = () => {};
      this.addDescription = text => descriptions.push(text);
      this.startCloseTimer = () => {};
    }
  } };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../mineru.js'), 'utf8'), context);
  const m = context.ZoteroMineru;
  m.getSettings = () => ({ apiToken: 'test' });
  m.getLLMSettings = () => ({ apiBaseURL: 'https://example.test', apiKey: 'test', model: 'test', translateRetryCount: 1 });
  m.showAlert = (window, title, message) => alerts.push({ window, title, message });
  m.showConfirm = () => true;
  m.readSourceMarkdown = async () => ({ filePath: '/source.md', markdown: 'Source text' });
  m.inlineStoredImagesInMarkdownAttachment = async ({ markdownText }) => ({ markdownText, embeddedImages: [] });
  for (const [, , collect, process, save] of operations) {
    m[collect] = items => items;
    m[process] = async () => 'Result';
    m[save] = async () => {};
  }
  return { m, alerts, descriptions, progressWindows, context };
}

for (const [operation, handle, , process, save] of operations) {
  test(`${operation}: overlapping commands from two windows run and save only once`, async () => {
    const h = harness(), gate = deferred(), saving = deferred(), saveStarted = deferred();
    const selected = [task(1)];
    let calls = 0, saves = 0;
    h.m[process] = async () => { calls++; await gate.promise; return 'Result'; };
    h.m[save] = async () => { saves++; saveStarted.resolve(); await saving.promise; };
    const first = h.m[handle]({ window: { name: 'first' }, selectedItems: selected });
    assert.equal(h.m.activeTaskKeys.size, 1);
    await h.m[handle]({ window: { name: 'second' }, selectedItems: selected });
    gate.resolve();
    await saveStarted.promise;
    // The lock must cover persistence too, even after the model request finishes.
    await h.m[handle]({ selectedItems: selected });
    assert.equal(calls, 1);
    assert.equal(saves, 1);
    assert.equal(h.progressWindows.length, 1);
    assert.equal(h.alerts.length, 2);
    assert(h.alerts.every(alert => alert.title === 'MinerU 任务正在进行'));
    saving.resolve();
    await first;
    assert.equal(h.m.activeTaskKeys.size, 0);
  });

  test(`${operation}: processing failure releases reservations and permits retry`, async () => {
    const h = harness();
    let calls = 0, saves = 0;
    h.m[process] = async () => { calls++; throw Error('permanent failure'); };
    // Translation can retry transient failures; use a permanent HTTP error here.
    if (operation === 'translate') h.m[process] = async () => { calls++; throw Object.assign(Error('invalid key'), { httpStatus: 401 }); };
    h.m[save] = async () => { saves++; };
    await h.m[handle]({ selectedItems: [task(1)] });
    assert.equal(h.m.activeTaskKeys.size, 0);
    assert.equal(saves, 0);
    h.m[process] = async () => { calls++; return 'Result'; };
    await h.m[handle]({ selectedItems: [task(1)] });
    assert.equal(calls, 2);
    assert.equal(saves, 1);
    assert.equal(h.m.activeTaskKeys.size, 0);
  });

  test(`${operation}: failed saves release reservations`, async () => {
    const h = harness();
    h.m[save] = async () => { throw Error('disk full'); };
    await h.m[handle]({ selectedItems: [task(1)] });
    assert.equal(h.m.activeTaskKeys.size, 0);
    let saved = false;
    h.m[save] = async () => { saved = true; };
    await h.m[handle]({ selectedItems: [task(1)] });
    assert(saved);
  });
}

test('queued batch entries are reserved, while nonoverlapping documents proceed', async () => {
  const h = harness(), gate = deferred(), started = deferred();
  const first = task(1), queued = task(2), other = task(3);
  const inputs = [], saves = [];
  h.m.summarizeFullDocument = async () => { started.resolve(); await gate.promise; return 'Result'; };
  h.m.readSourceMarkdown = async source => { inputs.push(source.id); return { markdown: 'Source' }; };
  h.m.saveSummaryAsNote = async ({ parentItem }) => saves.push(parentItem.id);
  const batch = h.m.handleSummaryCommand({ selectedItems: [first, queued] });
  await started.promise;
  // The queued document has not started, but a second batch must still skip it.
  h.m.summarizeFullDocument = async () => 'Other result';
  await h.m.handleSummaryCommand({ selectedItems: [queued, other] });
  assert.deepEqual(inputs, [first.mineruSource.id, other.mineruSource.id]);
  assert.deepEqual(saves, [3]);
  assert(h.descriptions.some(text => text.includes('跳过 1 项')));
  assert.equal(h.m.activeTaskKeys.size, 2);
  gate.resolve();
  await batch;
  assert.deepEqual(saves, [3, 1, 2]);
  assert.equal(h.m.activeTaskKeys.size, 0);
});

test('distinct actions on a document can run concurrently', async () => {
  const h = harness(), gate = deferred(), selected = [task(1)];
  h.m.summarizeFullDocument = async () => { await gate.promise; return 'Summary'; };
  const summary = h.m.handleSummaryCommand({ selectedItems: selected });
  let translated = false;
  h.m.saveTranslationAsMarkdownAttachment = async () => { translated = true; };
  await h.m.handleTranslateCommand({ selectedItems: selected });
  assert(translated);
  assert.equal(h.m.activeTaskKeys.size, 1);
  gate.resolve();
  await summary;
});

test('note cancellation and progress-window errors release the entire batch', async () => {
  const h = harness();
  h.m.showConfirm = () => false;
  await h.m.handleMarkdownToNoteCommand({ selectedItems: [task(1), task(2)] });
  assert.equal(h.progressWindows.length, 0);
  assert.equal(h.m.activeTaskKeys.size, 0);
  h.context.Zotero.ProgressWindow = function () { throw Error('window failed'); };
  await assert.rejects(h.m.handleParseCommand({ selectedItems: [task(1), task(2)] }), /window failed/);
  assert.equal(h.m.activeTaskKeys.size, 0);
});

test('note tasks lock before modal confirmation and deduplicate by parent', async () => {
  const h = harness();
  let nested;
  h.m.showConfirm = () => {
    nested = h.m.handleMarkdownToNoteCommand({ selectedItems: [task(1, 222)] });
    return true;
  };
  let saves = 0;
  h.m.saveResultAsNote = async () => { saves++; };
  await h.m.handleMarkdownToNoteCommand({ selectedItems: [task(1, 111), task(1, 222)] });
  await nested;
  assert.equal(saves, 1);
  assert.equal(h.alerts.length, 1);
  assert.equal(h.m.activeTaskKeys.size, 0);
});

test('parse task identity preserves distinct source PDFs under the same parent', async () => {
  const h = harness();
  const savedSources = [];
  h.m.saveResultAsMarkdownAttachment = async ({ attachment }) => { savedSources.push(attachment.id); };
  await h.m.handleParseCommand({ selectedItems: [task(1, 101), task(1, 102), task(1, 101)] });
  assert.deepEqual(savedSources, [101, 102]);
});

test('menu definitions hide active tasks and enable unrelated or newly released tasks', async () => {
  const h = harness(), gate = deferred(), selected = [task(1)];
  h.m.callLLMForTranslation = async () => { await gate.promise; return 'Translation'; };
  const running = h.m.handleTranslateCommand({ selectedItems: selected });
  const menus = h.m.getContextMenuDefinitions();
  const translate = menus.find(menu => menu.id === h.m.TRANSLATE_MENU_ID);
  const summary = menus.find(menu => menu.id === h.m.SUMMARY_MENU_ID);
  assert.equal(translate.getTasks(selected).length, 0);
  assert.equal(translate.getTasks([task(2)]).length, 1);
  assert.equal(summary.getTasks(selected).length, 1);
  gate.resolve();
  await running;
  assert.equal(translate.getTasks(selected).length, 1);
});
