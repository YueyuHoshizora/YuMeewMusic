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
export function draw(canvas, t, b, img, s) {
  const c = canvas.getContext("2d");
  const w = canvas.width;
  let h = canvas.height;
  c.fillStyle = "#0c1112";
  c.fillRect(0, 0, w, h);
  if (img) {
    const scale = Math.max(w / img.width, h / img.height);
    c.drawImage(
      img,
      (w - img.width * scale) / 2,
      (h - img.height * scale) / 2,
      img.width * scale,
      img.height * scale,
    );
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
  c.fillStyle = `rgba(0,0,0,${(s.darkness / 100) * 0.85})`;
  c.fillRect(0, 0, w, h);
  // Translate only the visualizer, after painting the fixed background.
  c.save();
  const position = key => Number.isFinite(s[key]) ? Math.max(-50, Math.min(50, s[key])) : 0;
  c.translate(w * position("positionX") / 100, h * position("positionY") / 100);
  // Keep circular and radial styles within the narrow side of portrait frames.
  c.translate(0, (h - Math.min(w, h)) / 2);
  h = Math.min(w, h);
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
    drawVinyl(c, w, h, t, values, gain, img, s.color);
  } else if (s.style >= 6) {
    drawExtra(c, w, h, t, values, gain, s.style);
  } else if (s.style === 3) {
    c.beginPath();
    for (let i = 0; i < 256; i++) {
      const x = w * 0.12 + (i / 255) * w * 0.76;
      const v = values[i % 64];
      const y = cy + Math.sin(i * 0.15 + t * 2) * v * h * 0.18 * gain;
      i ? c.lineTo(x, y) : c.moveTo(x, y);
    }
    c.stroke();
  } else {
    for (let i = 0; i < 64; i++) {
      const x = w * 0.13 + (i / 64) * w * 0.74,
        v = values[i] * gain,
        bar = Math.max(3, v * h * 0.3);
      if (s.style === 5) {
        for (let j = 0; j < 12; j++) {
          c.globalAlpha = j / 12 < v ? 1 : 0.12;
          c.beginPath();
          c.arc(x, h * 0.68 - j * h * 0.029, h * 0.004, 0, Math.PI * 2);
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
  drawSongDetails(c, canvas.width, canvas.height, s);
}

function drawSongDetails(c, width, height, settings) {
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
  c.globalAlpha = 1;
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

function drawVinyl(c, w, h, time, values, gain, image, color) {
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
  c.fillStyle = "#15171c";
  c.fillRect(-radius * .18, -radius * .17, radius * .36, radius * .045);
  c.fillRect(-radius * .12, radius * .13, radius * .24, radius * .025);
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
    const crop = Math.min(image.width, image.height);
    c.drawImage(image, (image.width - crop) / 2, (image.height - crop) / 2, crop, crop, sleeveX, sleeveY, size, size);
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
