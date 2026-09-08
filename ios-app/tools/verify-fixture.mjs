// SPDX-License-Identifier: MPL-2.0
// Requires the explicit, isolated cloud-test.sh loopback fixture.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

const base = 'http://127.0.0.1:8787';
async function mode(value) {
  const response = await fetch(`${base}/__fixture/update-mode`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ mode: value }), signal: AbortSignal.timeout(3000)
  });
  assert.equal(response.status, 200);
}
try {
  await mode('blocked');
  const manifestResponse = await fetch(`${base}/v1/ios-update`, { signal: AbortSignal.timeout(3000) });
  assert.equal(manifestResponse.status, 200);
  const manifest = await manifestResponse.json();
  assert.deepEqual(Object.keys(manifest).sort(), ['build', 'ipa_url', 'minimum_ios', 'platform', 'schema_version', 'sha256', 'size', 'version']);
  assert.equal(manifest.version, '1.0.1');
  assert.equal(manifest.minimum_ios, '16.0');
  assert.equal(manifest.ipa_url, `${base}/fixtures/Quareia-1.0.1-2.ipa`);
  assert.equal(manifest.platform, 'ios');
  assert.equal(manifest.build, 2);
  const cancellation = new AbortController();
  const headerTimeout = setTimeout(() => cancellation.abort(), 3000);
  let blocked;
  try { blocked = await fetch(manifest.ipa_url, { signal: cancellation.signal }); }
  finally { clearTimeout(headerTimeout); }
  const stateResponse = await fetch(`${base}/__fixture/update-state`, { signal: AbortSignal.timeout(3000) });
  assert.equal(stateResponse.status, 200);
  assert.equal((await stateResponse.json()).activeDownloads, 1);
  cancellation.abort();
  await assert.rejects(blocked.arrayBuffer(), /abort/i);
  await mode('normal');
  const complete = await fetch(manifest.ipa_url, { signal: AbortSignal.timeout(5000) });
  const bytes = Buffer.from(await complete.arrayBuffer());
  assert.equal(bytes.length, manifest.size);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), manifest.sha256);
  assert.match(bytes.toString('utf8'), /not an installable application archive/);
  assert.equal(complete.headers.get('cache-control'), 'no-store');
  console.log('ISOLATED_UPDATE_FIXTURE_HASH_SIZE_CANCEL_PASS');
} finally { await mode('normal'); }
