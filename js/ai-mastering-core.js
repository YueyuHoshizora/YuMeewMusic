// AI 母帶處理核心 DSP：多頻段動態壓縮 + ITU-R BS.1770-4 響度量測與正規化 + 峰值保護限幅器。
// 全部是規則式訊號處理（沒有任何訓練過的模型／權重檔），純函式、可在 Node 下單元測試，
// 也可以直接在瀏覽器的 AudioBuffer 資料上執行，音樂內容不會離開瀏覽器。

export const MASTER_SAMPLE_RATE_DEFAULT = 44100;
export const MASTER_CROSSOVERS_HZ = Object.freeze([150, 1000, 5000]);

export const MASTER_PRESETS = Object.freeze({
  streaming: Object.freeze({ label: "串流平台（Spotify／YouTube，約 -14 LUFS）", targetLufs: -14 }),
  loud: Object.freeze({ label: "強力／夜店（約 -9 LUFS）", targetLufs: -9 }),
  broadcast: Object.freeze({ label: "廣播／有聲書（約 -16 LUFS）", targetLufs: -16 }),
  custom: Object.freeze({ label: "自訂目標響度", targetLufs: -14 }),
});

const BAND_DEFAULTS = Object.freeze([
  Object.freeze({ name: "low", thresholdBase: -20, ratio: 2.2, attackMs: 30, releaseMs: 250 }),
  Object.freeze({ name: "lowMid", thresholdBase: -22, ratio: 2.6, attackMs: 15, releaseMs: 180 }),
  Object.freeze({ name: "highMid", thresholdBase: -24, ratio: 2.6, attackMs: 8, releaseMs: 140 }),
  Object.freeze({ name: "high", thresholdBase: -26, ratio: 2.2, attackMs: 4, releaseMs: 100 }),
]);

