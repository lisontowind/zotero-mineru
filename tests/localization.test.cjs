const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { test } = require('node:test');

test('Locale detection and English translations for menus and preferences', () => {
  const mineruSource = fs.readFileSync(path.join(__dirname, '../mineru.js'), 'utf8');
  const prefSource = fs.readFileSync(path.join(__dirname, '../preferences.js'), 'utf8');

  // English context
  const enContext = {
    URL, Headers, AbortController, Uint8Array, setTimeout, clearTimeout,
    Zotero: {
      locale: 'en-US',
      debug() {},
      logError() {},
      Prefs: { get: () => "", set: () => {} }
    }
  };
  vm.createContext(enContext);
  vm.runInContext(mineruSource, enContext);
  vm.runInContext(prefSource, enContext);

  assert.equal(enContext.ZoteroMineru.isEnglishLocale(), true);
  assert.equal(enContext.ZoteroMineruPreferences.isEnglishLocale(), true);

  const menus = enContext.ZoteroMineru.getContextMenuDefinitions();
  assert.equal(menus[0].label, "Parse PDF with MinerU and Save as Attachment");
  assert.equal(menus[1].label, "Convert MinerU Document to Note");
  assert.equal(menus[2].label, "Summarize with AI");
  assert.equal(menus[3].label, "Translate with AI");

  // Chinese context
  const zhContext = {
    URL, Headers, AbortController, Uint8Array, setTimeout, clearTimeout,
    Zotero: {
      locale: 'zh-CN',
      debug() {},
      logError() {},
      Prefs: { get: () => "", set: () => {} }
    }
  };
  vm.createContext(zhContext);
  vm.runInContext(mineruSource, zhContext);
  vm.runInContext(prefSource, zhContext);

  assert.equal(zhContext.ZoteroMineru.isEnglishLocale(), false);
  assert.equal(zhContext.ZoteroMineruPreferences.isEnglishLocale(), false);

  const zhMenus = zhContext.ZoteroMineru.getContextMenuDefinitions();
  assert.equal(zhMenus[0].label, "使用 MinerU 解析 PDF 并保存为附件");
});
