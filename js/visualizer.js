import { subtitleFontFamily } from "./fonts.js";
import { subtitleAt } from "./subtitles.js";
export function spectrum(b, t) {
  const out = new Float32Array(64);
  if (!b) {
    for (let i = 0; i < 64; i++)
      out[i] = 0.18 + Math.abs(Math.sin(i * 0.42) * Math.cos(i * 0.13)) * 0.55;
    return out;
  }
  const data = b.getChannelData(0),
    n = 1024,
    start = Math.floor(t * b.sampleRate);
  const re = new Float32Array(n),
    im = new Float32Array(n);
  for (let i = 0; i < n; i++)
    re[i] = (data[start + i] || 0) * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1)));
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) [re[i], re[j]] = [re[j], re[i]];
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    for (let i = 0; i < n; i += len) {
      for (let j = 0; j < len / 2; j++) {
        const c = Math.cos(ang * j),
          s = Math.sin(ang * j),
          k = i + j,
          l = k + len / 2,
          tr = re[l] * c - im[l] * s,
          ti = re[l] * s + im[l] * c;
        re[l] = re[k] - tr;
        im[l] = im[k] - ti;
        re[k] += tr;
        im[k] += ti;
      }
    }
  }
  for (let i = 0; i < 64; i++) {
    const k = Math.min(511, Math.floor(2 * Math.pow(230, i / 63)));
    out[i] = Math.min(1, Math.log10(1 + Math.hypot(re[k], im[k])) / 1.7);
  }
  return out;
}
export function drawBackground(canvas, img, darkness = 0) {
  const c = canvas.getContext("2d");
  const w = canvas.width;
  const h = canvas.height;
  c.fillStyle = "#0c1112";
  c.fillRect(0, 0, w, h);
  if (img) {
    const sourceWidth = img.videoWidth || img.naturalWidth || img.displayWidth || img.width;
    const sourceHeight = img.videoHeight || img.naturalHeight || img.displayHeight || img.height;
    const scale = Math.max(w / sourceWidth, h / sourceHeight);
    const x = (w - sourceWidth * scale) / 2;
    const y = (h - sourceHeight * scale) / 2;
    if (typeof img.draw === "function") img.draw(c, x, y, sourceWidth * scale, sourceHeight * scale);
    else c.drawImage(img, x, y, sourceWidth * scale, sourceHeight * scale);
  } else {
    const g = c.createRadialGradient(w * 0.5, h * 0.45, 0, w * 0.5, h * 0.5, w * 0.65);
    g.addColorStop(0, "#26302b");
    g.addColorStop(1, "#080c0d");
    c.fillStyle = g;
    c.fillRect(0, 0, w, h);
    c.strokeStyle = "#ffffff06";
    c.lineWidth = 1;
    for (let x = 0; x < w; x += w / 24) {
      c.beginPath();
      c.moveTo(x, 0);
      c.lineTo(x, h);
      c.stroke();
    }
    for (let y = 0; y < h; y += w / 24) {
      c.beginPath();
      c.moveTo(0, y);
      c.lineTo(w, y);
      c.stroke();
    }
  }
  c.fillStyle = `rgba(0,0,0,${(darkness / 100) * 0.85})`;
  c.fillRect(0, 0, w, h);
}

