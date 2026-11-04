const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { test } = require('node:test');

function fixture() {
  const children = [], events = [];
  let failChildSave = false;
  const context = { Zotero: { Item: function () {
    this.tags = new Set();
    this.setNote = () => {};
    this.setField = () => {};
    this.addTag = tag => this.tags.add(tag);
    this.saveTx = async () => {
      if (failChildSave) throw Error('child save failed');
      events.push('child saved');
    };
    children.push(this);
  } } };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('mineru.js', 'utf8'), context);
  const m = context.ZoteroMineru;
  m.materializeEmbeddedImagesForNote = async ({ contentHTML }) => ({ contentHTML });
  m.saveDocumentAttachment = async options => {
    if (failChildSave) throw Error('child save failed');
    const child = { tags: new Set([options.tag]), options };
    children.push(child);
    events.push('child saved');
    return child;
  };
  const parent = {
    id: 1, libraryID: 1, tags: new Set(['manual']),
    getField: () => 'Paper',
    addTag(tag, type) { assert.equal(type, 0); this.tags.add(tag); },
    async saveTx() { events.push('parent saved'); }
  };
  const source = { libraryID: 1, getField: () => 'Paper.pdf' };
  return { m, parent, source, children, events, context, fail() { failChildSave = true; } };
}

const cases = [
  ['parse Markdown', '#MinerU-Parse', f => f.m.saveResultAsMarkdownAttachment({
    attachment: f.source, parentItem: f.parent, parsedResult: { markdownText: 'Text' },
    settings: { outputFormat: 'md', parseLinkSourcePDF: false }
  })],
  ['parse HTML', '#MinerU-Parse', f => f.m.saveResultAsMarkdownAttachment({
    attachment: f.source, parentItem: f.parent, parsedResult: { markdownText: 'Text' },
    settings: { outputFormat: 'html', parseLinkSourcePDF: false }
  })],
  ['parse note', '#MinerU-Parse', f => f.m.saveResultAsNote({
    attachment: f.source, parentItem: f.parent, parsedResult: { contentHTML: '<p>Text</p>' }, settings: {}
  })],
  ['summary note', '#MinerU-Summary', f => f.m.saveSummaryAsNote({ parentItem: f.parent, summaryText: 'Summary' })],
  ...['md', 'html'].flatMap(format => [false, true].map(partial => [
    `${partial ? 'partial' : 'complete'} translation ${format}`,
    partial ? '#MinerU-Translation-Partial' : '#MinerU-Translation',
    f => f.m.saveTranslationAsMarkdownAttachment({
      parentItem: f.parent, sourceAttachment: f.source, translatedText: 'Translation', language: '中文',
      settings: { outputFormat: format }, partial: partial ? { completed: 1, total: 2 } : null
    })
  ]))
];

for (const [name, tag, save] of cases) {
  test(`${name} tags literature and keeps the child tag`, async () => {
    const f = fixture();
    await save(f);
    assert(f.children.at(-1).tags.has(tag));
    assert.deepEqual([...f.parent.tags].sort(), ['manual', tag, ...(tag === '#MinerU-Parse' ? ['#MinerU-Parsed'] : [])].sort());
    assert.equal(f.events.at(-1), 'parent saved');
    assert(f.events.slice(0, -1).every(event => event === 'child saved'));
  });
  test(`${name} does not mark literature when saving the result fails`, async () => {
    const f = fixture();
    f.fail();
    await assert.rejects(() => save(f), /child save failed/);
    assert.deepEqual([...f.parent.tags], ['manual']);
    assert(!f.events.includes('parent saved'));
  });
}

test('standalone parse results still save without a literature parent', async () => {
  for (const [, , save] of cases.slice(0, 3)) {
    const f = fixture();
    f.parent = null;
    await save(f);
    assert(f.children.at(-1).tags.has('#MinerU-Parse'));
    assert(!f.events.includes('parent saved'));
  }
});

test('parent status tags do not block regeneration after child results are removed', () => {
  const { m, parent, source, context } = fixture();
  parent.isRegularItem = () => true;
  parent.isNote = () => false;
  parent.isAttachment = () => false;
  parent.isPDFAttachment = () => false;
  parent.getNotes = () => [];
  parent.getAttachments = () => [2];
  parent.tags = new Set(['#MinerU-Parse', '#MinerU-Parsed', '#MinerU-Summary', '#MinerU-Translation']);
  source.id = 2;
  source.isPDFAttachment = () => true;
  source.getTags = () => [];
  source.isAttachment = () => true;
  source.attachmentContentType = 'application/pdf';
  context.Zotero.Items = { get: id => id === 2 ? source : null };
  assert.equal(m.collectPDFTasks([parent]).length, 1);
  source.getTags = () => [{ tag: '#MinerU-Parse' }];
  source.attachmentContentType = 'text/markdown';
  assert.equal(m.collectMarkdownToNoteTasks([parent]).length, 1);
  assert.equal(m.collectSummaryTasks([parent]).length, 1);
  assert.equal(m.collectTranslateTasks([parent]).length, 1);
});