export function masteredFilename(name) {
  const base = String(name || "audio").replace(/\.[^.]+$/, "").replace(/[\\/:*?"<>|]+/g, "-") || "audio";
  return `${base}-mastered.wav`;
}

// ---------------------------------------------------------------------------
// Linkwitz-Riley 分頻（多頻段分割）：兩個串接的一階 Butterworth 濾波器等於一個二階
// Linkwitz-Riley 濾波器，其低通與高通輸出相加後會還原成平坦（全通）響應，不需要額外
// 反相，適合拿來把訊號無縫切成多個頻段分別處理再加總回去。
// ---------------------------------------------------------------------------

function createOnePoleLowpass(cutoffHz, sampleRate) {
  const rc = 1 / (2 * Math.PI * cutoffHz);
  const dt = 1 / sampleRate;
  const alpha = dt / (rc + dt);
  let y = 0;
  return x => (y += alpha * (x - y));
}

function createLr2Lowpass(cutoffHz, sampleRate) {
  const stage1 = createOnePoleLowpass(cutoffHz, sampleRate);
  const stage2 = createOnePoleLowpass(cutoffHz, sampleRate);
  return x => stage2(stage1(x));
}

// 「高頻段＝原訊號 - 低通輸出」是這裡故意選的做法：不用另一個獨立設計的高通濾波器
// （那樣低通與高通只是「近似」互補，多顆一路串接下來誤差會愈疊愈大），改成直接用減法
// 定義高頻殘餘，讓每一層分出的低頻段與殘餘相加永遠精確等於輸入，不會有累積誤差，往下
// 遞迴切更多頻段時也一樣成立（每一層都是重新對前一層的殘餘做相同的減法）。
export function splitBands(samples, sampleRate, crossovers = MASTER_CROSSOVERS_HZ) {
  const bands = [];
  let remainder = samples;
  for (const cutoff of crossovers) {
    const lowFilter = createLr2Lowpass(cutoff, sampleRate);
    const low = new Float32Array(remainder.length);
    for (let i = 0; i < remainder.length; i++) low[i] = lowFilter(remainder[i]);
    const high = new Float32Array(remainder.length);
    for (let i = 0; i < remainder.length; i++) high[i] = remainder[i] - low[i];
    bands.push(low);
    remainder = high;
  }
  bands.push(remainder);
  return bands;
}

// ---------------------------------------------------------------------------
// 逐頻段動態壓縮器（feed-forward、soft-knee，公式參考 Giannoulis/Reiss/Stables 的
// 數位動態壓縮器教學論文；對數域取包絡再做 attack/release 平滑，是業界標準做法）。
// ---------------------------------------------------------------------------

function computeStaticGainReductionDb(levelDb, thresholdDb, ratio, kneeDb) {
  const overshoot = levelDb - thresholdDb;
  if (overshoot <= -kneeDb / 2) return 0;
  if (overshoot >= kneeDb / 2) return (1 / ratio - 1) * overshoot;
  const kneeOvershoot = overshoot + kneeDb / 2;
  return (1 / ratio - 1) * (kneeOvershoot * kneeOvershoot) / (2 * kneeDb);
}

export function computeCompressorGainCurve(detector, options) {
  const { sampleRate, thresholdDb = -24, ratio = 3, kneeDb = 6, attackMs = 12, releaseMs = 150, makeupDb = 0 } = options;
  const attackCoef = Math.exp(-1 / (0.001 * Math.max(0.1, attackMs) * sampleRate));
  const releaseCoef = Math.exp(-1 / (0.001 * Math.max(0.1, releaseMs) * sampleRate));
  const makeupGain = 10 ** (makeupDb / 20);
  const gain = new Float32Array(detector.length);
  let smoothedGrDb = 0;
  for (let i = 0; i < detector.length; i++) {
    const levelDb = 20 * Math.log10(Math.max(Math.abs(detector[i]), 1e-8));
    const staticGrDb = computeStaticGainReductionDb(levelDb, thresholdDb, ratio, kneeDb);
    smoothedGrDb = staticGrDb < smoothedGrDb
      ? attackCoef * smoothedGrDb + (1 - attackCoef) * staticGrDb
      : releaseCoef * smoothedGrDb + (1 - releaseCoef) * staticGrDb;
    gain[i] = 10 ** (smoothedGrDb / 20) * makeupGain;
  }
  return gain;
}

export function applyGainCurve(samples, gain) {
  const output = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) output[i] = samples[i] * gain[i];
  return output;
}

export function bandOptionsForIntensity(band, intensity, sampleRate) {
  const amount = Math.max(0, Math.min(100, Number(intensity) || 0)) / 100;
  const thresholdDb = band.thresholdBase + (1 - amount) * 14;
  const ratio = 1 + (band.ratio - 1) * (0.4 + 0.6 * amount);
  const makeupDb = amount * 3;
  return { sampleRate, thresholdDb, ratio, kneeDb: 6, attackMs: band.attackMs, releaseMs: band.releaseMs, makeupDb };
}

export function masterStereoChannels(left, right, sampleRate, { intensity = 50, crossovers = MASTER_CROSSOVERS_HZ } = {}) {
  const leftBands = splitBands(left, sampleRate, crossovers);
  const rightBands = splitBands(right, sampleRate, crossovers);
  const outLeft = new Float32Array(left.length);
  const outRight = new Float32Array(right.length);
  for (let b = 0; b < leftBands.length; b++) {
    const options = bandOptionsForIntensity(BAND_DEFAULTS[b] || BAND_DEFAULTS[BAND_DEFAULTS.length - 1], intensity, sampleRate);
    const bandLeft = leftBands[b];
    const bandRight = rightBands[b];
    const detector = new Float32Array(bandLeft.length);
    for (let i = 0; i < detector.length; i++) detector[i] = Math.max(Math.abs(bandLeft[i]), Math.abs(bandRight[i]));
    const gain = computeCompressorGainCurve(detector, options);
    for (let i = 0; i < outLeft.length; i++) {
      outLeft[i] += bandLeft[i] * gain[i];
      outRight[i] += bandRight[i] * gain[i];
    }
  }
  return { left: outLeft, right: outRight };
}

// ---------------------------------------------------------------------------
// 峰值保護限幅器：對未來一小段時間（lookahead）取最小允許增益，避免瞬態爆表，
// release 只會緩慢回升，attack（增益下降）則立即反應，是常見的安全限幅器設計。
// ---------------------------------------------------------------------------

export function limitStereoChannels(left, right, sampleRate, { ceilingDb = -1, lookaheadMs = 5, releaseMs = 60 } = {}) {
  const ceiling = 10 ** (ceilingDb / 20);
  const n = left.length;
  const lookahead = Math.max(1, Math.min(n, Math.round(lookaheadMs / 1000 * sampleRate)));
  const instantGain = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const peak = Math.max(Math.abs(left[i]), Math.abs(right[i]), 1e-9);
    instantGain[i] = peak > ceiling ? ceiling / peak : 1;
  }
  // 單調遞增佇列（monotonic deque）求滑動窗最小值，O(n) 而不是逐點掃描窗內最小值的 O(n·window)。
  const lookaheadGain = new Float32Array(n);
  const dequeIndex = new Int32Array(n);
  let head = 0;
  let tail = 0;
  for (let i = n - 1; i >= 0; i--) {
    while (tail > head && instantGain[dequeIndex[tail - 1]] >= instantGain[i]) tail--;
    dequeIndex[tail++] = i;
    const windowEnd = i + lookahead;
    while (dequeIndex[head] > windowEnd) head++;
    lookaheadGain[i] = instantGain[dequeIndex[head]];
  }
  const releaseCoef = Math.exp(-1 / (0.001 * Math.max(1, releaseMs) * sampleRate));
  const outLeft = new Float32Array(n);
  const outRight = new Float32Array(n);
  let current = 1;
  for (let i = 0; i < n; i++) {
    // 釋放（release）只能讓增益緩慢回升，但無論如何都不能超過目前這個取樣點依 lookahead
    // 分析得到的必要增益上限，否則會在增益回升途中，剛好在下一個瞬態峰值處爆表。
    const released = releaseCoef * current + (1 - releaseCoef) * 1;
    current = Math.min(lookaheadGain[i], released);
    outLeft[i] = left[i] * current;
    outRight[i] = right[i] * current;
  }
  return { left: outLeft, right: outRight };
}

