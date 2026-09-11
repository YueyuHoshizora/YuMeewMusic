import test from 'node:test';
import assert from 'node:assert/strict';
import { SPLEETER_CHUNK, SPLEETER_SHAPE, spleeterStarts, prepareSpleeter, reconstructSpleeter } from '../js/spleeter-core.js';

test('Spleeter magnitude layout and reconstruction preserve stereo and sample alignment', () => {
  const left = Float32Array.from({length: SPLEETER_CHUNK}, (_, i) => 0.2 * Math.sin(2 * Math.PI * 32 * i / 4096));
  const right = Float32Array.from(left, x => x * 0.3);
  const prepared = prepareSpleeter(left, right);
  assert.equal(prepared.input.length, SPLEETER_SHAPE.reduce((a,b)=>a*b));
  const plane = prepared.input.length / 2;
  assert.ok(Math.abs(prepared.input[32] * 0.3 - prepared.input[plane + 32]) < 1e-4);
  const vocals = new Float32Array(prepared.input.length).fill(1);
  const accompaniment = new Float32Array(prepared.input.length).fill(1);
  const result = reconstructSpleeter(vocals, accompaniment, prepared);
  let error = 0;
  for (let i = 4096; i < left.length - 4096; i++) {
    error = Math.max(error, Math.abs(result.left[i] - left[i] * 0.5), Math.abs(result.right[i] - right[i] * 0.5));
  }
  assert.ok(error < 1e-5, String(error));
  assert.equal(result.left.length, left.length);
  assert.throws(()=>reconstructSpleeter(vocals.subarray(1), accompaniment, prepared), /形狀/);
  vocals[0] = NaN;
  assert.throws(()=>reconstructSpleeter(vocals, accompaniment, prepared), /無效/);
});

test('Spleeter chunks cover beginnings, endings and joins without gaps', () => {
  for(const total of [1, 4096, SPLEETER_CHUNK, 44100 * 480]) {
    let end = 0;
    for(const start of spleeterStarts(total)) {
      assert.ok(start + 4096 <= end);
      end = start + SPLEETER_CHUNK - 4096;
    }
    assert.ok(end >= total);
  }
  assert.ok(spleeterStarts(44100 * 300).length < 36);
});
