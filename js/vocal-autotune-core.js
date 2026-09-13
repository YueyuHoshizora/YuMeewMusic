const FRAME_SIZE = 4096;
const HOP_SIZE = 1024;
const ANALYSIS_DOWNSAMPLE = 8;
const MIN_PITCH = 70;
const MAX_PITCH = 1000;
const YIN_THRESHOLD = 0.16;

const SCALES = Object.freeze({
  chromatic: [...Array(12).keys()],
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
});

const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));

function assertStereoPcmWav(buffer) {
  const view = new DataView(buffer);
  const text = (offset, length) => String.fromCharCode(...new Uint8Array(buffer, offset, length));
  if (buffer.byteLength < 44 || text(0, 4) !== "RIFF" || text(8, 4) !== "WAVE" || text(12, 4) !== "fmt ")
    throw Error("人聲 WAV 格式不正確，請重新執行人聲分離。");
  if (view.getUint16(20, true) !== 1 || view.getUint16(22, true) !== 2 || view.getUint16(34, true) !== 16)
    throw Error("自動調音目前只支援 16-bit 立體聲 PCM WAV。");
  const sampleRate = view.getUint32(24, true);
  const dataOffset = 44;
  const frameCount = Math.floor((buffer.byteLength - dataOffset) / 4);
  return { view, sampleRate, dataOffset, frameCount };
}

function readSample(view, dataOffset, frameCount, frame, channel) {
  if (frame < 0 || frame >= frameCount) return 0;
  return view.getInt16(dataOffset + frame * 4 + channel * 2, true) / 32768;
}

function estimatePitch(view, dataOffset, frameCount, center, sampleRate) {
  const analysisLength = FRAME_SIZE / ANALYSIS_DOWNSAMPLE;
  const samples = new Float32Array(analysisLength);
  const start = center - FRAME_SIZE / 2;
  let mean = 0;
  for (let index = 0; index < analysisLength; index++) {
    const frame = start + index * ANALYSIS_DOWNSAMPLE;
    samples[index] = (readSample(view, dataOffset, frameCount, frame, 0) + readSample(view, dataOffset, frameCount, frame, 1)) * 0.5;
    mean += samples[index];
  }
  mean /= analysisLength;
  let energy = 0;
  for (let index = 0; index < analysisLength; index++) {
    samples[index] -= mean;
    energy += samples[index] ** 2;
  }
  if (Math.sqrt(energy / analysisLength) < 0.008) return null;

  const reducedRate = sampleRate / ANALYSIS_DOWNSAMPLE;
  const minimumLag = Math.max(2, Math.floor(reducedRate / MAX_PITCH));
  const maximumLag = Math.min(analysisLength - 3, Math.ceil(reducedRate / MIN_PITCH));
  const differences = new Float32Array(maximumLag + 1);
  for (let lag = 1; lag <= maximumLag; lag++) {
    let sum = 0;
    for (let index = 0; index < analysisLength - lag; index++) {
      const difference = samples[index] - samples[index + lag];
      sum += difference * difference;
    }
    differences[lag] = sum;
  }
  let running = 0;
  for (let lag = 1; lag <= maximumLag; lag++) {
    running += differences[lag];
    differences[lag] = running > 1e-12 ? differences[lag] * lag / running : 1;
  }
  let selectedLag = 0;
  let selectedValue = Number.POSITIVE_INFINITY;
  for (let lag = minimumLag; lag <= maximumLag; lag++) {
    const normalized = differences[lag];
    if (normalized < selectedValue) {
      selectedValue = normalized;
      selectedLag = lag;
    }
    if (normalized < YIN_THRESHOLD && normalized <= (differences[lag - 1] || 1)) {
      while (lag + 1 <= maximumLag && differences[lag + 1] < differences[lag]) lag++;
      selectedLag = lag;
      selectedValue = differences[lag];
      break;
    }
  }
  if (!selectedLag || selectedValue > 0.42) return null;
  const left = differences[selectedLag - 1] || differences[selectedLag];
  const middle = differences[selectedLag];
  const right = differences[selectedLag + 1] || differences[selectedLag];
  const denominator = left - 2 * middle + right;
  const refinedLag = selectedLag + (Math.abs(denominator) > 1e-9 ? 0.5 * (left - right) / denominator : 0);
  const pitch = reducedRate / refinedLag;
  return Number.isFinite(pitch) && pitch >= MIN_PITCH && pitch <= MAX_PITCH ? pitch : null;
}

function nearestScaleMidi(midi, scale, tonic) {
  if (scale === "chromatic") return Math.round(midi);
  const allowed = SCALES[scale] || SCALES.chromatic;
  let nearest = Math.round(midi), distance = Number.POSITIVE_INFINITY;
  for (let note = Math.floor(midi) - 12; note <= Math.ceil(midi) + 12; note++) {
    const pitchClass = ((note - tonic) % 12 + 12) % 12;
    if (!allowed.includes(pitchClass)) continue;
    const currentDistance = Math.abs(note - midi);
    if (currentDistance < distance) {
      nearest = note;
      distance = currentDistance;
    }
  }
  return nearest;
}

