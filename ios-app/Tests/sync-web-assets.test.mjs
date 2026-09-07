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

test('first-launch system language and stored overrides synchronize native iOS surfaces', () => {
  for (const [language, stored, expected] of [
    ['en-US', null, 'en'], ['zh-TW', null, 'zh-CN'],
    ['fr-FR', null, 'en'], ['en-US', 'zh-CN', 'zh-CN']
  ]) {
    const calls = [];
    const writes = [];
    const context = vm.createContext({
      navigator: { language },
      localStorage: { getItem: () => stored, setItem: (...args) => writes.push(args) },
      QuareiaIOS: { setLocale: value => calls.push(value) },
      document: {
        documentElement: { setAttribute() {} },
        querySelector: () => null, querySelectorAll: () => [], getElementById: () => null
      }
    });
    vm.runInContext(readGenerated('js/i18n.js'), context);
    assert.equal(context.DivinationI18n.getLocale(), expected);
    assert.deepEqual(calls, [expected]);
    assert.deepEqual(writes, [], 'System language synchronization must not create a manual preference');
    const next = expected === 'en' ? 'zh-CN' : 'en';
    context.DivinationI18n.setLocale(next);
    assert.deepEqual(calls, [expected, next]);
    assert.deepEqual(writes, [['quareia-divination-locale', next]]);
  }
});

test('generated bundle pins Android behavior and attributes the exact iOS build source', () => {
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  assert.deepEqual(Object.keys(provenance).sort(), ['buildSourceCommit', 'files', 'mode', 'schema', 'sourceCommit', 'transformations']);
  assert.equal(provenance.schema, 2);
  assert.equal(provenance.mode, 'public-ios-port');
  assert.equal(provenance.sourceCommit, 'c04e86f19eab2a5240b4109e11f18911fd043274');
  assert.equal(provenance.sourceCommit, manifest.sourceCommit);
  assert.equal(manifest.schema, 3);
  assert.equal(provenance.buildSourceCommit, head);
  assert.deepEqual(provenance.files.map(entry => entry.path), resources);
  assert.deepEqual(provenance.transformations.map(entry => entry.path), resources);
  provenance.files.forEach(entry => {
    assert.deepEqual(Object.keys(entry).sort(), ['outputSha256', 'path', 'source', 'sourceSha256']);
    assert.equal(sha(fs.readFileSync(path.join(generated, entry.path))), entry.outputSha256);
  });
});

test('public allowlist contains only the explicit text, binary, and overlay manifests', () => {
  const expected = manifest.files.map(entry => entry.path)
    .concat(manifest.binaryFiles.map(entry => entry.path), manifest.overlays.map(entry => entry.path));
  assert.deepEqual(resources, expected);
  assert.equal(resources.includes('public-resources.json'), false);
  assert.equal(resources.includes('provenance.json'), false);
  assert.ok(resources.every(resource => /^(?:LICENSE\.md|index\.html|(?:js|css)\/[a-z0-9-]+\.(?:js|css)|assets\/cards\/(?:major-(?:0[0-9]|1[0-9]|2[01])|minor-(?:cups|pentacles|swords|wands)-(?:ace|two|three|four|five|six|seven|eight|nine|ten|page|knight|queen|king)|m\/m-(?:back|0[1-9]|[1-6][0-9]|7[0-8]))\.jpeg|assets\/icons\/(?:parchment-sun(?:-blank)?|sky-face-(?:celestial|ember|grove))\.png)$/.test(resource)));
});

