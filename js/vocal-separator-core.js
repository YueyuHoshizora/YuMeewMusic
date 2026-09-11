import { createAudioEqualizer } from "./audio-eq.js";

export const SEPARATOR_SAMPLE_RATE = 44100;
export const SEPARATOR_CHUNK_SIZE = 131072;
export const SEPARATOR_STEP = SEPARATOR_CHUNK_SIZE / 2;
export const SEPARATOR_MODEL_SIZE_MB = 201;
export const SEPARATOR_MAX_DURATION = 8 * 60;

const N_FFT = 2048;
const HOP = 512;
const N_FREQ = N_FFT / 2 + 1;
const FEATURE_SIZE = N_FREQ * 2 * 2;

let float16Lookup = null;

function getFloat16Lookup() {
  if (float16Lookup) return float16Lookup;
  float16Lookup = new Float32Array(65536);
  for (let bits = 0; bits < float16Lookup.length; bits++) {
    const sign = bits & 0x8000 ? -1 : 1;
    const exponent = (bits >>> 10) & 0x1f;
    const fraction = bits & 0x03ff;
    float16Lookup[bits] = exponent === 0
      ? sign * 2 ** -14 * (fraction / 1024)
      : exponent === 0x1f
        ? (fraction ? Number.NaN : sign * Number.POSITIVE_INFINITY)
        : sign * 2 ** (exponent - 15) * (1 + fraction / 1024);
  }
  return float16Lookup;
}

export function decodeFloat16(input) {
  const lookup = getFloat16Lookup();
  const output = new Float32Array(input.length);
  for (let index = 0; index < input.length; index++) output[index] = lookup[input[index]];
  return output;
}

export function separatorFilename(name, stem) {
  const base = String(name || "audio").replace(/\.[^.]+$/, "").replace(/[\\/:*?"<>|]+/g, "-") || "audio";
  if (!["vocals", "instrumental", "mixed"].includes(stem)) throw Error("無效的分離音軌。");
  return `${base}-${stem}.wav`;
}

function wavHeader(frameCount, sampleRate = SEPARATOR_SAMPLE_RATE) {
  const data = new ArrayBuffer(44), view = new DataView(data);
  const text = (offset, value) => {
    for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
  };
  text(0, "RIFF"); view.setUint32(4, 36 + frameCount * 4, true); text(8, "WAVE"); text(12, "fmt ");
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 2, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 4, true);
  view.setUint16(32, 4, true); view.setUint16(34, 16, true); text(36, "data");
  view.setUint32(40, frameCount * 4, true);
  return data;
}

function trackEqualizer(settings) {
  return createAudioEqualizer({
    eqBass: settings?.bass,
    eqMid: settings?.mid,
    eqTreble: settings?.treble,
  }, SEPARATOR_SAMPLE_RATE, 2);
}

async function readStereoChunk(blob, startFrame, frameCount) {
  const data = await blob.slice(44 + startFrame * 4, 44 + (startFrame + frameCount) * 4).arrayBuffer();
  const view = new DataView(data), left = new Float32Array(frameCount), right = new Float32Array(frameCount);
  for (let i = 0, offset = 0; i < frameCount; i++, offset += 4) {
    left[i] = view.getInt16(offset, true) / 32768;
    right[i] = view.getInt16(offset + 2, true) / 32768;
  }
  return { left, right };
}

function mixChunk(vocals, instrumental, settings, equalizers) {
  const output = [new Float32Array(vocals.left.length), new Float32Array(vocals.left.length)];
  const sources = [vocals, instrumental];
  for (let trackIndex = 0; trackIndex < sources.length; trackIndex++) {
    const track = trackIndex === 0 ? "vocals" : "instrumental";
    if (settings[track]?.muted) continue;
    for (let channel = 0; channel < 2; channel++) {
      const source = channel === 0 ? sources[trackIndex].left : sources[trackIndex].right;
      const processed = equalizers[track].process(source, channel);
      const gain = 10 ** (Math.max(-10, Math.min(10, Number(settings[track]?.volume) || 0)) / 20);
      for (let i = 0; i < processed.length; i++) output[channel][i] += processed[i] * gain;
    }
  }
  return output;
}

export async function mixSeparatedWav(vocalsBlob, instrumentalBlob, settings = {}, onProgress = () => {}) {
  if (!(vocalsBlob instanceof Blob) || !(instrumentalBlob instanceof Blob) || vocalsBlob.size < 44 || vocalsBlob.size !== instrumentalBlob.size)
    throw Error("分離音軌資料不完整，請重新執行人聲分離。");
  const frameCount = (vocalsBlob.size - 44) / 4;
  if (!Number.isInteger(frameCount)) throw Error("分離音軌格式不正確。");
  const blockSize = SEPARATOR_SAMPLE_RATE;

  const processPass = async (write, scale = 1) => {
    const equalizers = {
      vocals: trackEqualizer(settings.vocals),
      instrumental: trackEqualizer(settings.instrumental),
    };
    const chunks = [], totalBlocks = Math.ceil(frameCount / blockSize);
    let peak = 0;
    for (let block = 0, start = 0; start < frameCount; block++, start += blockSize) {
      const length = Math.min(blockSize, frameCount - start);
      const [vocals, instrumental] = await Promise.all([
        readStereoChunk(vocalsBlob, start, length),
        readStereoChunk(instrumentalBlob, start, length),
      ]);
      const mixed = mixChunk(vocals, instrumental, settings, equalizers);
      if (write) {
        const pcm = new ArrayBuffer(length * 4), view = new DataView(pcm);
        for (let i = 0, offset = 0; i < length; i++, offset += 4) {
          const left = Math.max(-1, Math.min(1, mixed[0][i] * scale));
          const right = Math.max(-1, Math.min(1, mixed[1][i] * scale));
          view.setInt16(offset, left < 0 ? left * 32768 : left * 32767, true);
          view.setInt16(offset + 2, right < 0 ? right * 32768 : right * 32767, true);
        }
        chunks.push(pcm);
      } else {
        for (let channel = 0; channel < 2; channel++) for (const sample of mixed[channel]) peak = Math.max(peak, Math.abs(sample));
      }
      onProgress((block + 1) / totalBlocks, write ? 1 : 0);
    }
    return write ? chunks : peak;
  };

  const peak = await processPass(false);
  const scale = peak > 0.99 ? 0.99 / peak : 1;
  const chunks = await processPass(true, scale);
  return new Blob([wavHeader(frameCount), ...chunks], { type: "audio/wav" });
}

export function encodeStereoWav(left, right, sampleRate = SEPARATOR_SAMPLE_RATE) {
  if (left.length !== right.length) throw Error("左右聲道長度不一致。");
  const data = new ArrayBuffer(44 + left.length * 4);
  const view = new DataView(data);
  const text = (offset, value) => {
    for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
  };
  text(0, "RIFF"); view.setUint32(4, 36 + left.length * 4, true); text(8, "WAVE"); text(12, "fmt ");
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 2, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 4, true);
  view.setUint16(32, 4, true); view.setUint16(34, 16, true); text(36, "data");
  view.setUint32(40, left.length * 4, true);
  for (let i = 0, offset = 44; i < left.length; i++, offset += 4) {
    const l = Math.max(-1, Math.min(1, left[i]));
    const r = Math.max(-1, Math.min(1, right[i]));
    view.setInt16(offset, l < 0 ? l * 32768 : l * 32767, true);
    view.setInt16(offset + 2, r < 0 ? r * 32768 : r * 32767, true);
  }
  return new Blob([data], { type: "audio/wav" });
}

