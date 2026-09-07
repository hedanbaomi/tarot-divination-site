// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const backupModule = require('../web/ios-backup.js');
const customSpreads = require('../Quareia/Resources/www/js/custom-spreads.js');
const freeBoardDraft = require('../Quareia/Resources/www/js/free-board-draft.js');
const historyRecords = require('../Quareia/Resources/www/js/history-records.js');
const rootPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const FIXED_DATE = '2026-09-07T00:00:00.000Z';

function storage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
    snapshot() { return Object.fromEntries(values); }
  };
}

function journal(initial = null) {
  let value = initial;
  const events = [];
  return {
    events,
    async get() { events.push('get'); return value; },
    async put(next) { events.push('put'); value = structuredClone(next); },
    async clear() { events.push('clear'); value = null; },
    current() { return value; }
  };
}

function realApis(overrides = {}) {
  return {
    recordsApi: historyRecords,
    historyStoreApi: { createStore() {}, DB_NAME: 'unused', DB_VERSION: 1, READINGS_STORE: 'unused' },
    customSpreadsApi: customSpreads,
    draftApi: freeBoardDraft,
    now: () => FIXED_DATE,
    ...overrides
  };
}

function emptyBackup(settings = { theme: null, locale: null }) {
  return {
    format: backupModule.FORMAT,
    version: backupModule.VERSION,
    exportedAt: FIXED_DATE,
    history: historyRecords.createExportEnvelope([], FIXED_DATE),
    customSpreads: { v: customSpreads.SCHEMA_VERSION, items: [] },
    draft: null,
    settings
  };
}

function oneTemplateEnvelope() {
  let raw = null;
  const library = customSpreads.createLibrary({
    platform: 'android',
    storage: {
      getItem() { return null; },
      setItem(_key, value) { raw = value; }
    }
  });
  library.upsert({
    name: 'Local template',
    description: '',
    columns: 1,
    rows: 1,
    deckScope: 'any',
    tarotMode: 'mixed',
    stackingMode: 'single',
    positions: [{ name: 'Position 1', meaning: '', column: 1, row: 1 }]
  });
  return JSON.parse(raw);
}

function fakeDocument() {
  const created = [];
  function element(initialID = '') {
    const listeners = new Map();
    const attributes = new Map();
    return {
      id: initialID,
      textContent: '',
      clickCount: 0,
      scrollCount: 0,
      lastClick: Promise.resolve(),
      children: [],
      inert: false,
      hidden: false,
      open: false,
      style: {},
      setAttribute(name, value) { attributes.set(name, String(value)); },
      removeAttribute(name) { attributes.delete(name); },
      getAttribute(name) { return attributes.has(name) ? attributes.get(name) : null; },
      addEventListener(type, listener) {
        if (!listeners.has(type)) listeners.set(type, []);
        listeners.get(type).push(listener);
      },
      appendChild(child) { this.children.push(child); },
      prepend(child) { this.children.unshift(child); },
      showModal() { this.open = true; },
      close() { this.open = false; },
      scrollIntoView() { this.scrollCount += 1; },
      click() {
        this.clickCount += 1;
        this.lastClick = Promise.all((listeners.get('click') || []).map(listener => listener({ preventDefault() {} })));
        return this.lastClick;
      }
    };
  }
  const menu = element('menu');
  const historyExport = element('historyExportBtn');
  const document = {
    documentElement: { lang: 'en', setAttribute() {}, removeAttribute() {} },
    body: element('body'),
    createElement() { const value = element(); created.push(value); return value; },
    querySelector(selector) { return selector === '#appMenu .menu-primary-actions' ? menu : null; },
    getElementById(id) {
      if (id === 'historyExportBtn') return historyExport;
      return created.find(value => value.id === id) || null;
    }
  };
  return { document, historyExport };
}

