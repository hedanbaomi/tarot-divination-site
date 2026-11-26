#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const pages = ['index.html', 'classic.html', 'ai.html'];
const args = process.argv.slice(2);
let root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
let fix = false;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--fix') fix = true;
  else if (args[i] === '--root' && args[i + 1]) root = resolve(args[++i]);
  else {
    console.error('Usage: node scripts/check-asset-versions.mjs [--fix] [--root directory]');
    process.exit(2);
  }
}

// Scan start tags without interpreting comments or raw-text contents as markup.
// Attribute offsets point into the original string, so edits preserve all other bytes.
function tags(html) {
  const result = [];
  let i = 0;
  let raw = null;
  while (i < html.length) {
    if (raw) {
      const close = new RegExp(`</${raw}(?=[\\s/>])`, 'ig');
      close.lastIndex = i;
      const match = close.exec(html);
      if (!match) break;
      i = match.index;
      raw = null;
    }
    const start = html.indexOf('<', i);
    if (start < 0) break;
    if (html.startsWith('<!--', start)) {
      const end = html.indexOf('-->', start + 4);
      if (end < 0) break;
      i = end + 3;
      continue;
    }
    const nameMatch = /^<([a-z][a-z0-9:-]*)(?=[\s/>])/i.exec(html.slice(start));
    if (!nameMatch) { i = start + 1; continue; }
    const name = nameMatch[1].toLowerCase();
    let p = start + nameMatch[0].length;
    const attrs = new Map();
    while (p < html.length) {
      while (/\s/.test(html[p] || '')) p++;
      if (html[p] === '>') { p++; break; }
      if (html[p] === '/' && html[p + 1] === '>') { p += 2; break; }
      if (p >= html.length) break;
      const attrStart = p;
      while (p < html.length && !/[\s=/>]/.test(html[p])) p++;
      if (p === attrStart) { p++; continue; }
      const attrName = html.slice(attrStart, p).toLowerCase();
      while (/\s/.test(html[p] || '')) p++;
      let value = '';
      let valueStart = p;
      if (html[p] === '=') {
        p++;
        while (/\s/.test(html[p] || '')) p++;
        const quote = html[p] === '"' || html[p] === "'" ? html[p++] : null;
        valueStart = p;
        if (quote) {
          while (p < html.length && html[p] !== quote) p++;
        } else {
          while (p < html.length && !/[\s>]/.test(html[p])) p++;
        }
        value = html.slice(valueStart, p);
        if (quote && html[p] === quote) p++;
      }
      // Browsers use the first occurrence of a duplicate attribute.
      if (!attrs.has(attrName)) attrs.set(attrName, { value, start: valueStart });
    }
    if (name === 'script' || name === 'link') result.push({ name, attrs, start });
    if (['script', 'style', 'textarea', 'title', 'xmp', 'iframe', 'noembed', 'noframes'].includes(name)) raw = name;
    i = p;
  }
  return result;
}

function localPath(url) {
  const path = url.split(/[?#]/, 1)[0];
  // Dynamic/template expressions and entities cannot be resolved statically.
  if (/[{}<>$`\\&]/.test(path) || /[{}<>$`]/.test(url)) return null;
  let decoded;
  try { decoded = decodeURIComponent(path); } catch { return null; }
  const relative = decoded.replace(/^(?:\.\/|\/)/, '');
  if (!/^(?:js|css)\//.test(relative) || /[\\{}<>$`]/.test(relative)) return null;
  const folder = resolve(root, relative.split('/')[0]);
  const full = resolve(root, relative);
  return full.startsWith(folder + sep) ? full : null;
}

function withVersion(url, expected) {
  const hashAt = url.indexOf('#');
  const beforeHash = hashAt < 0 ? url : url.slice(0, hashAt);
  const fragment = hashAt < 0 ? '' : url.slice(hashAt);
  const queryAt = beforeHash.indexOf('?');
  const path = queryAt < 0 ? beforeHash : beforeHash.slice(0, queryAt);
  if (queryAt < 0) return { current: [], next: `${path}?v=${expected}${fragment}` };
  const query = beforeHash.slice(queryAt + 1);
  const parts = query.split(/(&(?:amp;)?)/);
  const values = [];
  const kept = [];
  for (let i = 0; i < parts.length; i += 2) {
    const part = parts[i];
    const delimiter = i === 0 ? '' : parts[i - 1];
    if (/^v(?:=|$)/.test(part)) {
      values.push(part.includes('=') ? part.slice(2) : '');
      if (values.length > 1) continue;
      kept.push(delimiter + `v=${expected}`);
    } else kept.push(delimiter + part);
  }
  let updated = kept.join('');
  if (!values.length) updated += (updated ? '&' : '') + `v=${expected}`;
  return { current: values, next: `${path}?${updated}${fragment}` };
}

let problems = 0;
let changes = 0;
for (const page of pages) {
  const pagePath = resolve(root, page);
  let html;
  try { html = readFileSync(pagePath, 'utf8'); }
  catch (error) { console.error(`${page}: cannot read page: ${error.message}`); problems++; continue; }
  const edits = [];
  for (const tag of tags(html)) {
    if (tag.name === 'link' && !/(?:^|\s)stylesheet(?:\s|$)/i.test(tag.attrs.get('rel')?.value ?? '')) continue;
    const attr = tag.attrs.get(tag.name === 'script' ? 'src' : 'href');
    if (!attr) continue;
    const asset = localPath(attr.value);
    if (!asset) continue;
    const line = html.slice(0, tag.start).split('\n').length;
    let expected;
    // Normalize CRLF to LF before hashing so Windows and Linux checkouts agree.
    try {
      const content = readFileSync(asset, 'utf8').replace(/\r\n/g, '\n');
      expected = createHash('sha256').update(content, 'utf8').digest('hex').slice(0, 8);
    }
    catch (error) { console.error(`${page}:${line}: cannot read asset ${attr.value}: ${error.message}`); problems++; continue; }
    const version = withVersion(attr.value, expected);
    if (version.current.length === 1 && version.current[0] === expected) continue;
    console.error(`${page}:${line}: ${version.current.length ? 'stale or duplicate' : 'missing'} version\n  - ${attr.value}\n  + ${version.next}`);
    if (fix) { edits.push({ start: attr.start, end: attr.start + attr.value.length, value: version.next }); changes++; }
    else problems++;
  }
  if (edits.length) {
    for (const edit of edits.reverse()) html = html.slice(0, edit.start) + edit.value + html.slice(edit.end);
    writeFileSync(pagePath, html, 'utf8');
  }
}
if (fix && changes) console.log(`Updated ${changes} asset URL(s).`);
if (!problems && !changes) console.log('Asset versions are current.');
if (problems) process.exitCode = 1;
