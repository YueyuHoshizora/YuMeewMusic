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
  const w = canvas.width,
    h = canvas.height;
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
    c.fillStyle = "#edf4e9";
    c.font = `500 ${h * 0.04}px sans-serif`;
    c.textAlign = "center";
    c.fillText("Y U M E E W", cx, cy);
    c.fillStyle = "#a3afa6";
    c.font = `${h * 0.015}px sans-serif`;
    c.fillText("S O U N D  I N  M O T I O N", cx, cy + h * 0.04);
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
}
