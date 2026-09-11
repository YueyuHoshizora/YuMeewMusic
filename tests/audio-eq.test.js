import test from "node:test";
import assert from "node:assert/strict";
import { createAudioEqualizer } from "../js/audio-eq.js";

function sine(frequency, sampleRate = 48000, seconds = 1) {
  return Float32Array.from(
    { length: sampleRate * seconds },
    (_, index) => 0.2 * Math.sin(2 * Math.PI * frequency * index / sampleRate),
  );
}

function rms(samples) {
  return Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length);
}

test("three-band equalizer boosts its intended frequency ranges", () => {
  const bass = sine(80);
  const bassResult = createAudioEqualizer({ eqBass: 6 }, 48000, 1).process(bass, 0);
  assert.ok(rms(bassResult.subarray(2400)) > rms(bass.subarray(2400)) * 1.7);

  const treble = sine(8000);
  const trebleResult = createAudioEqualizer({ eqTreble: -6 }, 48000, 1).process(treble, 0);
  assert.ok(rms(trebleResult.subarray(2400)) < rms(treble.subarray(2400)) * 0.65);
});

test("equalizer clamps gains and preserves PCM when all bands are neutral", () => {
  const samples = sine(440, 48000, 0.1);
  const neutral = createAudioEqualizer({}, 48000, 2);
  assert.equal(neutral.process(samples, 0), samples);
  assert.deepEqual(createAudioEqualizer({ eqBass: 99, eqMid: -99 }, 48000, 1).gains, [10, -10, 0]);
});

test('separator EQ supports stronger broad bands without changing main-page limits', async () => {
  const { SEPARATOR_EQ_PROFILE } = await import('../js/audio-eq.js');
  for (const [key, frequency] of [['eqBass', 80], ['eqMid', 1000], ['eqTreble', 8000]]) {
    const samples = sine(frequency);
    const low = createAudioEqualizer({ [key]: -24 }, 48000, 1, SEPARATOR_EQ_PROFILE).process(samples, 0);
    const high = createAudioEqualizer({ [key]: 24 }, 48000, 1, SEPARATOR_EQ_PROFILE).process(samples, 0);
    const difference = 20 * Math.log10(rms(high.subarray(2400)) / rms(low.subarray(2400)));
    assert.ok(difference > 40, `${key}: ${difference} dB`);
  }
  assert.deepEqual(createAudioEqualizer({eqBass: 99, eqMid: -99}, 48000, 1, SEPARATOR_EQ_PROFILE).gains, [24, -24, 0]);
  assert.deepEqual(createAudioEqualizer({eqBass: 99}, 48000, 1).gains, [10, 0, 0]);
});