export function hannWindow(length = N_FFT) {
  return Float32Array.from({ length }, (_, i) => 0.5 * (1 - Math.cos(2 * Math.PI * i / length)));
}

function fftInPlace(real, imaginary, size) {
  for (let i = 1, j = 0; i < size; i++) {
    let bit = size >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [real[i], real[j]] = [real[j], real[i]];
      [imaginary[i], imaginary[j]] = [imaginary[j], imaginary[i]];
    }
  }
  for (let length = 2; length <= size; length <<= 1) {
    const half = length >> 1;
    const angle = -2 * Math.PI / length;
    const stepReal = Math.cos(angle), stepImaginary = Math.sin(angle);
    for (let offset = 0; offset < size; offset += length) {
      let currentReal = 1, currentImaginary = 0;
      for (let j = 0; j < half; j++) {
        const a = offset + j, b = a + half;
        const transformedReal = currentReal * real[b] - currentImaginary * imaginary[b];
        const transformedImaginary = currentReal * imaginary[b] + currentImaginary * real[b];
        real[b] = real[a] - transformedReal; imaginary[b] = imaginary[a] - transformedImaginary;
        real[a] += transformedReal; imaginary[a] += transformedImaginary;
        const nextReal = currentReal * stepReal - currentImaginary * stepImaginary;
        currentImaginary = currentReal * stepImaginary + currentImaginary * stepReal;
        currentReal = nextReal;
      }
    }
  }
}

function realFft(samples) {
  const real = new Float32Array(N_FFT), imaginary = new Float32Array(N_FFT);
  real.set(samples);
  fftInPlace(real, imaginary, N_FFT);
  const result = new Float32Array(N_FREQ * 2);
  for (let frequency = 0; frequency < N_FREQ; frequency++) {
    result[frequency * 2] = real[frequency];
    result[frequency * 2 + 1] = imaginary[frequency];
  }
  return result;
}

