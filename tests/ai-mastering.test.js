import test from "node:test";
import assert from "node:assert/strict";
import {
  MASTER_CROSSOVERS_HZ,
  MASTER_PRESETS,
  masteredFilename,
  splitBands,
  computeCompressorGainCurve,
  limitStereoChannels,
  measureIntegratedLoudness,
  measureTruePeakDb,
  masterAudioChannels,
} from "../js/ai-mastering-core.js";

const SAMPLE_RATE = 44100;

function sine(frequency, amplitude = 0.2, seconds = 2, sampleRate = SAMPLE_RATE) {
  return Float32Array.from(
    { length: Math.round(sampleRate * seconds) },
    (_, index) => amplitude * Math.sin(2 * Math.PI * frequency * index / sampleRate),
  );
}

function rms(samples) {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / samples.length);
}

test("masteredFilename sanitizes the source name and always ends in -mastered.wav", () => {
  assert.equal(masteredFilename("my song.mp3"), "my song-mastered.wav");
  assert.equal(masteredFilename('weird:/name*?.wav'), "weird-name--mastered.wav");
  assert.equal(masteredFilename(""), "audio-mastered.wav");
});

test("splitBands reconstructs the original signal (Linkwitz-Riley bands sum back to unity)", () => {
  const signal = Float32Array.from({ length: 4096 }, (_, i) =>
    0.3 * Math.sin(2 * Math.PI * 60 * i / SAMPLE_RATE) +
    0.3 * Math.sin(2 * Math.PI * 800 * i / SAMPLE_RATE) +
    0.3 * Math.sin(2 * Math.PI * 8000 * i / SAMPLE_RATE));
  const bands = splitBands(signal, SAMPLE_RATE, MASTER_CROSSOVERS_HZ);
  assert.equal(bands.length, MASTER_CROSSOVERS_HZ.length + 1);
  const sum = new Float32Array(signal.length);
  for (const band of bands) for (let i = 0; i < sum.length; i++) sum[i] += band[i];
  // Skip the filter warm-up region; the steady-state sum should closely track the original.
  let maxError = 0;
  for (let i = 1024; i < signal.length; i++) maxError = Math.max(maxError, Math.abs(sum[i] - signal[i]));
  assert.ok(maxError < 0.05, `max reconstruction error too high: ${maxError}`);
});

test("splitBands routes a low tone mostly into the lowest band and a high tone into the highest band", () => {
  const low = sine(60, 0.3, 0.3);
  const lowBands = splitBands(low, SAMPLE_RATE, MASTER_CROSSOVERS_HZ);
  const lowEnergies = lowBands.map(band => rms(band.subarray(2000)));
  assert.equal(lowEnergies.indexOf(Math.max(...lowEnergies)), 0);

  const high = sine(9000, 0.3, 0.3);
  const highBands = splitBands(high, SAMPLE_RATE, MASTER_CROSSOVERS_HZ);
  const highEnergies = highBands.map(band => rms(band.subarray(2000)));
  assert.equal(highEnergies.indexOf(Math.max(...highEnergies)), highBands.length - 1);
});

test("computeCompressorGainCurve reduces gain above threshold and leaves quiet signal untouched", () => {
  const loud = sine(200, 0.9, 0.5);
  const loudGain = computeCompressorGainCurve(loud, { sampleRate: SAMPLE_RATE, thresholdDb: -12, ratio: 4, attackMs: 5, releaseMs: 80 });
  assert.ok(loudGain[loudGain.length - 1] < 0.9, `expected gain reduction, got ${loudGain[loudGain.length - 1]}`);

  const quiet = sine(200, 0.05, 0.5);
  const quietGain = computeCompressorGainCurve(quiet, { sampleRate: SAMPLE_RATE, thresholdDb: -12, ratio: 4, attackMs: 5, releaseMs: 80 });
  assert.ok(quietGain[quietGain.length - 1] > 0.95, `expected near-unity gain, got ${quietGain[quietGain.length - 1]}`);
});

test("limitStereoChannels keeps every sample at or under the ceiling", () => {
  const left = sine(300, 1.4, 0.5);
  const right = sine(300, 1.4, 0.5);
  const { left: outLeft, right: outRight } = limitStereoChannels(left, right, SAMPLE_RATE, { ceilingDb: -1 });
  const ceiling = 10 ** (-1 / 20) + 1e-6;
  for (let i = 0; i < outLeft.length; i++) {
    assert.ok(Math.abs(outLeft[i]) <= ceiling, `left sample ${i} exceeded ceiling: ${outLeft[i]}`);
    assert.ok(Math.abs(outRight[i]) <= ceiling, `right sample ${i} exceeded ceiling: ${outRight[i]}`);
  }
});

test("measureIntegratedLoudness reports a louder value for a louder signal and is stable across sample rates", () => {
  const quiet = sine(1000, 0.05, 3);
  const loud = sine(1000, 0.3, 3);
  const quietLufs = measureIntegratedLoudness([quiet, quiet], SAMPLE_RATE);
  const loudLufs = measureIntegratedLoudness([loud, loud], SAMPLE_RATE);
  assert.ok(loudLufs > quietLufs, `expected louder signal to measure higher: ${loudLufs} vs ${quietLufs}`);

  const loud48k = sine(1000, 0.3, 3, 48000);
  const loudLufs48k = measureIntegratedLoudness([loud48k, loud48k], 48000);
  assert.ok(Math.abs(loudLufs48k - loudLufs) < 1, `loudness should be similar across sample rates: ${loudLufs48k} vs ${loudLufs}`);
});

test("measureTruePeakDb matches the known peak of a sine wave", () => {
  const signal = sine(440, 0.5, 0.2);
  const peakDb = measureTruePeakDb([signal]);
  assert.ok(Math.abs(peakDb - 20 * Math.log10(0.5)) < 0.3, `unexpected peak dB: ${peakDb}`);
});

test("masterAudioChannels normalizes an over-quiet mix toward the target LUFS without clipping", () => {
  const quiet = sine(220, 0.03, 4);
  const result = masterAudioChannels(quiet, quiet, SAMPLE_RATE, { intensity: 60, targetLufs: -14, ceilingDb: -1 });
  assert.ok(result.afterLufs > result.beforeLufs, `expected loudness increase: ${result.beforeLufs} -> ${result.afterLufs}`);
  assert.ok(Math.abs(result.afterLufs - (-14)) < 2, `expected close to -14 LUFS, got ${result.afterLufs}`);
  const ceiling = 10 ** (-1 / 20) + 1e-6;
  for (let i = 0; i < result.left.length; i++) assert.ok(Math.abs(result.left[i]) <= ceiling);
});

test("MASTER_PRESETS exposes streaming, loud and broadcast targets", () => {
  assert.equal(MASTER_PRESETS.streaming.targetLufs, -14);
  assert.equal(MASTER_PRESETS.loud.targetLufs, -9);
  assert.equal(MASTER_PRESETS.broadcast.targetLufs, -16);
});
