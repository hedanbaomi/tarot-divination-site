// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const generated = path.join(root, 'ios-app/Quareia/Resources/www');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'ios-app/web-assets.json')));
const provenance = JSON.parse(fs.readFileSync(path.join(generated, 'provenance.json')));
const resources = JSON.parse(fs.readFileSync(path.join(generated, 'public-resources.json')));
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

test('generated bundle pins Android behavior and attributes the exact iOS build source', () => {
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  assert.deepEqual(Object.keys(provenance).sort(), ['buildSourceCommit', 'files', 'mode', 'schema', 'sourceCommit', 'transformations']);
  assert.equal(provenance.schema, 2);
  assert.equal(provenance.mode, 'public-ios-port');
  assert.equal(provenance.sourceCommit, 'c04e86f19eab2a5240b4109e11f18911fd043274');
  assert.equal(provenance.sourceCommit, manifest.sourceCommit);
  assert.equal(provenance.buildSourceCommit, head);
  assert.deepEqual(provenance.files.map(entry => entry.path), resources);
  assert.deepEqual(provenance.transformations.map(entry => entry.path), resources);
  provenance.files.forEach(entry => {
    assert.deepEqual(Object.keys(entry).sort(), ['outputSha256', 'path', 'source', 'sourceSha256']);
    assert.equal(sha(fs.readFileSync(path.join(generated, entry.path))), entry.outputSha256);
  });
});

test('public allowlist contains only manifest assets and the two reviewed overlays', () => {
  const expected = manifest.files.map(entry => entry.path).concat(manifest.overlays.map(entry => entry.path));
  assert.deepEqual(resources, expected);
  assert.equal(resources.includes('public-resources.json'), false);
  assert.equal(resources.includes('provenance.json'), false);
  assert.ok(resources.every(resource => /^(LICENSE\.md|index\.html|(?:js|css)\/[a-z0-9-]+\.(?:js|css))$/.test(resource)));
});

test('exact iOS transforms use QuareiaNative adapters without Android bridge spoofing', () => {
  const read = name => fs.readFileSync(path.join(generated, name), 'utf8');
  const html = read('index.html');
  assert.ok(html.indexOf('js/ios-native-adapter.js') < html.indexOf('js/theme.js'));
  assert.ok(html.indexOf('js/ios-backup.js') < html.indexOf('js/history-ui.js'));
  assert.equal(html.includes('js/announcements.js'), false);
  assert.equal(html.includes('js/telemetry-notice.js'), false);
  assert.equal(html.includes('iOS feasibility build'), false);

  assert.match(read('js/theme.js'), /QuareiaIOS\.setTheme\(id\)/);
  assert.match(read('js/i18n.js'), /QuareiaIOS\.setLocale\(locale\)/);
  assert.match(read('js/menu.js'), /QuareiaIOS\.presentAbout\(\)/);
  assert.match(read('js/app.js'), /platform: "ios"/);
  assert.match(read('js/app.js'), /QuareiaIOSBackup/);
  assert.match(read('js/app.js'), /backup\.showRecoveryNotice\(\)/);
  assert.equal(read('js/app.js').includes('Local backup recovery failed'), false);
  assert.match(read('js/custom-spreads.js'), /platform !== "ios"/);
  assert.match(read('js/history-ui.js'), /exportText\("history"/);
  assert.match(read('js/history-ui.js'), /importText\("history"\)/);
  assert.match(read('js/custom-spread-ui.js'), /exportText\("qsp"/);
  assert.match(read('js/free-board-draft.js'), /function discard[\s\S]*DivinationBackup\.isMutating\(\)/);
  assert.match(read('js/custom-spreads.js'), /function persist[\s\S]*DivinationBackup\.isMutating\(\)/);
  assert.match(read('js/history-store.js'), /mode === "readwrite"[\s\S]*DivinationBackup\.isMutating\(\)/);
  assert.match(read('js/ios-backup.js'), /action === "backup"[\s\S]*exportButton\.click\(\)/);
  assert.match(read('js/ios-backup.js'), /action === "import"[\s\S]*importButton\.click\(\)/);
  assert.match(read('js/ios-backup.js'), /action === "export"[\s\S]*historyExport\.click\(\)/);
  assert.equal(read('js/theme.js').includes('androidThemeChrome'), false);
  assert.equal(read('js/menu.js').includes('androidAbout'), false);
  assert.equal(read('js/app.js').includes('androidTelemetry'), false);
  assert.equal(read('js/history-ui.js').includes('androidHistoryExport'), false);
  assert.equal(read('js/ios-native-adapter.js').includes('androidHistoryExport'), false);
});

test('generated persistence modules reject writes while backup restore owns local state', async () => {
  const context = vm.createContext({
    console,
    TextEncoder,
    TextDecoder,
    setTimeout,
    clearTimeout,
    DivinationBackup: { isMutating() { return true; } },
    DivinationHistoryRecords: {
      MAX_RECORDS: 1000,
      validateRecord() {},
      isRecentDuplicate() { return false; },
      resolveImportedIds(records) { return { records }; },
      createId() { return 'id'; }
    }
  });
  vm.runInContext(readGenerated('js/custom-spreads.js'), context);
  vm.runInContext(readGenerated('js/free-board-draft.js'), context);
  vm.runInContext(readGenerated('js/history-store.js'), context);
  context.templateJSON = JSON.stringify({
    name: 'Local template', description: '', columns: 1, rows: 1,
    deckScope: 'any', tarotMode: 'mixed', stackingMode: 'single',
    positions: [{ name: 'Position 1', meaning: '', column: 1, row: 1 }]
  });
  context.storage = {
    getItem() { return null; },
    setItem() { throw new Error('write reached storage'); },
    removeItem() { throw new Error('delete reached storage'); }
  };

  vm.runInContext('library = DivinationCustomSpreads.createLibrary({ platform: "ios", storage });', context);
  assert.throws(
    () => vm.runInContext('library.upsert(JSON.parse(templateJSON));', context),
    error => error && error.code === 'CUSTOM_SPREAD_STORAGE'
  );
  assert.throws(
    () => vm.runInContext('DivinationFreeBoardDraft.save(storage, "{}")', context),
    /backup transaction is in progress/
  );
  assert.equal(vm.runInContext('DivinationFreeBoardDraft.discard(storage)', context), false);
  vm.runInContext('history = DivinationHistoryStore.createStore({ recordsApi: DivinationHistoryRecords, indexedDB: null });', context);
  await assert.rejects(context.history.clearRecords(), /backup transaction is in progress/);
});

function readGenerated(name) {
  return fs.readFileSync(path.join(generated, name), 'utf8');
}
