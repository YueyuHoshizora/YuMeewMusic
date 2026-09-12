import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { cachedModelIdentity, groupCachedModelFiles } from '../js/indexeddb-model-cache.js';

test('cached model files are grouped by Hugging Face repository', () => {
  const spleeterVoice = 'https://huggingface.co/csukuangfj/sherpa-onnx-spleeter-2stems/resolve/revision/vocals.onnx';
  const spleeterMusic = 'https://huggingface.co/csukuangfj/sherpa-onnx-spleeter-2stems/resolve/revision/accompaniment.onnx';
  const whisper = 'https://huggingface.co/onnx-community/whisper-small_timestamped/resolve/main/onnx/encoder_model_fp16.onnx';
  assert.equal(cachedModelIdentity(spleeterVoice).name, 'Spleeter 2-stems');
  const groups = groupCachedModelFiles([
    { key: spleeterVoice, size: 100, savedAt: 2 },
    { key: spleeterMusic, size: 200, savedAt: 3 },
    { key: whisper, size: 400, savedAt: 1 },
  ]);
  assert.equal(groups.length, 2);
  const spleeter = groups.find(model => model.name === 'Spleeter 2-stems');
  assert.equal(spleeter.size, 300);
  assert.equal(spleeter.fileCount, 2);
  assert.deepEqual(spleeter.keys, [spleeterVoice, spleeterMusic]);
  assert.equal(groups.find(model => model.name === 'Whisper Small').size, 400);
});

test('model settings page exposes list and confirmed delete actions', () => {
  const html = readFileSync('settings.html', 'utf8');
  const script = readFileSync('js/model-settings.js', 'utf8');
  const ids = [...html.matchAll(/id="([^"]+)"/g)].map(match => match[1]);
  for (const [, id] of script.matchAll(/\$\(['"]([^'"]+)['"]\)/g)) assert.ok(ids.includes(id), id);
  for (const [, path] of html.matchAll(/(?:src|href)="\.\/([^"#?]+)(?:\?[^"#]*)?"/g)) assert.ok(existsSync(path), path);
  assert.match(html, /下次使用將重新下載，是否刪除？/);
  assert.match(html, /<aside class="panel settings-sidebar"[^>]*aria-label="設定項目">/);
  assert.match(html, /data-settings-panel="interface-settings"[^>]*aria-selected="true"/);
  assert.match(html, /data-settings-panel="model-manager"[^>]*aria-selected="false"/);
  assert.match(html, /data-settings-panel="api-key-manager"[^>]*aria-selected="false"/);
  assert.match(html, /id="interface-mode"/);
  assert.match(html, /id="interface-theme"/);
  for (const theme of ['lime', 'ocean', 'violet', 'rose', 'amber', 'mint', 'indigo', 'coral', 'magenta', 'silver']) {
    assert.match(html, new RegExp(`<option value="${theme}">`));
  }
  assert.match(html, /<section id="model-manager" class="panel settings-panel model-manager"/);
  assert.match(html, /<section id="api-key-manager" class="panel settings-panel api-key-manager"/);
  assert.match(html, /id="delete-api-key-dialog"/);
  assert.match(script, /saveSettings\(settings\)/);
  assert.match(script, /applyTheme\(settings\.mode, settings\.theme\)/);
  assert.match(script, /listCachedModels\(\)/);
  assert.match(script, /deleteCachedModel\(target\.keys\)/);
  assert.match(script, /deleteAllCachedModels\(\)/);
  assert.match(script, /listApiKeys\(\)/);
  assert.match(script, /maskApiKey\(key\.value\)/);
  assert.match(script, /deleteApiKey\(key\.id\)/);
  assert.match(readFileSync('index.html', 'utf8'), /href="\.\/settings\.html"[^>]*>⚙ 設定<\/a>/);
  assert.doesNotMatch(readFileSync('index.html', 'utf8'), /id="appearance-mode"|id="appearance-theme"/);
  assert.match(readFileSync('scripts/build.js', 'utf8'), /"settings\.html"/);
  assert.match(readFileSync('scripts/serve.js', 'utf8'), /"settings\.html"/);
});