// ---------------------------------------------------------------------------
// ITU-R BS.1770-4 K-weighting 濾波器與雙門檻閘控積分響度量測（絕對門檻 -70 LUFS，
// 相對門檻為未閘控平均響度 -10 LU），係數依取樣率動態計算，不是只支援 48 kHz。
// ---------------------------------------------------------------------------

function kWeightingStages(sampleRate) {
  const f0a = 1681.9744509555319;
  const gainA = 3.99984385397;
  const qA = 0.7071752369554193;
  const kA = Math.tan(Math.PI * f0a / sampleRate);
  const vh = 10 ** (gainA / 20);
  const vb = vh ** 0.4996667741545416;
  const a0a = 1 + kA / qA + kA * kA;
  const stage1 = {
    b0: (vh + vb * kA / qA + kA * kA) / a0a,
    b1: 2 * (kA * kA - vh) / a0a,
    b2: (vh - vb * kA / qA + kA * kA) / a0a,
    a1: 2 * (kA * kA - 1) / a0a,
    a2: (1 - kA / qA + kA * kA) / a0a,
  };
  const f0b = 38.13547087613982;
  const qB = 0.5003270373238773;
  const kB = Math.tan(Math.PI * f0b / sampleRate);
  const a0b = 1 + kB / qB + kB * kB;
  const stage2 = {
    b0: 1,
    b1: -2,
    b2: 1,
    a1: 2 * (kB * kB - 1) / a0b,
    a2: (1 - kB / qB + kB * kB) / a0b,
  };
  return [stage1, stage2];
}

function applyBiquadStage(samples, stage) {
  const { b0, b1, b2, a1, a2 } = stage;
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  const output = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const x = samples[i];
    const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1;
    x1 = x;
    y2 = y1;
    y1 = y;
    output[i] = y;
  }
  return output;
}

