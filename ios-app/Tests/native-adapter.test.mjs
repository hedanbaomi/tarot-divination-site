// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const adapterModule = require('../web/ios-native-adapter.js');
const TRANSFER_ID = '123e4567-e89b-42d3-a456-426614174000';
const TOKEN_A = '123e4567-e89b-42d3-a456-426614174000123e4567-e89b-42d3-a456-426614174001';
const TOKEN_B = '123e4567-e89b-42d3-a456-426614174002123e4567-e89b-42d3-a456-426614174003';
const PROTECTED_BASE_A = `quareia-app://app/_m/${TOKEN_A}`;
const PROTECTED_BASE_B = `quareia-app://app/_m/${TOKEN_B}`;

function withHostInfo(handler, protectedAssetBaseURL = PROTECTED_BASE_A) {
  return {
    request(envelope) {
      if (envelope.method === 'hostInfo') return { protectedAssetBaseURL };
      return handler(envelope);
    }
  };
}

test('native adapter preserves the frozen metadata-only bridge contract', async () => {
  const calls = [];
  const adapter = adapterModule.createAdapter({
    root: {},
    native: withHostInfo(function (envelope) {
        calls.push(envelope);
        return Promise.resolve({ accepted: true });
    })
  });

  await adapter.ready;

  await adapter.setTheme('grove');
  await adapter.setLocale('en');
  await adapter.presentAbout();
  await adapter.readingCompleted('tarot', 3);
  await adapter.setTelemetryEnabled(false);

  assert.deepEqual(calls.map(call => [call.method, call.params]), [
    ['setTheme', { theme: 'grove' }],
    ['setLocale', { locale: 'en' }],
    ['presentAbout', {}],
    ['readingCompleted', { deckType: 'tarot', cardCount: 3 }],
    ['setTelemetryEnabled', { enabled: false }]
  ]);
  calls.forEach(call => assert.match(call.id, /^[A-Za-z0-9_-]{1,64}$/));
  assert.equal(new Set(calls.map(call => call.id)).size, calls.length);
});

test('export sends bounded decoded chunks in sequence and validates acknowledgements', async () => {
  const text = '测'.repeat(22000);
  const source = new TextEncoder().encode(text);
  const received = [];
  const adapter = adapterModule.createAdapter({
    root: {},
    native: withHostInfo(function ({ method, params }) {
        if (method === 'fileExportBegin') {
          assert.deepEqual(params, { kind: 'backup', name: 'backup.json', byteCount: source.length });
          return { transferID: TRANSFER_ID };
        }
        if (method === 'fileExportChunk') {
          const chunk = Buffer.from(params.base64, 'base64');
          assert.ok(chunk.length <= adapterModule.CHUNK_BYTES);
          received.push(chunk);
          return { offset: params.offset, byteCount: chunk.length, nextOffset: params.offset + chunk.length };
        }
        if (method === 'fileExportFinish') {
          assert.deepEqual(params, { transferID: TRANSFER_ID, action: 'save' });
          return { outcome: 'success', name: 'backup.json' };
        }
        throw new Error(`unexpected method ${method}`);
    })
  });

  await adapter.ready;

  const result = await adapter.exportText('backup', 'backup.json', text, 'save');
  assert.deepEqual(result, { outcome: 'success', name: 'backup.json' });
  assert.deepEqual(Buffer.concat(received), Buffer.from(source));
  assert.ok(received.length >= 3);
});

test('import reads sequential chunks, requires declared completion, and decodes UTF-8', async () => {
  const text = JSON.stringify({ value: '本机备份'.repeat(9000) });
  const source = Buffer.from(text, 'utf8');
  const calls = [];
  const adapter = adapterModule.createAdapter({
    root: {},
    native: withHostInfo(function ({ method, params }) {
        calls.push(method);
        if (method === 'fileImport') {
          return { outcome: 'success', transferID: TRANSFER_ID, name: 'backup.json', byteCount: source.length };
        }
        if (method === 'fileImportRead') {
          const chunk = source.subarray(params.offset, params.offset + params.length);
          return {
            base64: chunk.toString('base64'),
            offset: params.offset,
            byteCount: chunk.length,
            eof: params.offset + chunk.length === source.length
          };
        }
        if (method === 'fileImportFinish') return {};
        throw new Error(`unexpected method ${method}`);
    })
  });

  await adapter.ready;

  const result = await adapter.importText('backup');
  assert.deepEqual(result, { outcome: 'success', name: 'backup.json', text });
  assert.equal(calls.at(-1), 'fileImportFinish');
  assert.ok(calls.filter(method => method === 'fileImportRead').length >= 3);
});