function inverseRealFft(spectrum) {
  const real = new Float32Array(N_FFT), imaginary = new Float32Array(N_FFT);
  for (let frequency = 0; frequency < N_FREQ; frequency++) {
    real[frequency] = spectrum[frequency * 2];
    imaginary[frequency] = -spectrum[frequency * 2 + 1];
  }
  for (let frequency = 1; frequency < N_FFT / 2; frequency++) {
    real[N_FFT - frequency] = spectrum[frequency * 2];
    imaginary[N_FFT - frequency] = spectrum[frequency * 2 + 1];
  }
  fftInPlace(real, imaginary, N_FFT);
  for (let i = 0; i < N_FFT; i++) real[i] /= N_FFT;
  return real;
}

function stft(signal, window) {
  const frames = Math.floor((signal.length - N_FFT) / HOP) + 1;
  const data = new Float32Array(N_FREQ * frames * 2);
  const windowed = new Float32Array(N_FFT);
  for (let time = 0; time < frames; time++) {
    const offset = time * HOP;
    for (let i = 0; i < N_FFT; i++) windowed[i] = signal[offset + i] * window[i];
    const spectrum = realFft(windowed);
    for (let frequency = 0; frequency < N_FREQ; frequency++) {
      data[(frequency * frames + time) * 2] = spectrum[frequency * 2];
      data[(frequency * frames + time) * 2 + 1] = spectrum[frequency * 2 + 1];
    }
  }
  return { data, frames };
}

function inverseStft(data, frames, window, length) {
  const output = new Float32Array(length), windowSum = new Float32Array(length);
  const spectrum = new Float32Array(N_FREQ * 2);
  for (let time = 0; time < frames; time++) {
    for (let frequency = 0; frequency < N_FREQ; frequency++) {
      spectrum[frequency * 2] = data[(frequency * frames + time) * 2];
      spectrum[frequency * 2 + 1] = data[(frequency * frames + time) * 2 + 1];
    }
    const frame = inverseRealFft(spectrum), offset = time * HOP;
    for (let i = 0; i < N_FFT && offset + i < length; i++) {
      output[offset + i] += frame[i] * window[i];
      windowSum[offset + i] += window[i] * window[i];
    }
  }
  for (let i = 0; i < length; i++) if (windowSum[i] > 1e-8) output[i] /= windowSum[i];
  return output;
}

export function prepareSeparatorInput(left, right, window = hannWindow()) {
  const leftSpectrum = stft(left, window), rightSpectrum = stft(right, window);
  const frames = leftSpectrum.frames;
  const input = new Float32Array(frames * FEATURE_SIZE);
  for (let time = 0; time < frames; time++) for (let frequency = 0; frequency < N_FREQ; frequency++) {
    const source = (frequency * frames + time) * 2;
    const target = time * FEATURE_SIZE + frequency * 4;
    input[target] = leftSpectrum.data[source]; input[target + 1] = leftSpectrum.data[source + 1];
    input[target + 2] = rightSpectrum.data[source]; input[target + 3] = rightSpectrum.data[source + 1];
  }
  return { input, frames, leftSpectrum, rightSpectrum };
}

export function reconstructVocals(mask, prepared, window, length) {
  const { frames, leftSpectrum, rightSpectrum } = prepared;
  const maskedLeft = new Float32Array(N_FREQ * frames * 2);
  const maskedRight = new Float32Array(N_FREQ * frames * 2);
  for (let frequency = 0; frequency < N_FREQ; frequency++) for (let time = 0; time < frames; time++) {
    const source = (frequency * frames + time) * 2;
    for (let channel = 0; channel < 2; channel++) {
      const maskIndex = ((frequency * 2 + channel) * frames + time) * 2;
      const spectrum = channel ? rightSpectrum.data : leftSpectrum.data;
      const destination = channel ? maskedRight : maskedLeft;
      destination[source] = spectrum[source] * mask[maskIndex] - spectrum[source + 1] * mask[maskIndex + 1];
      destination[source + 1] = spectrum[source] * mask[maskIndex + 1] + spectrum[source + 1] * mask[maskIndex];
    }
  }
  for (let time = 0; time < frames; time++) {
    maskedLeft[time * 2] = maskedLeft[time * 2 + 1] = 0;
    maskedRight[time * 2] = maskedRight[time * 2 + 1] = 0;
  }
  return {
    left: inverseStft(maskedLeft, frames, window, length),
    right: inverseStft(maskedRight, frames, window, length),
  };
}

export function separatorTensorShape(frames) {
  return [1, frames, FEATURE_SIZE];
}

export function separatorChunkStarts(total, mode = "balanced") {
  const step = mode === "fast" ? SEPARATOR_CHUNK_SIZE * 3 / 4 : SEPARATOR_STEP;
  const starts = [];
  for (let start = step - SEPARATOR_CHUNK_SIZE; start < total; start += step) {
    starts.push(start);
    if (start + SEPARATOR_CHUNK_SIZE >= total + 2048) break;
  }
  return starts;
}