function guardedPersistence(manager) {
  const values = new Map();
  const storage = {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); }
  };
  const context = vm.createContext({
    console,
    TextEncoder,
    TextDecoder,
    setTimeout,
    clearTimeout,
    storage,
    DivinationBackup: manager,
    DivinationHistoryRecords: {
      MAX_RECORDS: 1000,
      validateRecord() {},
      isRecentDuplicate() { return false; },
      resolveImportedIds(records) { return { records }; },
      createId() { return 'id'; }
    }
  });
  ['custom-spreads.js', 'free-board-draft.js', 'history-store.js'].forEach(file => {
    vm.runInContext(
      fs.readFileSync(path.join(rootPath, 'ios-app/Quareia/Resources/www/js', file), 'utf8'),
      context,
      { filename: file }
    );
  });
  context.templateJSON = JSON.stringify({
    name: 'Local template', description: '', columns: 1, rows: 1,
    deckScope: 'any', tarotMode: 'mixed', stackingMode: 'single',
    positions: [{ name: 'Position 1', meaning: '', column: 1, row: 1 }]
  });
  vm.runInContext('library = DivinationCustomSpreads.createLibrary({ platform: "ios", storage });', context);
  vm.runInContext('history = DivinationHistoryStore.createStore({ recordsApi: DivinationHistoryRecords, indexedDB: null });', context);
  return context;
}

test('real public schema validators accept a complete empty backup and exclude telemetry state', async () => {
  const local = storage({
    [customSpreads.STORAGE_KEY]: JSON.stringify({ v: customSpreads.SCHEMA_VERSION, items: [] }),
    [backupModule.SETTINGS_KEYS.theme]: 'grove',
    [backupModule.SETTINGS_KEYS.locale]: 'en',
    'quareia-telemetry-install-id': 'must-not-export'
  });
  const manager = backupModule.createManager(realApis({
    storage: local,
    history: { async list() { return []; }, async replace() {} },
    journal: journal()
  }));

  const serialized = await manager.serialize();
  const parsed = manager.validate(serialized);
  assert.deepEqual(parsed.settings, { theme: 'grove', locale: 'en' });
  assert.deepEqual(Object.keys(parsed).sort(), ['customSpreads', 'draft', 'exportedAt', 'format', 'history', 'settings', 'version']);
  assert.equal(serialized.includes('telemetry'), false);
  assert.equal(serialized.includes('must-not-export'), false);
});

test('validation rejects unknown fields and malformed component schemas before mutation', async () => {
  const manager = backupModule.createManager(realApis({
    storage: storage(),
    history: { async list() { return []; }, async replace() {} },
    journal: journal()
  }));
  assert.throws(() => manager.validate({ ...emptyBackup(), telemetryID: 'x' }), { code: 'INVALID_BACKUP' });
  assert.throws(() => manager.validate({ ...emptyBackup(), settings: { theme: 'system', locale: 'en' } }), { code: 'INVALID_BACKUP' });
  assert.throws(() => manager.validate({ ...emptyBackup(), customSpreads: { v: 999, items: [] } }), { code: 'INVALID_BACKUP' });
  assert.throws(() => manager.validate({ ...emptyBackup(), customSpreads: { v: 999, items: [{}] } }), { code: 'INVALID_BACKUP' });
  const validLibrary = oneTemplateEnvelope();
  assert.throws(() => manager.validate({ ...emptyBackup(), customSpreads: { v: validLibrary.v, items: [validLibrary.items[0], validLibrary.items[0]] } }), { code: 'INVALID_BACKUP' });
  const invalidItem = structuredClone(validLibrary.items[0]);
  invalidItem.c = 0;
  assert.throws(() => manager.validate({ ...emptyBackup(), customSpreads: { v: validLibrary.v, items: [validLibrary.items[0], invalidItem] } }), { code: 'INVALID_BACKUP' });
  assert.throws(() => manager.validate({ ...emptyBackup(), draft: { schema: 'unknown' } }));
  assert.throws(() => manager.validate('{bad json'), { code: 'INVALID_BACKUP' });
  assert.throws(() => manager.validate(' '.repeat(backupModule.MAX_BYTES + 1)), { code: 'BACKUP_TOO_LARGE' });
  await assert.rejects(manager.restore({ ...emptyBackup(), version: 999 }), { code: 'INVALID_BACKUP' });
  assert.equal(manager.isMutating(), false);
  assert.equal(manager.isRecoveryRequired(), false);
});