test('transfer failures cancel the exact in-flight transfer and invalid metadata fails locally', async () => {
  const calls = [];
  const adapter = adapterModule.createAdapter({
    root: {},
    native: withHostInfo(function ({ method, params }) {
        calls.push([method, params]);
        if (method === 'fileExportBegin') return { transferID: TRANSFER_ID };
        if (method === 'fileExportChunk') return { offset: params.offset, byteCount: 0, nextOffset: params.offset };
        if (method === 'fileTransferCancel') return {};
        throw new Error(`unexpected method ${method}`);
    })
  });

  await adapter.ready;

  await assert.rejects(adapter.exportText('qsp', 'spread.txt', 'QSP2.example.hash'), { code: 'INVALID_NATIVE_REPLY' });
  assert.deepEqual(calls.at(-1), ['fileTransferCancel', { transferID: TRANSFER_ID }]);
  assert.throws(() => adapter.setTheme('system'), { code: 'INVALID_THEME' });
  assert.throws(() => adapter.readingCompleted('tarot', 0), { code: 'INVALID_CARD_COUNT' });
  assert.throws(() => adapter.readingCompleted('tarot', 79), { code: 'INVALID_CARD_COUNT' });
  assert.throws(() => adapter.readingCompleted('mystagogus', 82), { code: 'INVALID_CARD_COUNT' });
  await assert.rejects(adapter.exportText('settings', 'x.json', '{}'), { code: 'INVALID_FILE_KIND' });
  await assert.rejects(adapter.exportText('backup', '../x.json', '{}'), { code: 'INVALID_FILE_NAME' });
});

test('cancelled import does not start a read transfer', async () => {
  const calls = [];
  const adapter = adapterModule.createAdapter({
    root: {},
    native: withHostInfo(function ({ method }) { calls.push(method); return { outcome: 'cancelled' }; })
  });
  await adapter.ready;
  assert.deepEqual(await adapter.importText('history'), { outcome: 'cancelled' });
  assert.deepEqual(calls, ['fileImport']);
});

test('failed import preserves the declared picker outcome without starting a transfer', async () => {
  const calls = [];
  const adapter = adapterModule.createAdapter({
    root: {},
    native: withHostInfo(function ({ method }) { calls.push(method); return { outcome: 'failure' }; })
  });
  await adapter.ready;
  assert.deepEqual(await adapter.importText('backup'), { outcome: 'failure' });
  assert.deepEqual(calls, ['fileImport']);
});

test('ready installs only an exact per-document protected asset base as a read-only value', async () => {
  const environment = {};
  const adapter = adapterModule.createAdapter({
    root: environment,
    native: withHostInfo(function () { throw new Error('unexpected request'); })
  });

  const info = await adapter.ready;
  assert.equal(info.protectedAssetBaseURL, PROTECTED_BASE_A);
  assert.equal(environment.__qMediaBase, PROTECTED_BASE_A);
  assert.deepEqual(Object.getOwnPropertyDescriptor(environment, '__qMediaBase'), {
    value: PROTECTED_BASE_A,
    writable: false,
    enumerable: false,
    configurable: false
  });
  assert.throws(() => { environment.__qMediaBase = 'https://example.invalid'; }, TypeError);
});

test('ready rejects URL variants and never installs an invalid media base', async () => {
  const invalid = [
    'https://app/_m/' + TOKEN_A,
    'quareia-app://user@app/_m/' + TOKEN_A,
    'quareia-app://app:443/_m/' + TOKEN_A,
    'quareia-app://app/_m/' + TOKEN_A.toUpperCase(),
    'quareia-app://app/_m/' + TOKEN_A + '/',
    'quareia-app://app/_m/' + TOKEN_A + '?cache=1',
    'quareia-app://app/_m/' + TOKEN_A + '#fragment',
    'quareia-app://app/_m/' + TRANSFER_ID,
    'quareia-app://app/_m/' + TOKEN_A + '/lxxxi-01',
    'quareia-app://app/_m/123e4567-e89b-02d3-a456-426614174000' + TOKEN_A.slice(36)
  ];

  for (const protectedAssetBaseURL of invalid) {
    const environment = {};
    const adapter = adapterModule.createAdapter({
      root: environment,
      native: withHostInfo(function () { throw new Error('unexpected request'); }, protectedAssetBaseURL)
    });
    await assert.rejects(adapter.ready, { code: 'INVALID_HOST_INFO' });
    assert.equal(Object.hasOwn(environment, '__qMediaBase'), false);
  }
});

test('each fresh document receives only the token returned by its own host handshake', async () => {
  const firstRoot = {};
  const secondRoot = {};
  const first = adapterModule.createAdapter({
    root: firstRoot,
    native: withHostInfo(function () { throw new Error('unexpected request'); }, PROTECTED_BASE_A)
  });
  const second = adapterModule.createAdapter({
    root: secondRoot,
    native: withHostInfo(function () { throw new Error('unexpected request'); }, PROTECTED_BASE_B)
  });

  await Promise.all([first.ready, second.ready]);
  assert.equal(firstRoot.__qMediaBase, PROTECTED_BASE_A);
  assert.equal(secondRoot.__qMediaBase, PROTECTED_BASE_B);
  assert.notEqual(firstRoot.__qMediaBase, secondRoot.__qMediaBase);
});