// Catmull-Rom spline: smoothly interpolates between p1 and p2 using their neighbours,
// so a curve through discrete spectrum bins has no sharp joints or repeated segments.
function catmullRom(p0, p1, p2, p3, t) {
  const t2 = t * t, t3 = t2 * t;
  return 0.5 * (
    2 * p1 +
    (p2 - p0) * t +
    (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
    (3 * p1 - 3 * p2 + p3 - p0) * t3
  );
}

// One heartbeat cycle (P wave, QRS spike, T wave) sampled at phase u in [0, 1).
function ecgPulse(u) {
  const p = Math.exp(-(((u - 0.16) * 22) ** 2)) * 0.18;
  const qrs = Math.exp(-(((u - 0.32) * 55) ** 2)) - Math.exp(-(((u - 0.28) * 90) ** 2)) * 0.5;
  const t2 = Math.exp(-(((u - 0.55) * 14) ** 2)) * 0.3;
  return p + qrs + t2;
}

export function drawDynamic(canvas, t, b, img, s, includeSongDetails = true) {
  const c = canvas.getContext("2d");
  const w = canvas.width;
  let h = canvas.height;
  // Translate only the visualizer, after painting the fixed background.
  c.save();
  const position = key => Number.isFinite(s[key]) ? Math.max(-50, Math.min(50, s[key])) : 0;
  // Gradient wall stays pinned to the bottom edge; position offsets don't apply to it.
  if (s.style !== 31) {
    c.translate(w * position("positionX") / 100, h * position("positionY") / 100);
  }
  // Keep circular and radial styles within the narrow side of portrait frames.
  c.translate(0, (h - Math.min(w, h)) / 2);
  h = Math.min(w, h);
  if (s.style === 19) {
    c.restore();
    if (includeSongDetails) drawSongDetails(c, canvas.width, canvas.height, s, t);
    return;
  }
  const values = spectrum(b, t),
    gain = 0.35 + s.strength / 70;
  c.strokeStyle = s.color;
  c.fillStyle = s.color;
  c.shadowColor = s.color;
  c.shadowBlur = h * 0.013;
  c.lineWidth = h * 0.003;
  c.lineCap = "round";
  const cx = w / 2,
    cy = h * 0.47,
    r = h * 0.21;
  if (s.style === 0 || s.style === 4) {
    for (let i = 0; i < 128; i++) {
      const a = (i / 128) * Math.PI * 2 - Math.PI / 2,
        v = values[i < 64 ? i : 127 - i],
        len = (0.008 + v * 0.095 * gain) * h,
        rr = s.style === 4 ? r * 0.7 : r;
      c.beginPath();
      c.moveTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
      c.lineTo(cx + Math.cos(a) * (rr + len), cy + Math.sin(a) * (rr + len));
      c.stroke();
    }
    c.shadowBlur = 0;
    c.strokeStyle = s.color + "35";
    c.beginPath();
    c.arc(cx, cy, r * 0.9, 0, Math.PI * 2);
    c.stroke();
  } else if (s.style === 18) {
    drawVinyl(c, w, h, t, values, gain, s.sleeve || img, s.color, s.record);
  } else if (s.style >= 6) {
    drawExtra(c, w, h, t, values, gain, s.style);
  } else if (s.style === 3) {
    const left = w * 0.12, span = w * 0.76, amp = h * 0.16 * gain, points = 96;
    const sampleAt = u => {
      const pos = Math.min(62.999, u * 63), i1 = Math.floor(pos);
      const i0 = Math.max(0, i1 - 1), i2 = Math.min(63, i1 + 1), i3 = Math.min(63, i1 + 2);
      return Math.max(0, catmullRom(values[i0], values[i1], values[i2], values[i3], pos - i1));
    };
    const top = [], bottom = [];
    for (let i = 0; i <= points; i++) {
      const u = i / points,
        x = left + u * span,
        wobble = 1 + Math.sin(u * Math.PI * 3 + t * 1.6) * 0.1,
        y = sampleAt(u) * amp * wobble;
      top.push([x, cy - y]);
      bottom.push([x, cy + y]);
    }
    c.shadowBlur = 0;
    const fill = c.createLinearGradient(0, cy - amp, 0, cy + amp);
    fill.addColorStop(0, s.color + "00");
    fill.addColorStop(0.5, s.color + "4d");
    fill.addColorStop(1, s.color + "00");
    c.beginPath();
    c.moveTo(top[0][0], top[0][1]);
    for (let i = 1; i <= points; i++) c.lineTo(top[i][0], top[i][1]);
    for (let i = points; i >= 0; i--) c.lineTo(bottom[i][0], bottom[i][1]);
    c.closePath();
    c.fillStyle = fill;
    c.fill();
    c.shadowBlur = h * 0.013;
    c.beginPath();
    c.moveTo(top[0][0], top[0][1]);
    for (let i = 1; i <= points; i++) c.lineTo(top[i][0], top[i][1]);
    c.stroke();
    c.beginPath();
    c.moveTo(bottom[0][0], bottom[0][1]);
    for (let i = 1; i <= points; i++) c.lineTo(bottom[i][0], bottom[i][1]);
    c.stroke();
  } else {
    for (let i = 0; i < 64; i++) {
      const x = w * 0.13 + (i / 64) * w * 0.74,
        v = values[i] * gain,
        bar = Math.max(3, v * h * 0.3);
      if (s.style === 5) {
        const rows = 16,
          lit = v * rows;
        for (let j = 0; j < rows; j++) {
          const above = lit - j;
          if (above > 0) {
            c.globalAlpha = 0.5 + 0.5 * Math.min(1, above);
            c.beginPath();
            c.arc(x, h * 0.68 - j * h * 0.0213, h * (0.0032 + Math.min(1, above) * 0.0016), 0, Math.PI * 2);
            c.fill();
          } else {
            const wave = Math.sin((j / rows - t * 0.4 + i * 0.03) * Math.PI * 2);
            c.globalAlpha = 0.05 + 0.09 * Math.max(0, wave);
            c.beginPath();
            c.arc(x, h * 0.68 - j * h * 0.0213, h * 0.0022, 0, Math.PI * 2);
            c.fill();
          }
        }
        if (lit > 0.5) {
          const peak = Math.min(rows - 0.5, lit);
          c.globalAlpha = 0.55 + 0.45 * Math.sin(t * 8 + i * 0.6);
          c.beginPath();
          c.arc(x, h * 0.68 - peak * h * 0.0213, h * (0.005 + Math.min(1, lit / rows) * 0.0025), 0, Math.PI * 2);
          c.fill();
        }
        c.globalAlpha = 1;
      } else {
        c.fillRect(x, s.style === 2 ? cy - bar / 2 : h * 0.65 - bar, w * 0.006, bar);
      }
    }
  }
  c.shadowBlur = 0;
  c.restore();
  if (includeSongDetails) drawSongDetails(c, canvas.width, canvas.height, s, t);
}

export function draw(canvas, t, b, img, s) {
  drawBackground(canvas, img, s.darkness);
  drawDynamic(canvas, t, b, img, s);
  const c = canvas.getContext("2d");
  drawSubtitles(c, canvas.width, canvas.height, s, t);
  drawIdentity(c, canvas.width, canvas.height, s);
}

export function songTextOpacity(time, fadeAfter = 5) {
  const delay = Number.isFinite(fadeAfter) ? Math.max(1, Math.min(15, fadeAfter)) : 5;
  return Math.max(0, Math.min(1, 1 - (time - delay)));
}

export function drawSongDetails(c, width, height, settings, time) {
  const lines = [
    [settings.songTitle, true],
    [settings.lyricist ? `作詞：${settings.lyricist}` : "", false],
    [settings.composer ? `作曲：${settings.composer}` : "", false],
  ].filter(([text]) => typeof text === "string" && text.trim());
  if (!lines.length) return;
  const unit = Math.min(width, height);
  const bounded = (value, fallback, min, max) => Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
  const scale = bounded(settings.textSize, 100, 50, 250) / 50;
  const x = width * bounded(settings.textX, 50, 0, 100) / 100;
  const y = height * bounded(settings.textY, 91, 0, 100) / 100;
  const lineHeight = unit * .04 * scale;
  c.save();
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.globalAlpha = songTextOpacity(time, settings.textFadeAfter);
  c.globalCompositeOperation = "source-over";
  c.textAlign = "center";
  c.textBaseline = "middle";
  c.shadowColor = "#000000";
  c.shadowBlur = unit * .012;
  lines.forEach(([text, title], i) => {
    c.fillStyle = typeof settings.textColor === "string" && /^#[0-9a-f]{6}$/i.test(settings.textColor) ? settings.textColor : "#ffffff";
    c.font = `${title ? 600 : 400} ${unit * (title ? .032 : .022) * scale}px sans-serif`;
    c.fillText(text, x, y - (lines.length - 1 - i) * lineHeight, width * .86);
  });
  c.restore();
}

// Every frame depends only on audio and timestamp, so seeking and export stay consistent.
function drawExtra(c, w, h, t, values, gain, style) {
  const cx = w / 2,
    cy = h * 0.47;
  const energy = values.reduce((sum, value) => sum + value, 0) / values.length;
  if (style === 6) {
    for (let ring = 0; ring < 7; ring++) {
      c.globalAlpha = 0.25 + (6 - ring) * 0.1;
      c.beginPath();
      for (let i = 0; i <= 128; i++) {
        const a = (i / 128) * Math.PI * 2;
        const radius = h * (0.055 + ring * 0.035 + values[(i + ring * 7) % 64] * gain * 0.025);
        const x = cx + Math.cos(a) * radius,
          y = cy + Math.sin(a) * radius;
        i ? c.lineTo(x, y) : c.moveTo(x, y);
      }
      c.stroke();
    }
  } else if (style === 7) {
    for (let arm = 0; arm < 3; arm++) {
      c.beginPath();
      for (let i = 0; i < 192; i++) {
        const u = i / 191,
          a = u * Math.PI * 5 + (arm * Math.PI * 2) / 3 + t * 0.35;
        const radius = h * (0.025 + u * 0.27 + values[i % 64] * gain * 0.035);
        const x = cx + Math.cos(a) * radius,
          y = cy + Math.sin(a) * radius;
        i ? c.lineTo(x, y) : c.moveTo(x, y);
      }
      c.stroke();
    }
  } else if (style === 8) {
    for (let layer = 0; layer < 5; layer++) {
      c.globalAlpha = 0.3 + layer * 0.14;
      c.beginPath();
      for (let i = 0; i < 128; i++) {
        const u = i / 127,
          envelope = Math.sin(u * Math.PI);
        const v = values[Math.floor(u * 63)];
        const x = w * (0.1 + u * 0.8);
        const y =
          cy +
          (layer - 2) * h * 0.05 +
          Math.sin(u * Math.PI * 6 + t * 1.6 + layer * 0.7) *
            envelope *
            h *
            (0.015 + v * gain * 0.13);
        i ? c.lineTo(x, y) : c.moveTo(x, y);
      }
      c.stroke();
    }
  } else if (style === 9) {
    c.shadowBlur = h * 0.006;
    for (let i = 0; i < 120; i++) {
      const phase = (i * 0.61803398875 + t * 0.035) % 1;
      const a = i * 2.399963 + t * 0.08;
      const radius = h * (0.05 + phase * 0.34) * (1 + energy * gain * 0.18);
      const v = values[i % 64];
      c.globalAlpha = (0.2 + v * 0.8) * Math.sin(phase * Math.PI);
      c.beginPath();
      c.arc(
        cx + Math.cos(a) * radius * 1.45,
        cy + Math.sin(a) * radius,
        h * (0.0018 + v * gain * 0.005),
        0,
        Math.PI * 2,
      );
      c.fill();
    }
  } else if (style === 10) {
    for (let strand = 0; strand < 2; strand++) {
      c.beginPath();
      for (let i = 0; i < 128; i++) {
        const u = i / 127,
          v = values[i % 64];
        const x = w * (0.13 + u * 0.74);
        const y =
          cy +
          Math.sin(u * Math.PI * 5 + t * 1.8 + strand * Math.PI) * h * (0.06 + v * gain * 0.12);
        i ? c.lineTo(x, y) : c.moveTo(x, y);
      }
      c.stroke();
    }
    c.globalAlpha = 0.35;
    for (let i = 0; i < 40; i++) {
      const u = i / 39,
        x = w * (0.13 + u * 0.74);
      const offset =
        Math.sin(u * Math.PI * 5 + t * 1.8) *
        h *
        (0.06 + values[Math.floor(u * 127) % 64] * gain * 0.12);
      c.beginPath();
      c.moveTo(x, cy - offset);
      c.lineTo(x, cy + offset);
      c.stroke();
    }
  } else if (style === 11) {
    for (let ring = 0; ring < 10; ring++) {
      const phase = (ring / 10 + t * 0.12) % 1;
      const radius = h * (0.025 + phase * 0.35 + values[ring * 6] * gain * 0.025);
      c.globalAlpha = Math.sin(phase * Math.PI) * 0.8;
      c.beginPath();
      for (let corner = 0; corner <= 6; corner++) {
        const a = (corner * Math.PI) / 3 + t * 0.14 + ring * 0.025;
        const x = cx + Math.cos(a) * radius * 1.3,
          y = cy + Math.sin(a) * radius;
        corner ? c.lineTo(x, y) : c.moveTo(x, y);
      }
      c.stroke();
    }
  }
  if (style === 12) {
    for (let layer = 0; layer < 4; layer++) {
      c.globalAlpha = .35 + layer * .2;
      c.beginPath();
      for (let i = 0; i < 64; i++) {
        const x = w * (.08 + i / 63 * .84);
        const y = cy + h * (.18 - layer * .07) - values[i] * gain * h * .22;
        i ? c.lineTo(x, y) : c.moveTo(x, y);
      }
      c.stroke();
    }
  } else if (style === 13) {
    for (let layer = 0; layer < 3; layer++) {
      c.globalAlpha = .9 - layer * .25;
      c.beginPath();
      for (let i = 0; i <= 256; i++) {
        const a = i / 256 * Math.PI * 2;
        const radius = h * (.12 + layer * .035 + Math.sin(a * 6 + t) * (.035 + energy * gain * .12) + values[i % 64] * gain * .025);
        const x = cx + Math.cos(a + t * .12) * radius;
        const y = cy + Math.sin(a + t * .12) * radius;
        i ? c.lineTo(x, y) : c.moveTo(x, y);
      }
      c.stroke();
    }
  } else if (style === 14) {
    for (let i = 0; i < 64; i++) {
      const phase = (i * .618 + t * (.12 + i % 5 * .025)) % 1;
      const x = w * (.1 + i / 63 * .8), y = h * (.14 + phase * .65);
      c.globalAlpha = Math.sin(phase * Math.PI) * .9;
      c.fillRect(x, y, h * .004, h * (.015 + values[i] * gain * .14));
    }
  } else if (style === 15) {
    for (let layer = 0; layer < 8; layer++) {
      const radius = h * (.04 + layer * .032 + values[layer * 8] * gain * .06);
      const angle = Math.sin(t * .5) * .25 + layer * .035;
      c.globalAlpha = 1 - layer * .09;
      c.beginPath();
      for (let i = 0; i <= 4; i++) {
        const a = i * Math.PI / 2 + angle;
        const x = cx + Math.cos(a) * radius, y = cy + Math.sin(a) * radius;
        i ? c.lineTo(x, y) : c.moveTo(x, y);
      }
      c.stroke();
    }
  } else if (style === 16) {
    for (let orbit = 0; orbit < 5; orbit++) {
      const radius = h * (.08 + orbit * .045 + values[orbit * 12] * gain * .025);
      c.globalAlpha = .35;
      c.beginPath();
      c.ellipse(cx, cy, radius * 1.4, radius * .65, orbit * .5, 0, Math.PI * 2);
      c.stroke();
      const a = t * (.4 + orbit * .12) + orbit;
      const x = Math.cos(a) * radius * 1.4, y = Math.sin(a) * radius * .65;
      c.globalAlpha = 1;
      c.beginPath();
      c.arc(cx + x * Math.cos(orbit * .5) - y * Math.sin(orbit * .5), cy + x * Math.sin(orbit * .5) + y * Math.cos(orbit * .5), h * (.005 + values[orbit * 12] * gain * .014), 0, Math.PI * 2);
      c.fill();
    }
  } else if (style === 17) {
    for (let layer = 0; layer < 3; layer++) {
      c.globalAlpha = 1 - layer * .3;
      c.beginPath();
      for (let i = 0; i < 128; i++) {
        const x = w * (.08 + i / 127 * .84);
        const y = cy + Math.sin(i * 2.4 + t * 12 + layer) * h * (.004 + values[i % 64] * gain * .2) * Math.sin(i / 127 * Math.PI);
        i ? c.lineTo(x, y) : c.moveTo(x, y);
      }
      c.stroke();
    }
  } else if (style === 20) {
    // Particle fountain: columns of rising sparks whose height and count track each bin's energy.
    const columns = 32,
      particles = 5;
    for (let col = 0; col < columns; col++) {
      const bin = col * 2,
        v = values[bin] * gain,
        x = w * (0.08 + (col / (columns - 1)) * 0.84);
      for (let p = 0; p < particles; p++) {
        const phase = (p / particles + t * (0.5 + v * 0.6) + col * 0.013) % 1,
          y = h * (0.85 - phase * (0.15 + v * 0.55));
        c.globalAlpha = Math.sin(phase * Math.PI) * (0.25 + v * 0.75);
        c.beginPath();
        c.arc(x, y, h * (0.002 + v * 0.006) * (1 - phase * 0.4), 0, Math.PI * 2);
        c.fill();
      }
    }
  } else if (style === 21) {
    // Spectrum horizon: filled skyline across the full spectrum with a faint rippling reflection.
    const left = w * 0.08,
      span = w * 0.84,
      points = 80,
      baseline = cy + h * 0.12,
      sampleAt = u => values[Math.min(63, Math.floor(u * 63))] * gain;
    c.shadowBlur = 0;
    c.beginPath();
    c.moveTo(left, baseline);
    for (let i = 0; i <= points; i++) {
      const u = i / points;
      c.lineTo(left + u * span, baseline - sampleAt(u) * h * 0.32 - h * 0.01);
    }
    c.lineTo(left + span, baseline);
    c.closePath();
    c.globalAlpha = 0.55;
    c.fill();
    c.globalAlpha = 1;
    c.beginPath();
    c.moveTo(left, baseline - sampleAt(0) * h * 0.32 - h * 0.01);
    for (let i = 1; i <= points; i++) {
      const u = i / points;
      c.lineTo(left + u * span, baseline - sampleAt(u) * h * 0.32 - h * 0.01);
    }
    c.stroke();
    c.globalAlpha = 0.22;
    for (let i = 0; i <= points; i += 2) {
      const u = i / points,
        x = left + u * span,
        v = sampleAt(u);
      c.beginPath();
      c.moveTo(x, baseline);
      c.lineTo(x, baseline + v * h * 0.18 * (0.6 + 0.4 * Math.sin(t * 2 + u * 6)));
      c.stroke();
    }
  } else if (style === 22) {
    // Pinwheel: curved blades sweep around the centre, each blade's reach set by its own bin.
    const blades = 6;
    for (let b = 0; b < blades; b++) {
      const v = values[b * 10] * gain,
        a0 = (b / blades) * Math.PI * 2 + t * 0.6,
        len = h * (0.12 + v * 0.22),
        midA = a0 + 0.35,
        tipA = a0 + 0.12;
      c.globalAlpha = 0.5 + v * 0.5;
      c.beginPath();
      c.moveTo(cx, cy);
      c.quadraticCurveTo(
        cx + Math.cos(midA) * len * 0.55,
        cy + Math.sin(midA) * len * 0.55,
        cx + Math.cos(tipA) * len,
        cy + Math.sin(tipA) * len,
      );
      c.stroke();
    }
  } else if (style === 23) {
    // Hex pulse: a hexagon grid whose cells brighten with their mapped bin plus an outward ring wave.
    const cols = 9,
      rows = 5,
      spacingX = (w * 0.7) / cols,
      spacingY = (h * 0.28) / rows,
      originX = w * 0.15,
      originY = cy - h * 0.14;
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const x = originX + col * spacingX + (row % 2 ? spacingX / 2 : 0),
          y = originY + row * spacingY,
          v = values[(col * 5 + row * 3) % 64] * gain,
          dist = Math.hypot(x - cx, y - cy) / (h * 0.4),
          wave = Math.sin(dist * 6 - t * 3);
        c.globalAlpha = 0.15 + v * 0.6 + Math.max(0, wave) * 0.15;
        c.beginPath();
        for (let k = 0; k <= 6; k++) {
          const a = (k / 6) * Math.PI * 2,
            hx = x + Math.cos(a) * spacingX * 0.42,
            hy = y + Math.sin(a) * spacingY * 0.9;
          k ? c.lineTo(hx, hy) : c.moveTo(hx, hy);
        }
        c.closePath();
        c.stroke();
      }
    }
  } else if (style === 24) {
    // Polar rose: a k-petal rose curve traced in one stroke, each lobe's reach set by its bin.
    const k = 5;
    c.beginPath();
    for (let i = 0; i <= 240; i++) {
      const u = i / 240,
        a = u * Math.PI * 2,
        v = values[Math.floor(u * 63)] * gain,
        radius = h * (0.05 + Math.abs(Math.cos(k * a + t * 0.3)) * (0.14 + v * 0.24));
      const x = cx + Math.cos(a) * radius,
        y = cy + Math.sin(a) * radius;
      i ? c.lineTo(x, y) : c.moveTo(x, y);
    }
    c.closePath();
    c.stroke();
  } else if (style === 25) {
    // Staircase: the spectrum drawn as one continuous stepped skyline instead of separate bars.
    const bars = 32,
      left = w * 0.1,
      span = w * 0.8,
      baseline = h * 0.72;
    c.beginPath();
    c.moveTo(left, baseline);
    for (let i = 0; i < bars; i++) {
      const v = values[i * 2] * gain,
        x0 = left + (i / bars) * span,
        x1 = left + ((i + 1) / bars) * span,
        y = baseline - h * (0.02 + v * 0.4);
      c.lineTo(x0, y);
      c.lineTo(x1, y);
    }
    c.lineTo(left + span, baseline);
    c.closePath();
    c.globalAlpha = 0.45;
    c.fill();
    c.globalAlpha = 1;
    c.stroke();
  } else if (style === 26) {
    // Liquid bubbles: fewer, larger drifting circles with a rim and an inner highlight.
    const bubbles = 14;
    for (let i = 0; i < bubbles; i++) {
      const v = values[(i * 5) % 64] * gain,
        phase = (i / bubbles + t * (0.18 + v * 0.25)) % 1,
        baseX = w * (0.1 + ((i * 0.37) % 1) * 0.8),
        x = baseX + Math.sin(t * 1.3 + i) * w * 0.02,
        y = h * (0.82 - phase * 0.65),
        radius = h * (0.012 + v * 0.03) * (0.5 + Math.sin(phase * Math.PI) * 0.5);
      c.globalAlpha = 0.25 + Math.sin(phase * Math.PI) * 0.55;
      c.beginPath();
      c.arc(x, y, radius, 0, Math.PI * 2);
      c.stroke();
      c.globalAlpha = 0.5;
      c.beginPath();
      c.arc(x - radius * 0.3, y - radius * 0.3, radius * 0.25, 0, Math.PI * 2);
      c.fill();
    }
  } else if (style === 27) {
    // Mesh web: nodes on a ring linked to their neighbour and near-opposite, edges glow with combined energy.
    const nodes = 16,
      radius = h * 0.24,
      pts = [];
    for (let i = 0; i < nodes; i++) {
      const v = values[i * 4] * gain,
        a = (i / nodes) * Math.PI * 2 + t * 0.1,
        r = radius * (0.7 + v * 0.5);
      pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r, v]);
    }
    for (let i = 0; i < nodes; i++) {
      const [x0, y0, v0] = pts[i];
      for (const step of [1, nodes / 2]) {
        const [x1, y1, v1] = pts[(i + step) % nodes];
        c.globalAlpha = 0.12 + (v0 + v1) * 0.35;
        c.beginPath();
        c.moveTo(x0, y0);
        c.lineTo(x1, y1);
        c.stroke();
      }
      c.globalAlpha = 0.6 + v0 * 0.4;
      c.beginPath();
      c.arc(x0, y0, h * (0.003 + v0 * 0.006), 0, Math.PI * 2);
      c.fill();
    }
  } else if (style === 28) {
    // Aurora curtain: vertical ribbons of light that sway sideways and stretch with the spectrum.
    const bands = 4,
      cols = 48;
    for (let band = 0; band < bands; band++) {
      const yTop = h * (0.12 + band * 0.045),
        xAt = u =>
          w * (0.08 + u * 0.84) +
          Math.sin(u * Math.PI * 2.5 + t * (0.6 + band * 0.2) + band * 1.7) * w * 0.025;
      c.globalAlpha = 0.22 - band * 0.03;
      c.beginPath();
      for (let i = 0; i <= cols; i++) {
        const u = i / cols,
          v = values[Math.floor(u * 63)] * gain,
          y = yTop + h * (0.08 + v * 0.4);
        i ? c.lineTo(xAt(u), y) : c.moveTo(xAt(u), y);
      }
      for (let i = cols; i >= 0; i--) c.lineTo(xAt(i / cols), yTop);
      c.closePath();
      c.fill();
    }
  } else if (style === 29) {
    // ECG pulse: a heartbeat trace whose spike height tracks overall energy.
    const points = 200,
      left = w * 0.08,
      span = w * 0.84;
    c.beginPath();
    for (let i = 0; i <= points; i++) {
      const u = i / points,
        phase = (u + t * 0.15) % 1,
        y = cy - ecgPulse(phase) * h * (0.16 + energy * gain * 0.32),
        x = left + u * span;
      i ? c.lineTo(x, y) : c.moveTo(x, y);
    }
    c.stroke();
  } else if (style === 30) {
    // Kaleidoscope: a jagged fragment repeated with mirrored radial symmetry around the centre.
    const segments = 8;
    for (let seg = 0; seg < segments; seg++) {
      c.save();
      c.translate(cx, cy);
      c.rotate((seg / segments) * Math.PI * 2 + t * 0.2);
      if (seg % 2) c.scale(1, -1);
      c.beginPath();
      c.moveTo(0, 0);
      for (let i = 0; i < 8; i++) {
        const v = values[(seg * 8 + i) % 64] * gain,
          a = (i / 8) * (Math.PI / segments),
          r = h * (0.05 + v * 0.32);
        c.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      c.closePath();
      c.globalAlpha = 0.35;
      c.fill();
      c.globalAlpha = 1;
      c.stroke();
      c.restore();
    }
  } else if (style === 31) {
    // Bottom-edge dual bar clusters with a global cyan-to-magenta hue gradient.
    c.shadowBlur = h * 0.012;
    const barCount = 28,
      gapRatio = 0.28,
      clusterWidth = w * 0.34,
      barSlot = clusterWidth / barCount,
      barW = barSlot * (1 - gapRatio),
      maxBar = h * 0.36;
    const drawBar = (x, v) => {
      const bar = Math.max(h * 0.006, v * gain * maxBar);
      const hue = 185 + (x / w) * 110;
      const color = `hsl(${hue}, 92%, 62%)`;
      c.shadowColor = color;
      c.fillStyle = color;
      c.fillRect(x, h - bar, barW, bar);
    };
    for (let i = 0; i < barCount; i++) {
      drawBar(i * barSlot, values[i % 64]);
      drawBar(w - clusterWidth + i * barSlot, values[(63 - i) % 64]);
    }
  }
  c.globalAlpha = 1;
}

