export const SEPARATOR_EQ_PROFILE = Object.freeze({ gainLimit: 24, bass: 300, mid: 1000, treble: 3000, midQ: 0.5 });
const clampGain = (value, limit) => Math.max(-limit, Math.min(limit, Number(value) || 0));

function coefficients(type, frequency, gain, sampleRate, q = 1) {
  const A = 10 ** (gain / 40);
  const omega = 2 * Math.PI * Math.min(frequency, sampleRate * 0.45) / sampleRate;
  const cosine = Math.cos(omega), sine = Math.sin(omega);
  let b0, b1, b2, a0, a1, a2;
  if (type === "peaking") {
    const alpha = sine / (2 * q);
    b0 = 1 + alpha * A; b1 = -2 * cosine; b2 = 1 - alpha * A;
    a0 = 1 + alpha / A; a1 = -2 * cosine; a2 = 1 - alpha / A;
  } else {
    const alpha = sine / Math.sqrt(2), beta = 2 * Math.sqrt(A) * alpha;
    if (type === "lowshelf") {
      b0 = A * ((A + 1) - (A - 1) * cosine + beta);
      b1 = 2 * A * ((A - 1) - (A + 1) * cosine);
      b2 = A * ((A + 1) - (A - 1) * cosine - beta);
      a0 = (A + 1) + (A - 1) * cosine + beta;
      a1 = -2 * ((A - 1) + (A + 1) * cosine);
      a2 = (A + 1) + (A - 1) * cosine - beta;
    } else {
      b0 = A * ((A + 1) + (A - 1) * cosine + beta);
      b1 = -2 * A * ((A - 1) + (A + 1) * cosine);
      b2 = A * ((A + 1) + (A - 1) * cosine - beta);
      a0 = (A + 1) - (A - 1) * cosine + beta;
      a1 = 2 * ((A - 1) - (A + 1) * cosine);
      a2 = (A + 1) - (A - 1) * cosine - beta;
    }
  }
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
}

function createBiquad(config) {
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  return samples => {
    const { b0, b1, b2, a1, a2 } = config;
    for (let i = 0; i < samples.length; i++) {
      const x = samples[i];
      const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
      x2 = x1; x1 = x; y2 = y1; y1 = Number.isFinite(y) ? y : 0; samples[i] = y1;
    }
  };
}

export function createAudioEqualizer(settings = {}, sampleRate, numberOfChannels, profile = {}) {
  const limit = profile.gainLimit || 10;
  const bands = [
    ["lowshelf", profile.bass || 200, clampGain(settings.eqBass, limit)],
    ["peaking", profile.mid || 1000, clampGain(settings.eqMid, limit)],
    ["highshelf", profile.treble || 4000, clampGain(settings.eqTreble, limit)],
  ];
  const active = bands.filter(([, , gain]) => gain !== 0);
  const filters = Array.from({ length: numberOfChannels }, () =>
    active.map(([type, frequency, gain]) => createBiquad(coefficients(type, frequency, gain, sampleRate, profile.midQ || 1))),
  );
  return {
    gains: bands.map(([, , gain]) => gain),
    process(source, channel) {
      if (!active.length) return source;
      const output = Float32Array.from(source);
      for (const filter of filters[channel]) filter(output);
      return output;
    },
  };
}