export function correctionRatio(pitch, { scale = "chromatic", tonic = 0, strength = 100 } = {}) {
  if (!Number.isFinite(pitch) || pitch <= 0) return 1;
  const midi = 69 + 12 * Math.log2(pitch / 440);
  const target = nearestScaleMidi(midi, scale, Number(tonic) || 0);
  return 2 ** ((target - midi) / 12 * clamp(Number(strength) || 0, 0, 100) / 100);
}

function analyseRatios(input, options, onProgress) {
  const { view, dataOffset, frameCount, sampleRate } = input;
  const frameTotal = Math.ceil(frameCount / HOP_SIZE) + 2;
  const ratios = new Float32Array(frameTotal);
  const periods = new Float32Array(frameTotal);
  let previous = 1;
  for (let frameIndex = 0; frameIndex < frameTotal; frameIndex++) {
    const center = frameIndex * HOP_SIZE;
    const pitch = estimatePitch(view, dataOffset, frameCount, center, sampleRate);
    const detected = pitch ? correctionRatio(pitch, options) : 1;
    const smoothing = pitch ? clamp(Number(options.smoothing) || 25, 0, 90) / 100 : 0;
    ratios[frameIndex] = detected * (1 - smoothing) + previous * smoothing;
    periods[frameIndex] = pitch ? sampleRate / pitch : 0;
    previous = ratios[frameIndex];
    if (frameIndex % 48 === 0) onProgress(frameIndex / frameTotal * 0.35);
  }
  return { ratios, periods };
}

function pitchSynchronousCenters(ratios, periods) {
  const centers = new Float32Array(ratios.length);
  let previousSource = 0;
  let previousVoiced = false;
  for (let frameIndex = 0; frameIndex < ratios.length; frameIndex++) {
    const outputCenter = frameIndex * HOP_SIZE;
    if (!periods[frameIndex]) {
      centers[frameIndex] = outputCenter;
      previousSource = outputCenter;
      previousVoiced = false;
      continue;
    }
    if (!previousVoiced) {
      centers[frameIndex] = outputCenter;
    } else {
      let desired = previousSource + HOP_SIZE * ratios[frameIndex];
      desired += Math.round((outputCenter - desired) / periods[frameIndex]) * periods[frameIndex];
      centers[frameIndex] = desired;
    }
    previousSource = centers[frameIndex];
    previousVoiced = true;
  }
  return centers;
}

function processChannel(input, outputView, ratios, sourceCenters, channel, onProgress) {
  const { view, dataOffset, frameCount } = input;
  const accumulated = new Float32Array(frameCount);
  const weights = new Float32Array(frameCount);
  const half = FRAME_SIZE / 2;
  for (let frameIndex = 0; frameIndex < ratios.length; frameIndex++) {
    const center = frameIndex * HOP_SIZE;
    const outputStart = Math.max(0, center - half);
    const outputEnd = Math.min(frameCount, center + half);
    for (let frame = outputStart; frame < outputEnd; frame++) {
      const relative = frame - center;
      const phase = (relative + half) / FRAME_SIZE;
      const window = 0.5 - 0.5 * Math.cos(2 * Math.PI * phase);
      const sourcePosition = sourceCenters[frameIndex] + relative;
      const sourceFloor = Math.floor(sourcePosition);
      const fraction = sourcePosition - sourceFloor;
      const first = readSample(view, dataOffset, frameCount, sourceFloor, channel);
      const second = readSample(view, dataOffset, frameCount, sourceFloor + 1, channel);
      accumulated[frame] += (first + (second - first) * fraction) * window;
      weights[frame] += window;
    }
    if (frameIndex % 48 === 0) onProgress(0.35 + (channel + frameIndex / ratios.length) * 0.325);
  }
  for (let frame = 0; frame < frameCount; frame++) {
    const sample = weights[frame] > 1e-8 ? accumulated[frame] / weights[frame] : 0;
    const limited = clamp(Number.isFinite(sample) ? sample : 0, -1, 1);
    outputView.setInt16(44 + frame * 4 + channel * 2, limited < 0 ? limited * 32768 : limited * 32767, true);
  }
}

export function autoTuneStereoWav(buffer, options = {}, onProgress = () => {}) {
  const input = assertStereoPcmWav(buffer);
  const output = buffer.slice(0);
  const outputView = new DataView(output);
  const { ratios, periods } = analyseRatios(input, options, onProgress);
  const sourceCenters = pitchSynchronousCenters(ratios, periods);
  processChannel(input, outputView, ratios, sourceCenters, 0, onProgress);
  processChannel(input, outputView, ratios, sourceCenters, 1, onProgress);
  onProgress(1);
  return output;
}
