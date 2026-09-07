// SPDX-License-Identifier: MPL-2.0
// Explicit Git objects only: no recursive working tree copy or private inputs.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'ios-app/web-assets.json')));
const dest = path.join(root, 'ios-app/Quareia/Resources/www');
const check = process.argv.includes('--check');
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
if (!/^[a-f0-9]{40}$/.test(manifest.sourceCommit)) throw Error('Invalid source commit');
const expected = new Map(), provenance = [];
for (const entry of manifest.files) {
  if (!/^(LICENSE\.md|index\.html|(?:js|css)\/[a-z0-9-]+\.(?:js|css))$/.test(entry.path)) throw Error('Non-public path');
  if (expected.has(entry.path)) throw Error('Duplicate path');
  const source = `android-demo/app/src/main/assets/www/${entry.path}`;
  const bytes = execFileSync('git', ['show', `${manifest.sourceCommit}:${source}`], { cwd: root, maxBuffer: 8 * 1024 * 1024 });
  if (sha(bytes) !== entry.sha256) throw Error(`Source hash mismatch: ${entry.path}`);
  let output = bytes.toString('utf8').replace(/\r\n/g, '\n');
  if (entry.path === 'index.html') {
    output = output.replace(/\s*<script src="js\/(announcements|telemetry-notice)\.js[^"\n]*"><\/script>/g, '');
    output = output.replace('<head>', '<head>\n<meta http-equiv="Content-Security-Policy" content="default-src \'self\'; script-src \'self\' \'unsafe-inline\'; style-src \'self\' \'unsafe-inline\'; img-src \'self\' data:; connect-src \'none\'; frame-src \'none\'; object-src \'none\'; base-uri \'none\'; form-action \'none\'">');
    output = output.replace(/\?v=[^"\s]+/g, '');
    output = output.replace('<body>', '<body>\n<p role="status">iOS feasibility build: card artwork and native services pending.</p>');
  }
  const result = Buffer.from(output);
  expected.set(entry.path, result);
  provenance.push({ path: entry.path, source, sourceSha256: entry.sha256, outputSha256: sha(result) });
}
expected.set('public-resources.json', Buffer.from(JSON.stringify([...expected.keys()], null, 2) + '\n'));
expected.set('provenance.json', Buffer.from(JSON.stringify({ schema: 1, mode: 'public-prototype', sourceCommit: manifest.sourceCommit, transformations: ['LF normalization', 'P0 announcements/telemetry script tags omitted', 'offline CSP', 'HTML cache query removal', 'prototype notice'], files: provenance }, null, 2) + '\n'));
function files(dir, prefix = '') {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    if (e.isSymbolicLink()) throw Error('Symlink in generated bundle');
    return e.isDirectory() ? files(path.join(dir, e.name), prefix + e.name + '/') : [prefix + e.name];
  });
}
for (const name of files(dest)) if (!expected.has(name)) throw Error(`Unexpected generated resource: ${name}`);
for (const [name, bytes] of expected) {
  const target = path.join(dest, name);
  if (check) {
    if (!fs.existsSync(target) || !fs.readFileSync(target).equals(bytes)) throw Error(`Stale/missing resource: ${name}`);
  } else {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, bytes);
  }
}
console.log(`iOS public bundle ${check ? 'CHECK' : 'GENERATED'}: ${expected.size} files; source ${manifest.sourceCommit}; no artwork/private inputs`);