test('the complete frozen public card and theme icon inventory is copied byte-for-byte without LXXXI artwork', () => {
  const binaryPaths = manifest.binaryFiles.map(entry => entry.path);
  const cardPaths = binaryPaths.filter(item => item.startsWith('assets/cards/'));
  const iconPaths = binaryPaths.filter(item => item.startsWith('assets/icons/'));
  const tarot = cardPaths.filter(item => !item.startsWith('assets/cards/m/'));
  const mystagogus = cardPaths.filter(item => item.startsWith('assets/cards/m/'));
  assert.equal(binaryPaths.length, 162);
  assert.equal(new Set(binaryPaths).size, 162);
  assert.equal(cardPaths.length, 157);
  assert.equal(iconPaths.length, 5);
  assert.equal(tarot.length, 78);
  assert.equal(mystagogus.length, 79);
  assert.equal(mystagogus.includes('assets/cards/m/m-back.jpeg'), true);
  assert.equal(binaryPaths.some(item => /lxxxi/i.test(item)), false);
  assert.equal(resources.filter(item => item.endsWith('.jpeg')).length, 157);
  assert.deepEqual(iconPaths.slice().sort(), [
    'assets/icons/parchment-sun-blank.png',
    'assets/icons/parchment-sun.png',
    'assets/icons/sky-face-celestial.png',
    'assets/icons/sky-face-ember.png',
    'assets/icons/sky-face-grove.png'
  ]);

  for (const entry of manifest.binaryFiles) {
    const source = `android-demo/app/src/main/assets/www/${entry.path}`;
    const sourceBytes = execFileSync('git', ['show', `${manifest.sourceCommit}:${source}`], {
      cwd: root,
      maxBuffer: 8 * 1024 * 1024
    });
    const generatedBytes = fs.readFileSync(path.join(generated, entry.path));
    assert.equal(sha(sourceBytes), entry.sha256);
    assert.equal(sha(generatedBytes), entry.sha256);
    assert.equal(sourceBytes.equals(generatedBytes), true);
    const provenanceIndex = resources.indexOf(entry.path);
    assert.equal(provenance.files[provenanceIndex].sourceSha256, entry.sha256);
    assert.equal(provenance.files[provenanceIndex].outputSha256, entry.sha256);
    assert.deepEqual(provenance.transformations[provenanceIndex], {
      path: entry.path,
      steps: ['exact binary copy']
    });
  }
});

test('generated Tarot and Mystagogus getters retain the exact bundled JPEG paths', () => {
  const context = vm.createContext({});
  vm.runInContext(readGenerated('js/tarot-data.js'), context);
  vm.runInContext(readGenerated('js/mystagogus-data.js'), context);
  const actual = JSON.parse(vm.runInContext(
    'JSON.stringify(tarotDeckFull.map(card => card.image).concat(mystagogusDeckFull.map(card => card.image)))',
    context
  ));
  const expected = manifest.binaryFiles.map(entry => entry.path)
    .filter(item => item.startsWith('assets/cards/') && item !== 'assets/cards/m/m-back.jpeg');
  assert.equal(actual.length, 156);
  assert.deepEqual(actual.slice().sort(), expected.slice().sort());
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
  assert.match(read('js/app.js'), /Promise\.all\(\[nativeAdapter\.ready, backup\.ready\]\)/);
  assert.match(read('js/app.js'), /无法初始化 iOS 宿主服务/);
  assert.match(read('js/app.js'), /iOS host initialization failed/);
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

test('generated LXXXI getters resolve only through the validated per-document host token', async () => {
  const protectedAssetBaseURL = 'quareia-app://app/_m/123e4567-e89b-42d3-a456-426614174000123e4567-e89b-42d3-a456-426614174001';
  const context = vm.createContext({ console, TextEncoder, TextDecoder, Buffer });
  context.protectedAssetBaseURL = protectedAssetBaseURL;
  vm.runInContext(`
    window = globalThis;
    QuareiaNative = {
      request: function (envelope) {
        if (envelope.method !== "hostInfo") throw new Error("unexpected method " + envelope.method);
        return { protectedAssetBaseURL: protectedAssetBaseURL };
      }
    };
  `, context);
  vm.runInContext(readGenerated('js/lxxxi-data.js'), context);
  vm.runInContext(readGenerated('js/ios-native-adapter.js'), context);
  await context.QuareiaIOS.ready;

  const values = vm.runInContext('JSON.stringify([getLxxxiBackImage(), lxxxiDeckFull[0].image, lxxxiDeckFull[80].image])', context);
  assert.deepEqual(JSON.parse(values), [
    `${protectedAssetBaseURL}/lxxxi-back`,
    `${protectedAssetBaseURL}/lxxxi-01`,
    `${protectedAssetBaseURL}/lxxxi-81`
  ]);
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