// Derive extraction and rotation from media time for pause, seek and export parity.
export function vinylPose(time) {
  const progress = Math.max(0, Math.min(1, time / 2));
  return {
    slide: progress * progress * (3 - 2 * progress),
    angle: Math.max(0, time - 2) * Math.PI * 2 * (33 + 1 / 3) / 60,
  };
}

function drawVinyl(c, w, h, time, values, gain, image, color, recordImage) {
  const { slide, angle } = vinylPose(time);
  const cy = h * .47, size = h * .42, radius = h * .20;
  const sleeveX = w / 2 - h * .46, sleeveY = cy - size / 2;
  const discX = sleeveX + size / 2 + h * .48 * slide;
  const energy = values.reduce((sum, value) => sum + value, 0) / values.length;
  c.save();
  c.shadowColor = "#000000";
  c.shadowBlur = h * .025;
  c.fillStyle = "#08090b";
  c.beginPath();
  c.arc(discX, cy, radius, 0, Math.PI * 2);
  c.fill();
  c.shadowBlur = 0;
  c.save();
  c.translate(discX, cy);
  c.rotate(angle);
  // Fine grooves and asymmetric highlights make clockwise rotation visible.
  for (let groove = 0; groove < 30; groove++) {
    c.strokeStyle = groove % 3 ? "#25272b" : "#41434a";
    c.lineWidth = h * .0008;
    c.beginPath();
    c.arc(0, 0, radius * (.36 + groove * .021), 0, Math.PI * 2);
    c.stroke();
  }
  c.lineWidth = radius * .46;
  c.strokeStyle = "#ffffff12";
  for (const start of [.2, 3.5]) {
    c.beginPath();
    c.arc(0, 0, radius * .7, start, start + .4);
    c.stroke();
  }
  c.fillStyle = color;
  c.beginPath();
  c.arc(0, 0, radius * .32, 0, Math.PI * 2);
  c.fill();
  if (recordImage) {
    c.save();
    c.beginPath();
    c.arc(0, 0, radius * .32, 0, Math.PI * 2);
    c.clip();
    const crop = Math.min(recordImage.width, recordImage.height);
    c.drawImage(recordImage, (recordImage.width - crop) / 2, (recordImage.height - crop) / 2, crop, crop, -radius * .32, -radius * .32, radius * .64, radius * .64);
    c.restore();
  }
  c.fillStyle = "#15171c";
  if (!recordImage) {
  c.fillRect(-radius * .18, -radius * .17, radius * .36, radius * .045);
  c.fillRect(-radius * .12, radius * .13, radius * .24, radius * .025);
  }
  c.beginPath();
  c.arc(0, 0, radius * .04, 0, Math.PI * 2);
  c.fill();
  c.restore();
  // Sleeve is painted last so the record emerges from its right edge.
  c.shadowColor = "#000000";
  c.shadowBlur = h * .018;
  c.fillStyle = "#20242b";
  c.fillRect(sleeveX, sleeveY, size, size);
  c.shadowBlur = 0;
  if (image) {
    const imageWidth = image.videoWidth || image.naturalWidth || image.displayWidth || image.width;
    const imageHeight = image.videoHeight || image.naturalHeight || image.displayHeight || image.height;
    if (typeof image.draw === "function") image.draw(c, sleeveX, sleeveY, size, size);
    else {
      const crop = Math.min(imageWidth, imageHeight);
      c.drawImage(image, (imageWidth - crop) / 2, (imageHeight - crop) / 2, crop, crop, sleeveX, sleeveY, size, size);
    }
  } else {
    c.fillStyle = color;
    c.globalAlpha = .18;
    c.fillRect(sleeveX, sleeveY, size, size);
    c.globalAlpha = 1;
    c.strokeStyle = color;
    c.lineWidth = h * .002;
    for (let ring = 1; ring <= 4; ring++) {
      c.beginPath();
      c.arc(sleeveX + size / 2, cy, size * ring * .085, 0, Math.PI * 2);
      c.stroke();
    }
  }
  c.fillStyle = "#ffffff18";
  c.fillRect(sleeveX, sleeveY, size * .025, size);
  c.fillStyle = "#00000055";
  c.fillRect(sleeveX + size * .975, sleeveY, size * .025, size);
  c.strokeStyle = color;
  c.globalAlpha = .3 + Math.min(.7, energy * gain);
  c.lineWidth = h * (.001 + energy * gain * .003);
  c.strokeRect(sleeveX, sleeveY, size, size);
  c.restore();
}

