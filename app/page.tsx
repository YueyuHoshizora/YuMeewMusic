'use client';
import { useEffect, useRef, useState } from 'react';
import {
  AudioLines,
  ImagePlus,
  Music2,
  Play,
  Pause,
  Download,
  Check,
  ArrowUpRight,
  RotateCcw,
  SlidersHorizontal,
} from 'lucide-react';
import { Slider } from '@/components/ui/slider';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
const styles = [
  '環形脈衝',
  '經典音柱',
  '鏡像頻譜',
  '流動波形',
  '放射光芒',
  '點陣節奏',
];
const colors = ['#c5fa75', '#a99bff', '#61dcff', '#ff9caf', '#ffffff'];
export default function Home() {
  const [style, setStyle] = useState(0),
    [color, setColor] = useState(colors[0]),
    [strength, setStrength] = useState(70),
    [darkness, setDarkness] = useState(45),
    [res, setRes] = useState('1080'),
    [fps, setFps] = useState('30');
  const [name, setName] = useState(''),
    [imageName, setImageName] = useState(''),
    [playing, setPlaying] = useState(false),
    [duration, setDuration] = useState(0),
    [time, setTime] = useState(0),
    [busy, setBusy] = useState(false),
    [progress, setProgress] = useState(0),
    [message, setMessage] = useState(''),
    [loading, setLoading] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null),
    audio = useRef<HTMLAudioElement>(null),
    buffer = useRef<AudioBuffer | null>(null),
    photo = useRef<HTMLImageElement | null>(null),
    url = useRef(''),
    cancel = useRef(false),
    audioInput = useRef<HTMLInputElement>(null),
    imageInput = useRef<HTMLInputElement>(null);
  const settings = useRef({ style, color, strength, darkness });
  settings.current = { style, color, strength, darkness };
  useEffect(() => {
    let id = 0;
    const loop = () => {
      if (canvas.current) {
        const t = audio.current?.currentTime || 0;
        draw(
          canvas.current,
          t,
          buffer.current,
          photo.current,
          settings.current,
        );
        if (audio.current && !audio.current.paused) setTime(t);
      }
      id = requestAnimationFrame(loop);
    };
    loop();
    return () => {
      cancelAnimationFrame(id);
      URL.revokeObjectURL(url.current);
    };
  }, []);
  useEffect(() => {
    const context = (
      document as Document & {
        modelContext?: {
          registerTool: (
            tool: unknown,
            options: { signal: AbortSignal },
          ) => void;
        };
      }
    ).modelContext;
    if (!context) return;
    const lifecycle = new AbortController();
    try {
      context.registerTool(
        {
          name: 'configure_visualizer',
          description:
            'Set the visible spectrum style, resolution and frame rate before exporting.',
          inputSchema: {
            type: 'object',
            properties: {
              style: { type: 'integer', minimum: 0, maximum: 5 },
              resolution: { type: 'string', enum: ['720', '1080'] },
              fps: { type: 'string', enum: ['30', '60'] },
            },
            required: ['style', 'resolution', 'fps'],
            additionalProperties: false,
          },
          annotations: { readOnlyHint: false },
          execute: async (input: unknown) => {
            const v = input as {
              style: number;
              resolution: string;
              fps: string;
            };
            if (busy) throw Error('Export in progress');
            if (
              !v ||
              !Number.isInteger(v.style) ||
              v.style < 0 ||
              v.style > 5 ||
              !['720', '1080'].includes(v.resolution) ||
              !['30', '60'].includes(v.fps)
            )
              throw Error('Invalid settings');
            setStyle(v.style);
            setRes(v.resolution);
            setFps(v.fps);
            await new Promise((r) => requestAnimationFrame(r));
            return v;
          },
        },
        { signal: lifecycle.signal },
      );
    } catch {}
    return () => lifecycle.abort();
  }, [busy]);
  async function loadAudio(file?: File) {
    if (!file || busy) return;
    setLoading(true);
    setMessage('');
    const ctx = new AudioContext();
    try {
      if (file.size > 150 * 1024 * 1024) throw Error('音樂檔案請小於 150 MB。');
      const decoded = await ctx.decodeAudioData(await file.arrayBuffer());
      if (decoded.duration > 1200) throw Error('請選擇 20 分鐘以內的音樂。');
      audio.current?.pause();
      URL.revokeObjectURL(url.current);
      url.current = URL.createObjectURL(file);
      buffer.current = decoded;
      if (audio.current) audio.current.src = url.current;
      setName(file.name);
      setDuration(decoded.duration);
      setTime(0);
      setPlaying(false);
    } catch (e) {
      setMessage(
        e instanceof Error ? e.message : '無法讀取音樂，請嘗試 MP3 或 WAV。',
      );
    } finally {
      await ctx.close();
      setLoading(false);
    }
  }
  async function loadImage(file?: File) {
    if (!file || busy) return;
    setMessage('');
    if (file.size > 30 * 1024 * 1024) {
      setMessage('圖片請小於 30 MB。');
      return;
    }
    const u = URL.createObjectURL(file),
      im = new Image();
    im.onload = () => {
      photo.current = im;
      setImageName(file.name);
      URL.revokeObjectURL(u);
    };
    im.onerror = () => {
      URL.revokeObjectURL(u);
      setMessage('無法讀取圖片，請選擇 JPG、PNG 或 WebP。');
    };
    im.src = u;
  }
  async function toggle() {
    if (!buffer.current || !audio.current) return;
    try {
      if (playing) audio.current.pause();
      else await audio.current.play();
      setPlaying(!playing);
    } catch {
      setMessage('播放失敗，請重新載入音樂。');
    }
  }
  async function exportVideo() {
    if (!buffer.current || busy) return;
    setBusy(true);
    setProgress(0);
    setMessage('');
    cancel.current = false;
    audio.current?.pause();
    setPlaying(false);
    let output: import('mediabunny').Output | undefined;
    try {
      const m = await import('mediabunny');
      const h = Number(res),
        rate = Number(fps);
      if (
        !(await m.canEncodeVideo('avc', { width: (h * 16) / 9, height: h })) ||
        !(await m.canEncodeAudio('aac', {
          numberOfChannels: buffer.current.numberOfChannels,
          sampleRate: buffer.current.sampleRate,
        }))
      )
        throw Error(
          '此瀏覽器無法編碼 H.264／AAC，請使用最新版 Chrome 或 Edge 再試。',
        );
      const c = document.createElement('canvas');
      c.width = (h * 16) / 9;
      c.height = h;
      const target = new m.BufferTarget();
      output = new m.Output({ format: new m.Mp4OutputFormat(), target });
      const video = new m.CanvasSource(c, {
        codec: 'avc',
        bitrate: h === 1080 ? 8_000_000 : 4_000_000,
      });
      const sound = new m.AudioBufferSource({ codec: 'aac', bitrate: 192_000 });
      output.addVideoTrack(video, { frameRate: rate });
      output.addAudioTrack(sound);
      await output.start();
      const b = buffer.current,
        snapshot = { ...settings.current },
        img = photo.current;
      const count = Math.ceil(b.duration * rate);
      for (let i = 0; i < count; i++) {
        if (cancel.current) throw Error('已取消匯出。');
        draw(c, i / rate, b, img, snapshot);
        await video.add(i / rate, Math.min(1 / rate, b.duration - i / rate));
        if (i % 10 === 0) {
          setProgress(Math.round((i / count) * 90));
          await new Promise((r) => setTimeout(r, 0));
        }
      }
      video.close();
      if (cancel.current) throw Error('已取消匯出。');
      setProgress(92);
      await sound.add(b);
      sound.close();
      await output.finalize();
      const u = URL.createObjectURL(
        new Blob([target.buffer!], { type: 'video/mp4' }),
      );
      const a = document.createElement('a');
      a.href = u;
      a.download =
        (name.replace(/\.[^.]+$/, '') || 'yumeew') + `-${res}p-${fps}fps.mp4`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(u), 60000);
      setProgress(100);
      setMessage('MP4 已完成，下載已開始。');
    } catch (e) {
      if (output && output.state !== 'finalized' && output.state !== 'canceled')
        await output.cancel().catch(() => {});
      setMessage(
        e instanceof Error ? e.message : '匯出失敗，請降低解析度再試。',
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="studio">
      <header>
        <a className="brand" href="/" aria-label="YuMeew 首頁">
          <span className="brand-icon">
            <AudioLines size={23} />
          </span>
          YuMeew<span className="brand-sub">MUSIC STUDIO</span>
        </a>
        <span className="header-note">讓每一段聲音，都有畫面。</span>
        <span className="local">
          <i />
          本機安全處理
        </span>
      </header>
      <main>
        <div className="heading">
          <div>
            <div className="eyebrow">A LITTLE SOUND. A LOT OF FEELING.</div>
            <h1>
              你的音樂，視覺化<span>。</span>
            </h1>
            <p>加入音樂與圖片，創作屬於你的頻譜影片。</p>
          </div>
          <div className="step">
            01 素材 <span>／</span> 02 風格 <span>／</span> 03 匯出
          </div>
        </div>
        <div className="workspace">
          <aside className="panel assets">
            <div className="section-title">
              <span>01</span>
              <h2>創作素材</h2>
            </div>
            <label className="field-label">音樂</label>
            <button
              disabled={busy || loading}
              className={'upload ' + (name ? 'loaded' : '')}
              onClick={() => audioInput.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                void loadAudio(e.dataTransfer.files[0]);
              }}
            >
              <span className="upload-icon">
                <Music2 />
              </span>
              <strong>
                {loading ? '正在讀取音樂…' : name || '上傳你的音樂'}
              </strong>
              <small>
                {name ? `${format(duration)} · 點擊更換` : '拖放檔案或點擊選擇'}
              </small>
              <span className="filetype">MP3 · WAV · M4A · FLAC</span>
            </button>
            <input
              ref={audioInput}
              type="file"
              accept="audio/*"
              hidden
              onChange={(e) => {
                void loadAudio(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
            <label className="field-label">
              背景圖片 <span>選填</span>
            </label>
            <button
              disabled={busy}
              className="upload image-upload"
              onClick={() => imageInput.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                void loadImage(e.dataTransfer.files[0]);
              }}
            >
              <ImagePlus size={25} />
              <strong>{imageName || '加入背景圖片'}</strong>
              <small>JPG · PNG · WebP</small>
            </button>
            <input
              ref={imageInput}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              hidden
              onChange={(e) => {
                void loadImage(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
            {imageName && (
              <button
                className="text-button"
                disabled={busy}
                onClick={() => {
                  photo.current = null;
                  setImageName('');
                }}
              >
                移除圖片
              </button>
            )}
            <div className="privacy">
              <span>✳</span>
              <p>
                靈感留在畫面裡。
                <br />
                你的檔案留在裝置裡。
              </p>
            </div>
          </aside>
          <section className="center">
            <div className="preview-top">
              <span>
                <i /> 即時預覽
              </span>
              <span>
                16:9 <span className="separator">／</span> {res}p
              </span>
            </div>
            <div className="canvas-wrap">
              <canvas
                ref={canvas}
                width={1280}
                height={720}
                aria-label="音樂頻譜動畫預覽"
              />
              <span className="preview-tag">
                {name
                  ? 'YOUR SOUND, IN MOTION'
                  : 'DEMO VISUAL · 上傳音樂開始創作'}
              </span>
            </div>
            <div className="transport">
              <button
                className="play"
                aria-label={playing ? '暫停' : '播放'}
                disabled={!name || busy}
                onClick={toggle}
              >
                {playing ? <Pause size={18} /> : <Play size={18} />}
              </button>
              <span className="time">{format(time)}</span>
              <Slider
                aria-label="播放進度"
                min={0}
                max={duration || 1}
                step={0.1}
                value={[time]}
                disabled={!name || busy}
                onValueChange={(v) => {
                  const t = Array.isArray(v) ? v[0] : v;
                  setTime(t);
                  if (audio.current) audio.current.currentTime = t;
                }}
              />
              <span className="time muted">{format(duration)}</span>
              <button
                className="icon-button"
                aria-label="回到開頭"
                disabled={busy}
                onClick={() => {
                  if (audio.current) audio.current.currentTime = 0;
                  setTime(0);
                }}
              >
                <RotateCcw size={16} />
              </button>
            </div>
            <div className="styles-heading">
              <div className="section-title">
                <span>02</span>
                <h2>選一種節奏</h2>
              </div>
              <span>6 種頻譜風格</span>
            </div>
            <div className="styles">
              {styles.map((s, i) => (
                <button
                  disabled={busy}
                  className={'style-card ' + (style === i ? 'selected' : '')}
                  key={s}
                  onClick={() => setStyle(i)}
                  aria-pressed={style === i}
                >
                  <Mini index={i} />
                  <span>{s}</span>
                  {style === i && <Check className="check" size={14} />}
                </button>
              ))}
            </div>
          </section>
          <aside className="panel settings">
            <div className="section-title">
              <SlidersHorizontal size={17} />
              <h2>畫面設定</h2>
            </div>
            <label className="field-label">頻譜色彩</label>
            <div className="colors">
              {colors.map((c) => (
                <button
                  key={c}
                  aria-label={`選擇 ${c}`}
                  aria-pressed={color === c}
                  disabled={busy}
                  style={{ background: c }}
                  className={color === c ? 'active' : ''}
                  onClick={() => setColor(c)}
                >
                  {color === c && <Check size={17} />}
                </button>
              ))}
            </div>
            <div className="range-label">
              動態強度<span>{strength}%</span>
            </div>
            <Slider
              aria-label="動態強度"
              value={[strength]}
              disabled={busy}
              onValueChange={(v) => setStrength(Array.isArray(v) ? v[0] : v)}
            />
            <div className="range-label">
              背景暗度<span>{darkness}%</span>
            </div>
            <Slider
              aria-label="背景暗度"
              value={[darkness]}
              disabled={busy}
              onValueChange={(v) => setDarkness(Array.isArray(v) ? v[0] : v)}
            />
            <div className="export-section">
              <div className="section-title">
                <span>03</span>
                <h2>匯出影片</h2>
              </div>
              <label className="field-label" id="resolution-label">
                解析度
              </label>
              <Select
                value={res}
                disabled={busy}
                onValueChange={(v) => v && setRes(v)}
              >
                <SelectTrigger
                  aria-labelledby="resolution-label"
                  className="setting-select"
                >
                  <SelectValue>
                    {res === '1080' ? '1080p · Full HD' : '720p · HD'}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1080">1080p · Full HD</SelectItem>
                  <SelectItem value="720">720p · HD</SelectItem>
                </SelectContent>
              </Select>
              <label className="field-label" id="fps-label">
                影格率
              </label>
              <Select
                value={fps}
                disabled={busy}
                onValueChange={(v) => v && setFps(v)}
              >
                <SelectTrigger
                  aria-labelledby="fps-label"
                  className="setting-select"
                >
                  <SelectValue>{fps} fps</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="30">30 fps</SelectItem>
                  <SelectItem value="60">60 fps</SelectItem>
                </SelectContent>
              </Select>
              <div className="format-row">
                <span>輸出格式</span>
                <strong>
                  MP4 <span>H.264 / AAC</span>
                </strong>
              </div>
              <button
                className="export-button"
                disabled={!name || busy || loading}
                onClick={exportVideo}
              >
                <Download size={18} />
                {busy ? `正在匯出 ${progress}%` : '匯出 MP4'}
                {!busy && <ArrowUpRight size={17} />}
              </button>
              {busy && (
                <>
                  <progress value={progress} max={100} aria-label="匯出進度" />
                  <button
                    className="text-button"
                    onClick={() => {
                      cancel.current = true;
                    }}
                  >
                    取消匯出
                  </button>
                </>
              )}
              <p className="export-note">
                {name
                  ? '匯出期間請保持此頁面開啟。'
                  : '先上傳音樂，就能匯出影片。'}
              </p>
            </div>
          </aside>
        </div>
        {message && (
          <div className="message" role="status">
            {message}
            <button aria-label="關閉訊息" onClick={() => setMessage('')}>
              ×
            </button>
          </div>
        )}
        <footer>
          <span>MADE FOR YOUR SOUND.</span>
          <span>音樂上限 20 分鐘 / 150 MB · 圖片上限 30 MB</span>
        </footer>
      </main>
      <audio ref={audio} onEnded={() => setPlaying(false)} />
    </div>
  );
}
function format(t: number) {
  return `${Math.floor(t / 60)
    .toString()
    .padStart(2, '0')}:${Math.floor(t % 60)
    .toString()
    .padStart(2, '0')}`;
}
function Mini({ index }: { index: number }) {
  return (
    <svg viewBox="0 0 150 65" aria-hidden="true">
      {Array.from({ length: 32 }, (_, i) => {
        const a = (i / 32) * Math.PI * 2,
          h = 4 + Math.abs(Math.sin(i * 1.8)) * 18;
        return index === 0 || index === 4 ? (
          <line
            key={i}
            x1={75 + Math.cos(a) * 17}
            y1={32 + Math.sin(a) * 17}
            x2={75 + Math.cos(a) * (index === 0 ? 20 + h * 0.25 : 19 + h * 0.6)}
            y2={32 + Math.sin(a) * (index === 0 ? 20 + h * 0.25 : 19 + h * 0.6)}
            stroke="currentColor"
            strokeWidth="1.8"
          />
        ) : index === 5 ? (
          <circle
            key={i}
            cx={17 + (i % 16) * 7.5}
            cy={23 + Math.floor(i / 16) * 18}
            r={1 + h / 10}
            fill="currentColor"
          />
        ) : (
          <line
            key={i}
            x1={14 + i * 4}
            y1={index === 2 ? 32 - h / 2 : 48 - h}
            x2={14 + i * 4}
            y2={index === 2 ? 32 + h / 2 : index === 3 ? 48 - h + 3 : 48}
            stroke="currentColor"
            strokeWidth="2"
          />
        );
      })}
    </svg>
  );
}
type Settings = {
  style: number;
  color: string;
  strength: number;
  darkness: number;
};
function spectrum(b: AudioBuffer | null, t: number) {
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
    re[i] =
      (data[start + i] || 0) *
      (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1)));
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
function draw(
  canvas: HTMLCanvasElement,
  t: number,
  b: AudioBuffer | null,
  img: HTMLImageElement | null,
  s: Settings,
) {
  const c = canvas.getContext('2d')!;
  const w = canvas.width,
    h = canvas.height;
  c.fillStyle = '#0c1112';
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
    const g = c.createRadialGradient(
      w * 0.5,
      h * 0.45,
      0,
      w * 0.5,
      h * 0.5,
      w * 0.65,
    );
    g.addColorStop(0, '#26302b');
    g.addColorStop(1, '#080c0d');
    c.fillStyle = g;
    c.fillRect(0, 0, w, h);
    c.strokeStyle = '#ffffff06';
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
  c.lineCap = 'round';
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
    c.strokeStyle = s.color + '35';
    c.beginPath();
    c.arc(cx, cy, r * 0.9, 0, Math.PI * 2);
    c.stroke();
    c.fillStyle = '#edf4e9';
    c.font = `500 ${h * 0.04}px sans-serif`;
    c.textAlign = 'center';
    c.fillText('Y U M E E W', cx, cy);
    c.fillStyle = '#a3afa6';
    c.font = `${h * 0.015}px sans-serif`;
    c.fillText('S O U N D  I N  M O T I O N', cx, cy + h * 0.04);
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
        c.fillRect(
          x,
          s.style === 2 ? cy - bar / 2 : h * 0.65 - bar,
          w * 0.006,
          bar,
        );
      }
    }
  }
  c.shadowBlur = 0;
}
