import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

test('standalone subtitle editor has every referenced control and only local assets', () => {
  const html = readFileSync('subtitle-editor.html', 'utf8');
  const script = readFileSync('js/subtitle-editor.js', 'utf8');
  const ids = [...html.matchAll(/id="([^"]+)"/g)].map(match => match[1]);
  assert.equal(new Set(ids).size, ids.length);
  for (const [, id] of script.matchAll(/\$\(['"]([^'"]+)['"]\)/g)) assert.ok(ids.includes(id), id);
  for (const [, path] of html.matchAll(/(?:src|href)="\.\/([^"#?]+)(?:\?[^"#]*)?"/g)) assert.ok(existsSync(path), path);
  assert.doesNotMatch(script, /\b(fetch|XMLHttpRequest|sendBeacon|WebSocket)\s*\(/);
  assert.match(script, /saveStoredMedia\('subtitle'/);
  assert.match(script, /serializeSubtitles/);
  assert.match(script, /list\.scrollTo\(\{ top:/);
  assert.equal((html.match(/data-time-field="start"/g) || []).length, 4);
  assert.equal((html.match(/data-time-field="end"/g) || []).length, 4);
  for (const delta of ['0.5', '0.1', '-0.5', '-0.1']) assert.match(html, new RegExp(`data-time-delta="${delta}"`));
});