test('backup operations reject overlap before a second operation can replace the journal', async () => {
  let releaseHistory;
  const historyStarted = new Promise(resolve => { releaseHistory = resolve; });
  let unblock;
  const blockedHistory = new Promise(resolve => { unblock = resolve; });
  const manager = backupModule.createManager(realApis({
    storage: storage(),
    journal: journal(),
    history: {
      async list() { releaseHistory(); await blockedHistory; return []; },
      async replace() {}
    }
  }));
  const restoring = manager.restore(emptyBackup());
  await historyStarted;
  await assert.rejects(manager.serialize(), { code: 'BACKUP_BUSY' });
  await assert.rejects(manager.recoverIfNeeded(), { code: 'BACKUP_BUSY' });
  unblock();
  await restoring;
});

test('restore journals the previous snapshot, applies every component, and clears only after success', async () => {
  const local = storage();
  const log = journal();
  const replaced = [];
  const manager = backupModule.createManager(realApis({
    storage: local,
    journal: log,
    history: {
      async list() { return []; },
      async replace(records) { replaced.push(structuredClone(records)); }
    }
  }));
  const result = await manager.restore(emptyBackup({ theme: 'parchment', locale: 'zh-CN' }));
  assert.deepEqual(result, { outcome: 'success', historyCount: 0, customSpreadCount: 0, hasDraft: false });
  assert.deepEqual(log.events, ['put', 'clear']);
  assert.equal(log.current(), null);
  assert.equal(replaced.length, 1);
  assert.equal(local.getItem(backupModule.SETTINGS_KEYS.theme), 'parchment');
  assert.equal(local.getItem(backupModule.SETTINGS_KEYS.locale), 'zh-CN');
  assert.equal(local.getItem(customSpreads.STORAGE_KEY), JSON.stringify({ v: customSpreads.SCHEMA_VERSION, items: [] }));
});

test('failed restore rolls local state and history back; failed rollback leaves a recovery journal', async () => {
  const previousLibrary = JSON.stringify({ v: customSpreads.SCHEMA_VERSION, items: [] });
  const local = storage({
    [customSpreads.STORAGE_KEY]: previousLibrary,
    [backupModule.SETTINGS_KEYS.theme]: 'celestial',
    [backupModule.SETTINGS_KEYS.locale]: 'en'
  });
  const log = journal();
  let replacements = 0;
  const manager = backupModule.createManager(realApis({
    storage: local,
    journal: log,
    history: {
      async list() { return []; },
      async replace() {
        replacements += 1;
        if (replacements === 1) throw Object.assign(new Error('write failed'), { code: 'WRITE_FAILED' });
      }
    }
  }));

  await assert.rejects(manager.restore(emptyBackup({ theme: 'grove', locale: 'zh-CN' })), { code: 'WRITE_FAILED' });
  assert.equal(replacements, 2);
  assert.equal(local.getItem(backupModule.SETTINGS_KEYS.theme), 'celestial');
  assert.equal(local.getItem(backupModule.SETTINGS_KEYS.locale), 'en');
  assert.equal(log.current(), null);
  assert.equal(manager.isMutating(), false);
  assert.equal(manager.isRecoveryRequired(), false);

  const dom = fakeDocument();
  const environment = {
    document: dom.document,
    dispatchEvent() {},
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } }
  };
  const pendingJournal = journal();
  let allowRecovery = false;
  const unrecoverable = backupModule.createManager(realApis({
    root: environment,
    storage: local,
    journal: pendingJournal,
    history: {
      async list() { return []; },
      async replace() { if (!allowRecovery) throw new Error('write unavailable'); }
    }
  }));
  await assert.rejects(unrecoverable.restore(emptyBackup({ theme: 'grove', locale: 'zh-CN' })), { code: 'RESTORE_ROLLBACK_PENDING' });
  assert.ok(pendingJournal.current());
  assert.equal(unrecoverable.isRecoveryRequired(), true);
  assert.equal(unrecoverable.isMutating(), true);
  assert.equal(dom.document.body.inert, true);
  assert.equal(dom.document.getElementById('iosBackupRecoveryAlert').open, true);
  assert.match(dom.document.getElementById('iosBackupRecoveryAlert').textContent, /Backup recovery is required/);
  await assert.rejects(unrecoverable.serialize(), { code: 'RECOVERY_REQUIRED' });

  const persistence = guardedPersistence(unrecoverable);
  assert.throws(
    () => vm.runInContext('library.upsert(JSON.parse(templateJSON))', persistence),
    error => error && error.code === 'CUSTOM_SPREAD_STORAGE'
  );
  assert.equal(vm.runInContext('DivinationFreeBoardDraft.discard(storage)', persistence), false);
  await assert.rejects(persistence.history.clearRecords(), /backup transaction is in progress/);
  await assert.rejects(unrecoverable.recoverIfNeeded(), /write unavailable/);
  assert.equal(unrecoverable.isMutating(), true);
  assert.equal(dom.document.body.inert, true);

  allowRecovery = true;
  assert.deepEqual(await unrecoverable.recoverIfNeeded(), { recovered: true });
  assert.equal(unrecoverable.isRecoveryRequired(), false);
  assert.equal(unrecoverable.isMutating(), false);
  assert.equal(dom.document.body.inert, false);
  assert.equal(dom.document.getElementById('iosBackupRecoveryAlert').open, false);
  assert.equal(dom.document.getElementById('iosBackupRecoveryAlert').hidden, true);
  assert.doesNotThrow(() => vm.runInContext('library.upsert(JSON.parse(templateJSON))', persistence));
});