export function drawSubtitles(c, width, height, settings, time) {
  const text = subtitleAt(settings.subtitles, time + (settings.trimStart || 0), settings.originalBuffer?.duration || settings.buffer?.duration || 0, settings.subtitleTypewriter);
  if (!text) return;
  c.save();
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.globalAlpha = 1;
  const position = settings.subtitlePosition || "bottom";
  const margin = Math.max(0, Math.min(40, settings.subtitleMargin ?? 5)) / 100;
  const size = Math.min(width, height) * .035 * Math.max(100, Math.min(500, settings.subtitleSize ?? 100)) / 100;
  const padding = size * .3;
  const maxWidth = Math.max(size, width * (position === "left" || position === "right" ? 1 - margin - .05 : .9) - padding * 2);
  c.font = `600 ${size}px ${subtitleFontFamily(settings.subtitleFont)}`;
  c.textAlign = "center";
  c.textBaseline = "middle";
  const vertical = settings.subtitleDirection === "vertical";
  const lineHeight = size * 1.4;
  const lines = [];
  const rowLimit = Math.max(1, Math.floor((height * .8 - padding * 2) / lineHeight));
  for (const paragraph of text.split("\n")) {
    let line = "";
    for (const character of paragraph) {
      if (line && (vertical ? Array.from(line).length >= rowLimit : c.measureText(line + character).width > maxWidth)) { lines.push(line); line = ""; }
      line += character;
    }
    lines.push(line);
  }
  const visible = lines.slice(0, Math.max(1, Math.floor(((vertical ? width * .9 : height) - padding * 2) / lineHeight)));
  const boxWidth = vertical ? visible.length * lineHeight + padding * 2 : Math.min(width, Math.max(...visible.map(line=>c.measureText(line).width)) + padding * 2);
  const boxHeight = (vertical ? Math.max(...visible.map(line=>Array.from(line).length)) : visible.length) * lineHeight + padding * 2;
  let x = (width - boxWidth) / 2, y = (height - boxHeight) / 2;
  if (position === "left") x = width * margin;
  if (position === "right") x = width * (1 - margin) - boxWidth;
  if (position === "top") y = height * margin;
  if (position === "bottom") y = height * (1 - margin) - boxHeight;

  x = Math.max(0, Math.min(width - boxWidth, x));
  y = Math.max(0, Math.min(height - boxHeight, y));
  c.fillStyle = typeof settings.subtitleTextColor === "string" && /^#[0-9a-f]{6}$/i.test(settings.subtitleTextColor) ? settings.subtitleTextColor : "#ffffff";
  c.strokeStyle = typeof settings.subtitleOutlineColor === "string" && /^#[0-9a-f]{6}$/i.test(settings.subtitleOutlineColor) ? settings.subtitleOutlineColor : "#000000";
  c.lineWidth = size * .12;
  c.lineJoin = "round";
  c.shadowBlur = 0;
  const paintText = (...args) => { c.strokeText(...args); c.fillText(...args); };
  c.textAlign = position === "left" ? "left" : position === "right" ? "right" : "center";
  const textX = position === "left" ? x + padding : position === "right" ? x + boxWidth - padding : x + boxWidth / 2;
  if (vertical) {
    c.textAlign = "center";
    visible.forEach((line,column)=>Array.from(line).forEach((character,row)=> {
      paintText(character, x + boxWidth - padding - (column + .5) * lineHeight, y + padding + (row + .5) * lineHeight, lineHeight);
    }));
  } else visible.forEach((line,i)=>paintText(line,textX,y+padding+(i+.5)*lineHeight,maxWidth));
  c.restore();
}

