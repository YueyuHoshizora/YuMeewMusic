import test from "node:test";
import assert from "node:assert/strict";
import {
  MASTER_CROSSOVERS_HZ,
  MASTER_PRESETS,
  EQ_LEVEL_COUNT,
  EQ_DEFAULT_LEVEL,
  EQ_PRESENCE_FREQUENCY_HZ,
  EQ_IMPACT_SHELF_FREQUENCY_HZ,
  masteredFilename,
  splitBands,
  computeCompressorGainCurve,
  limitStereoChannels,
  measureIntegratedLoudness,
  measureTruePeakDb,
  eqLevelToGainDb,
  applyToneShapingEq,
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
  assert.equal(masteredFilename("my song.mp3", "flac"), "my song-mastered.flac");
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

test("measureTruePeakDb catches inter-sample peaks that sample-peak scanning misses", () => {
  // 刻意挑一個接近 Nyquist、相位又剛好讓取樣點避開類比波峰的高頻訊號：單純掃描取樣點
  // 量到的峰值會明顯低於訊號實際的類比峰值，True Peak（4 倍過取樣）則應該量得到。
  const sampleRate = 44100;
  const frequency = (sampleRate / 2) * 0.996;
  const amplitude = 0.98;
  const phase = 0.3;
  const signal = Float32Array.from({ length: 400 }, (_, i) => amplitude * Math.sin((2 * Math.PI * frequency * i) / sampleRate + phase));
  let samplePeak = 0;
  for (const value of signal) samplePeak = Math.max(samplePeak, Math.abs(value));
  const samplePeakDb = 20 * Math.log10(samplePeak);
  const truePeakDb = measureTruePeakDb([signal]);
  assert.ok(truePeakDb > samplePeakDb + 1, `true peak (${truePeakDb}) should clearly exceed sample peak (${samplePeakDb})`);
});

test("eqLevelToGainDb maps the 5-level EQ controls to 0 dB at the default (middle) level", () => {
  assert.equal(EQ_LEVEL_COUNT, 5);
  assert.equal(eqLevelToGainDb(EQ_DEFAULT_LEVEL), 0);
  assert.ok(eqLevelToGainDb(0) < 0, "the lowest level should cut");
  assert.ok(eqLevelToGainDb(EQ_LEVEL_COUNT - 1) > 0, "the highest level should boost");
  // 兩端對稱：從正中間往下跟往上調整幾段，增益大小應該一樣、方向相反。
  assert.equal(eqLevelToGainDb(0), -eqLevelToGainDb(EQ_LEVEL_COUNT - 1));
  assert.equal(eqLevelToGainDb(-5), eqLevelToGainDb(0), "超出範圍要夾在最低那一段");
  assert.equal(eqLevelToGainDb(99), eqLevelToGainDb(EQ_LEVEL_COUNT - 1), "超出範圍要夾在最高那一段");
});

test("applyToneShapingEq is a no-op at the default level and doesn't mutate the input", () => {
  const signal = sine(1000, 0.3, 0.5);
  const original = Float32Array.from(signal);
  const output = applyToneShapingEq(signal, SAMPLE_RATE, { clarityLevel: EQ_DEFAULT_LEVEL, impactLevel: EQ_DEFAULT_LEVEL });
  assert.deepEqual(signal, original, "輸入陣列不應該被就地修改");
  for (let i = 0; i < output.length; i++) assert.ok(Math.abs(output[i] - signal[i]) < 1e-6);
});

test("applyToneShapingEq's clarity control boosts energy at the presence band without touching the impact band's default", () => {
  const presence = sine(EQ_PRESENCE_FREQUENCY_HZ, 0.2, 0.5);
  const bypassed = applyToneShapingEq(presence, SAMPLE_RATE, { clarityLevel: EQ_DEFAULT_LEVEL, impactLevel: EQ_DEFAULT_LEVEL });
  const boosted = applyToneShapingEq(presence, SAMPLE_RATE, { clarityLevel: EQ_LEVEL_COUNT - 1, impactLevel: EQ_DEFAULT_LEVEL });
  const cut = applyToneShapingEq(presence, SAMPLE_RATE, { clarityLevel: 0, impactLevel: EQ_DEFAULT_LEVEL });
  assert.ok(rms(boosted) > rms(bypassed) * 1.2, `clarity 拉到最高應該讓人聲清晰度頻段更響：${rms(boosted)} vs ${rms(bypassed)}`);
  assert.ok(rms(cut) < rms(bypassed) * 0.85, `clarity 拉到最低應該讓人聲清晰度頻段變小聲：${rms(cut)} vs ${rms(bypassed)}`);
});

test("applyToneShapingEq's impact control boosts energy at the low-end shelf", () => {
  const bass = sine(EQ_IMPACT_SHELF_FREQUENCY_HZ * 0.6, 0.2, 0.5);
  const bypassed = applyToneShapingEq(bass, SAMPLE_RATE, { clarityLevel: EQ_DEFAULT_LEVEL, impactLevel: EQ_DEFAULT_LEVEL });
  const boosted = applyToneShapingEq(bass, SAMPLE_RATE, { clarityLevel: EQ_DEFAULT_LEVEL, impactLevel: EQ_LEVEL_COUNT - 1 });
  const cut = applyToneShapingEq(bass, SAMPLE_RATE, { clarityLevel: EQ_DEFAULT_LEVEL, impactLevel: 0 });
  assert.ok(rms(boosted) > rms(bypassed) * 1.2, `impact 拉到最高應該讓低頻更震撼：${rms(boosted)} vs ${rms(bypassed)}`);
  assert.ok(rms(cut) < rms(bypassed) * 0.85, `impact 拉到最低應該讓低頻變輕量：${rms(cut)} vs ${rms(bypassed)}`);
});

test("all 5 EQ levels are clearly distinguishable from their neighbors, not just the extremes vs. the middle", () => {
  // 使用者要求：往左減弱、往右增強，而且 5 段彼此之間都要聽得出明顯差異，不能只有拉到
  // 最左/最右才有感覺。這裡直接驗證：相鄰兩段之間的 RMS 差距都要超過一個門檻（換算成
  // 大約 1.5 dB 的音量差，一般人在 A/B 比較下都聽得出來），而且是嚴格遞增（向右一定更強）。
  const MIN_ADJACENT_RATIO = 10 ** (1.5 / 20); // 相鄰兩段至少要差約 1.5 dB 的音量
  const presence = sine(EQ_PRESENCE_FREQUENCY_HZ, 0.2, 0.5);
  const bass = sine(EQ_IMPACT_SHELF_FREQUENCY_HZ * 0.6, 0.2, 0.5);
  for (const [signal, otherOption] of [
    [presence, "impactLevel"],
    [bass, "clarityLevel"],
  ]) {
    const levelOption = otherOption === "impactLevel" ? "clarityLevel" : "impactLevel";
    const levels = Array.from({ length: EQ_LEVEL_COUNT }, (_, level) =>
      rms(applyToneShapingEq(signal, SAMPLE_RATE, { [levelOption]: level, [otherOption]: EQ_DEFAULT_LEVEL })));
    for (let i = 1; i < levels.length; i++) {
      assert.ok(levels[i] > levels[i - 1] * MIN_ADJACENT_RATIO,
        `level ${i} (${levels[i]}) should be clearly louder than level ${i - 1} (${levels[i - 1]})`);
    }
  }
});

test("masterAudioChannels accepts clarityLevel/impactLevel and still hits the loudness target without clipping", () => {
  const quiet = sine(220, 0.05, 3);
  const result = masterAudioChannels(quiet, quiet, SAMPLE_RATE, {
    intensity: 50,
    targetLufs: -14,
    ceilingDb: -1,
    clarityLevel: EQ_LEVEL_COUNT - 1,
    impactLevel: 0,
  });
  assert.ok(Math.abs(result.afterLufs - (-14)) < 2, `expected close to -14 LUFS, got ${result.afterLufs}`);
  const ceiling = 10 ** (-1 / 20) + 1e-6;
  for (let i = 0; i < result.left.length; i++) assert.ok(Math.abs(result.left[i]) <= ceiling);
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