test('invalid recovery journal stays visibly locked with localized recovery guidance', async () => {
  const dom = fakeDocument();
  dom.document.documentElement.lang = 'zh-CN';
  const environment = {
    document: dom.document,
    dispatchEvent() {},
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } }
  };
  const manager = backupModule.createManager(realApis({
    root: environment,
    storage: storage(),
    journal: journal({ key: backupModule.JOURNAL_KEY, phase: 'unknown', previous: emptyBackup() }),
    history: { async list() { return []; }, async replace() {} }
  }));

  await assert.rejects(manager.recoverIfNeeded(), { code: 'INVALID_JOURNAL' });
  assert.equal(manager.isRecoveryRequired(), true);
  assert.equal(manager.isMutating(), true);
  assert.equal(dom.document.body.inert, true);
  assert.match(dom.document.getElementById('iosBackupRecoveryAlert').textContent, /必须先恢复备份/);
  await assert.rejects(manager.createSnapshot(), { code: 'RECOVERY_REQUIRED' });
});

test('startup recovery applies the journal previous snapshot idempotently before clearing it', async () => {
  const previous = emptyBackup({ theme: 'ember', locale: 'en' });
  const local = storage({ [backupModule.SETTINGS_KEYS.theme]: 'grove' });
  const pending = journal({ key: backupModule.JOURNAL_KEY, phase: 'prepared', previous });
  let replacements = 0;
  const manager = backupModule.createManager(realApis({
    storage: local,
    journal: pending,
    history: { async list() { return []; }, async replace() { replacements += 1; } }
  }));
  assert.deepEqual(await manager.recoverIfNeeded(), { recovered: true });
  assert.equal(replacements, 1);
  assert.equal(local.getItem(backupModule.SETTINGS_KEYS.theme), 'ember');
  assert.equal(pending.current(), null);
  assert.deepEqual(await manager.recoverIfNeeded(), { recovered: false });
});