export function kWeightFilter(samples, sampleRate) {
  const [stage1, stage2] = kWeightingStages(sampleRate);
  return applyBiquadStage(applyBiquadStage(samples, stage1), stage2);
}

export function measureIntegratedLoudness(channels, sampleRate, channelWeights) {
  const weights = channelWeights || channels.map(() => 1);
  const weighted = channels.map(channel => kWeightFilter(channel, sampleRate));
  const blockSamples = Math.max(1, Math.round(0.4 * sampleRate));
  const hopSamples = Math.max(1, Math.round(0.1 * sampleRate));
  const length = weighted[0]?.length || 0;
  const blockLoudness = [];
  const blockMeanSquares = [];
  for (let start = 0; start + blockSamples <= length; start += hopSamples) {
    let sum = 0;
    for (let c = 0; c < weighted.length; c++) {
      const channel = weighted[c];
      let meanSquare = 0;
      for (let i = start; i < start + blockSamples; i++) meanSquare += channel[i] * channel[i];
      meanSquare /= blockSamples;
      sum += weights[c] * meanSquare;
    }
    if (sum <= 0) continue;
    blockMeanSquares.push(sum);
    blockLoudness.push(-0.691 + 10 * Math.log10(sum));
  }
  if (!blockLoudness.length) return -Infinity;
  const gatedAbsolute = blockMeanSquares.filter((_, index) => blockLoudness[index] > -70);
  if (!gatedAbsolute.length) return -Infinity;
  const meanAbsolute = gatedAbsolute.reduce((a, b) => a + b, 0) / gatedAbsolute.length;
  const relativeThreshold = -0.691 + 10 * Math.log10(meanAbsolute) - 10;
  const gatedRelative = blockMeanSquares.filter((meanSquare, index) =>
    blockLoudness[index] > -70 && -0.691 + 10 * Math.log10(meanSquare) > relativeThreshold);
  const finalSet = gatedRelative.length ? gatedRelative : gatedAbsolute;
  const meanFinal = finalSet.reduce((a, b) => a + b, 0) / finalSet.length;
  return -0.691 + 10 * Math.log10(meanFinal);
}

export function measureTruePeakDb(channels) {
  let peak = 0;
  for (const channel of channels) for (let i = 0; i < channel.length; i++) peak = Math.max(peak, Math.abs(channel[i]));
  return peak > 0 ? 20 * Math.log10(peak) : -Infinity;
}

// ---------------------------------------------------------------------------
// 整合流程：多頻段壓縮 → 依量到的響度正規化到目標 LUFS → 峰值保護限幅器。
// ---------------------------------------------------------------------------

export function masterAudioChannels(left, right, sampleRate, options = {}) {
  const { intensity = 50, targetLufs = -14, ceilingDb = -1, crossovers = MASTER_CROSSOVERS_HZ } = options;
  const beforeLufs = measureIntegratedLoudness([left, right], sampleRate);
  const beforeTruePeakDb = measureTruePeakDb([left, right]);
  const compressed = masterStereoChannels(left, right, sampleRate, { intensity, crossovers });
  const afterCompressLufs = measureIntegratedLoudness([compressed.left, compressed.right], sampleRate);
  const gainDb = Number.isFinite(afterCompressLufs) ? Math.max(-24, Math.min(24, targetLufs - afterCompressLufs)) : 0;
  const gain = 10 ** (gainDb / 20);
  const normalizedLeft = new Float32Array(compressed.left.length);
  const normalizedRight = new Float32Array(compressed.right.length);
  for (let i = 0; i < normalizedLeft.length; i++) {
    normalizedLeft[i] = compressed.left[i] * gain;
    normalizedRight[i] = compressed.right[i] * gain;
  }
  const limited = limitStereoChannels(normalizedLeft, normalizedRight, sampleRate, { ceilingDb });
  const afterLufs = measureIntegratedLoudness([limited.left, limited.right], sampleRate);
  const afterTruePeakDb = measureTruePeakDb([limited.left, limited.right]);
  return { left: limited.left, right: limited.right, beforeLufs, afterLufs, beforeTruePeakDb, afterTruePeakDb };
}