export function drawIdentity(c, width, height, settings) {
  const image = settings.identityType === "image" ? settings.identityImage : null;
  const text = settings.identityType !== "image" ? settings.identityText?.trim() : "";
  if (!image && !text) return;
  c.save();
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.globalAlpha = Math.max(0, Math.min(100, settings.identityOpacity ?? 100)) / 100;
  const unit = Math.min(width, height);
  const size = unit * .03 * Math.max(50, Math.min(300, settings.identityTextSize ?? 100)) / 100;
  c.font = `600 ${size}px ${subtitleFontFamily(settings.identityFont)}`;
  const identityScale = Math.max(10, Math.min(300, settings.identityScale ?? 100)) / 100;
  const scale = image ? Math.min(unit * .16 / image.width, unit * .16 / image.height) * identityScale : 1;
  const w = image ? image.width * scale : Math.min(width * .8, c.measureText(text).width);
  const h = image ? image.height * scale : size * 1.4;
  const x = (width - w) * Math.max(0, Math.min(100, settings.identityX ?? 90)) / 100;
  const y = (height - h) * Math.max(0, Math.min(100, settings.identityY ?? 10)) / 100;
  if (image) c.drawImage(image, x, y, w, h);
  else {
    c.textAlign = "left";
    c.textBaseline = "middle";
    c.fillStyle = typeof settings.identityTextColor === "string" && /^#[0-9a-f]{6}$/i.test(settings.identityTextColor) ? settings.identityTextColor : "#ffffff";
    c.strokeStyle = typeof settings.identityOutlineColor === "string" && /^#[0-9a-f]{6}$/i.test(settings.identityOutlineColor) ? settings.identityOutlineColor : "#000000";
    c.lineWidth = size * .12;
    c.lineJoin = "round";
    c.strokeText(text, x, y + h / 2, width * .8);
    c.fillText(text, x, y + h / 2, width * .8);
  }
  c.restore();
}