test('native backup actions use the public backup transfer kind and restore only validated text', async () => {
  const local = storage();
  const calls = [];
  const target = emptyBackup({ theme: 'parchment', locale: 'en' });
  const manager = backupModule.createManager(realApis({
    storage: local,
    journal: journal(),
    history: { async list() { return []; }, async replace() {} },
    nativeAdapter: {
      async exportText(...args) { calls.push(['export', ...args]); return { outcome: 'success', name: args[1] }; },
      async importText(kind) { calls.push(['import', kind]); return { outcome: 'success', name: 'backup.json', text: JSON.stringify(target) }; }
    }
  }));
  await manager.exportToNative('share');
  assert.equal(calls[0][0], 'export');
  assert.equal(calls[0][1], 'backup');
  assert.equal(calls[0][4], 'share');
  assert.deepEqual(await manager.importFromNative(), { outcome: 'success', historyCount: 0, customSpreadCount: 0, hasDraft: false });
  assert.deepEqual(calls[1], ['import', 'backup']);
});

test('native menu actions map to full backup export, history export, and full backup import', async () => {
  const dom = fakeDocument();
  const listeners = new Map();
  const nativeCalls = [];
  let menuOpen = false;
  const environment = {
    document: dom.document,
    DivinationMenu: { open() { menuOpen = true; }, isOpen() { return menuOpen; } },
    addEventListener(type, listener) { listeners.set(type, listener); },
    dispatchEvent() {},
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } }
  };
  const manager = backupModule.createManager(realApis({
    root: environment,
    storage: storage(),
    journal: journal(),
    history: { async list() { return []; }, async replace() {} },
    nativeAdapter: {
      async exportText(kind) { nativeCalls.push(['export', kind]); return { outcome: 'success', name: 'backup.json' }; },
      async importText(kind) { nativeCalls.push(['import', kind]); return { outcome: 'cancelled' }; }
    }
  }));
  assert.equal(manager.installUI(dom.document), true);
  const onMenu = listeners.get('quareia-native-menu');
  assert.equal(typeof onMenu, 'function');

  onMenu({ detail: { action: 'backup' } });
  await dom.document.getElementById('iosBackupExportBtn').lastClick;
  assert.equal(dom.document.getElementById('iosBackupStatus').textContent, 'Backup exported');
  assert.equal(menuOpen, true);
  assert.ok(dom.document.getElementById('iosBackupStatus').scrollCount > 0);
  dom.document.documentElement.lang = 'zh-CN';
  listeners.get('quareia:languagechange')();
  assert.equal(dom.document.getElementById('iosBackupStatus').textContent, '完整备份已导出');
  dom.document.documentElement.lang = 'en';
  listeners.get('quareia:languagechange')();
  onMenu({ detail: { action: 'export' } });
  menuOpen = false;
  const previousScrolls = dom.document.getElementById('iosBackupStatus').scrollCount;
  onMenu({ detail: { action: 'import' } });
  await dom.document.getElementById('iosBackupImportBtn').lastClick;
  assert.equal(menuOpen, true);
  assert.equal(dom.document.getElementById('iosBackupStatus').textContent, 'Backup restore cancelled');
  assert.ok(dom.document.getElementById('iosBackupStatus').scrollCount > previousScrolls);

  assert.deepEqual(nativeCalls, [['export', 'backup'], ['import', 'backup']]);
  assert.equal(dom.historyExport.clickCount, 1);

  const dialogs = [];
  environment.DivinationDialog = { async request(value) { dialogs.push(value); return false; } };
  dom.document.documentElement.lang = 'zh-CN';
  listeners.get('quareia:languagechange')();
  assert.equal(dom.document.getElementById('iosBackupExportBtn').textContent, '导出完整备份');
  assert.equal(dom.document.getElementById('iosBackupImportBtn').textContent, '恢复完整备份');
  assert.equal(dom.document.getElementById('iosBackupStatus').textContent, '已取消恢复备份');
  await dom.document.getElementById('iosBackupImportBtn').click();
  assert.deepEqual(dialogs, [{
    kicker: '本机备份',
    title: '恢复完整备份？',
    message: '当前本机的占卜历史、自定义牌阵、自由画板草稿、主题和语言将被替换。',
    cancelLabel: '取消',
    proceedLabel: '恢复'
  }]);
});
