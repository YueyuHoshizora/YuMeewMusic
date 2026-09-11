import { fftInPlace, hannWindow } from './vocal-separator-core.js';

// Spleeter 2-stems: 44.1 kHz, 4096-point periodic Hann, hop 1024.
// sherpa-onnx export takes magnitudes [2, 1, 512, 1024].
export const SPLEETER_FFT = 4096;
export const SPLEETER_HOP = 1024;
export const SPLEETER_FRAMES = 512;
export const SPLEETER_BINS = 1024;
export const SPLEETER_CHUNK = (SPLEETER_FRAMES - 1) * SPLEETER_HOP + SPLEETER_FFT;
export const SPLEETER_SHAPE = [2, 1, SPLEETER_FRAMES, SPLEETER_BINS];
const plane = SPLEETER_FRAMES * SPLEETER_BINS;
const window = hannWindow(SPLEETER_FFT);

export function spleeterStarts(total) {
  const step = 384 * SPLEETER_HOP;
  const starts = [];
  for (let start = step - SPLEETER_CHUNK; start < total; start += step) {
    starts.push(start);
    if (start + SPLEETER_CHUNK >= total + SPLEETER_FFT) break;
  }
  return starts;
}

export function prepareSpleeter(left, right) {
  const input = new Float32Array(plane * 2);
  const real = new Float32Array(input.length), imaginary = new Float32Array(input.length);
  const re = new Float32Array(SPLEETER_FFT), im = new Float32Array(SPLEETER_FFT);
  for (let ch = 0; ch < 2; ch++) {
    const samples = ch ? right : left;
    for (let frame = 0; frame < SPLEETER_FRAMES; frame++) {
      for (let i = 0; i < SPLEETER_FFT; i++) re[i] = (samples[frame * SPLEETER_HOP + i] || 0) * window[i];
      im.fill(0);
      fftInPlace(re, im, SPLEETER_FFT);
      const offset = ch * plane + frame * SPLEETER_BINS;
      for (let bin = 0; bin < SPLEETER_BINS; bin++) {
        real[offset + bin] = re[bin];
        imaginary[offset + bin] = im[bin];
        input[offset + bin] = Math.hypot(re[bin], im[bin]);
      }
    }
  }
  return { input, real, imaginary };
}

export function reconstructSpleeter(vocals, accompaniment, prepared) {
  if (vocals.length !== plane * 2 || accompaniment.length !== vocals.length) throw Error('Spleeter 模型輸出形狀不符。');
  const channels = [new Float32Array(SPLEETER_CHUNK), new Float32Array(SPLEETER_CHUNK)];
  const weights = new Float32Array(SPLEETER_CHUNK);
  const re = new Float32Array(SPLEETER_FFT), im = new Float32Array(SPLEETER_FFT);
  for (let frame = 0; frame < SPLEETER_FRAMES; frame++) {
    const start = frame * SPLEETER_HOP;
    for (let i = 0; i < SPLEETER_FFT; i++) weights[start + i] += window[i] ** 2;
    for (let ch = 0; ch < 2; ch++) {
      re.fill(0); im.fill(0);
      const offset = ch * plane + frame * SPLEETER_BINS;
      for (let bin = 0; bin < SPLEETER_BINS; bin++) {
        const index = offset + bin, v = vocals[index], a = accompaniment[index];
        if (!Number.isFinite(v) || !Number.isFinite(a)) throw Error('Spleeter 模型產生無效數值。');
        const mask = (v * v + 5e-11) / (v * v + a * a + 1e-10);
        re[bin] = prepared.real[index] * mask;
        im[bin] = -prepared.imaginary[index] * mask;
        if (bin) { re[SPLEETER_FFT - bin] = re[bin]; im[SPLEETER_FFT - bin] = -im[bin]; }
      }
      fftInPlace(re, im, SPLEETER_FFT);
      for (let i = 0; i < SPLEETER_FFT; i++) channels[ch][start + i] += re[i] / SPLEETER_FFT * window[i];
    }
  }
  for (const channel of channels) for (let i = 0; i < channel.length; i++) if (weights[i] > 1e-8) channel[i] /= weights[i];
  return { left: channels[0], right: channels[1] };
}
