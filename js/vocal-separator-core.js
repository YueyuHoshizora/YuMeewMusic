export const SEPARATOR_SAMPLE_RATE = 44100;
export const SEPARATOR_CHUNK_SIZE = 131072;
export const SEPARATOR_STEP = SEPARATOR_CHUNK_SIZE / 2;
export const SEPARATOR_MODEL_SIZE_MB = 103;
export const SEPARATOR_MAX_DURATION = 5 * 60;

const N_FFT = 2048;
const HOP = 512;
const N_FREQ = N_FFT / 2 + 1;
const FEATURE_SIZE = N_FREQ * 2 * 2;

export function separatorFilename(name, stem) {
  const base = String(name || "audio").replace(/\.[^.]+$/, "").replace(/[\\/:*?"<>|]+/g, "-") || "audio";
  if (!["vocals", "instrumental"].includes(stem)) throw Error("無效的分離音軌。");
  return `${base}-${stem}.wav`;
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
