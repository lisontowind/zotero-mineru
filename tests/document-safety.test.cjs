const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { test } = require('node:test');

function harness() {
  const reads = [];
  const context = {
    Zotero: { debug() {}, logError() {} },
    IOUtils: { read: async file => { reads.push(file); return new Uint8Array([1]); } }
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../mineru.js'), 'utf8'), context);
  return { m: context.ZoteroMineru, context, reads };
}

test('Markdown links reject active protocols, including encoded and mixed-case forms', () => {
  const { m } = harness();
  for (const url of ['javascript:alert%281%29', 'JaVaScRiPt:foo', 'vbscript:foo',
    'data:text/html,test', 'file:///private.txt', 'javascript&#58;foo',
    'java&#x73;cript&colon;foo', 'java&#9;script:foo', 'java&NewLine;script:foo']) {
    assert.equal(m.isSafeDocumentURL(url), false, url);
    assert(!m.renderDocumentBody(`[open](${url})`).includes('<a '), url);
  }
  for (const url of ['https://example.test/paper', 'mailto:author@example.test',
    'zotero://select/library/items/ABC', '#section', 'notes/paper.html']) {
    assert(m.renderDocumentBody(`[open](${url})`).includes('<a '), url);
  }
  assert(m.renderDocumentBody('`[open](javascript:foo)`').includes('<code>'));
});

test('HTML tables are escaped when a trusted DOM parser is missing or fails', () => {
  const { m, context } = harness();
  const raw = '<table onclick="attack()"><tr><td>text</td></tr></table>';
  assert(!m.normalizeHTMLTableForNote(raw).includes('<table'));
  context.DOMParser = function () { throw Error('unavailable'); };
  assert(!m.normalizeHTMLTableForNote(raw).includes('<table'));
});

test('stored images remain in the attachment directory on POSIX, drive and UNC paths', () => {
  const { m } = harness();
  assert.equal(m.resolveStoredAttachmentImagePath('/storage/KEY/doc.md', 'images/a.png'), '/storage/KEY/images/a.png');
  assert.equal(m.resolveStoredAttachmentImagePath('C:\\storage\\KEY\\doc.md', 'images/tmp/../a.png'), 'C:\\storage\\KEY\\images\\a.png');
  assert.equal(m.resolveStoredAttachmentImagePath('\\\\server\\share\\KEY\\doc.md', 'images/a.png'), '\\\\server\\share\\KEY\\images\\a.png');
  assert.equal(m.resolveStoredAttachmentImagePath('/storage/KEY/doc.md', './images/a%20b.png?raw=1#image'), '/storage/KEY/images/a b.png');
  for (const reference of ['../../private.png', 'images/../../private.png', '%2e%2e/private.png',
    '..%5cprivate.png', '%2fprivate.png', '.. /private.png', 'images/a.png:stream', 'images/%00.png']) {
    assert.throws(() => m.resolveStoredAttachmentImagePath('/storage/KEY/doc.md', reference), /图片路径/, reference);
  }
});

test('traversal is rejected before reading any image bytes', async () => {
  const { m, reads } = harness();
  await assert.rejects(m.inlineStoredImagesInMarkdownAttachment({
    markdownText: '![private](../../private.png)', markdownPath: '/storage/KEY/doc.md'
  }), /图片路径超出附件目录/);
  assert.equal(reads.length, 0);
  assert.equal(m.isSafeDocumentURL('../private.png', true), false);
  assert.equal(m.isSafeDocumentURL('images/../../private.png', true), false);
  assert.throws(() => m.renderDocumentBody('![private](images/../../private.png)'), /不支持的图片引用/);
});
