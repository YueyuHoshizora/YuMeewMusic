export function parseSubtitleTime(value) {
  const match = /^(?:(\d+):)?(\d+):([0-5]\d)(?:[.,](\d{1,3}))?$/.exec(value.trim());
  if (!match || (match[1] !== undefined && Number(match[2]) >= 60)) return NaN;
  return Number(match[1] || 0) * 3600 + Number(match[2]) * 60 + Number(match[3]) + Number(`0.${match[4] || '0'}`);
}
export function parseSubtitles(source, extension) {
  const text = source.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trim();
  if (!text) throw Error('字幕檔沒有文字內容。');
  if (extension === 'txt' && !text.includes('-->')) {
    const entries = [];
    for (const line of text.split('\n')) {
      const tagged = /^(?:\[[\d:.,]+\])+/.exec(line.trim());
      const plain = /^(\d+:\d{2}(?::\d{2})?(?:[.,]\d{1,3})?)\s+(.*)$/.exec(line.trim());
      if (tagged) {
        const content = line.trim().slice(tagged[0].length).trim();
        for (const [, stamp] of tagged[0].matchAll(/\[([^\]]+)\]/g)) {
          const start = parseSubtitleTime(stamp);
          if (Number.isFinite(start)) entries.push({start, text:content});
        }
      } else if (plain) {
        const start = parseSubtitleTime(plain[1]);
        if (Number.isFinite(start)) entries.push({start, text:plain[2].trim()});
      }
    }
    entries.sort((a,b)=>a.start-b.start);
    if (!entries.some(entry=>entry.text)) throw Error('TXT 找不到有效時間碼，請使用 [00:12.50] 字幕文字或 SRT 式起訖時間碼。');
    return {cues:entries.map(entry=>({
      ...entry,
      end:entries.find(next=>next.start > entry.start)?.start ?? Infinity,
    }))};
  }
  const cues = [];
  const add = (start, end, text) => {
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || !text.trim()) return;
    cues.push({start, end, text:text.trim()});
  };
  if (extension === 'srt' || extension === 'txt') {
    for (const block of text.split(/\n\s*\n/)) {
      const lines = block.split('\n');
      const index = lines.findIndex(line=>line.includes('-->'));
      if (index < 0) continue;
      const [start,end] = lines[index].split('-->');
      add(parseSubtitleTime(start), parseSubtitleTime(end.trim().split(/\s/)[0]), lines.slice(index+1).join('\n').replace(/<[^>]*>/g,''));
    }
  } else if (extension === 'ass') {
    let events = false, fields = [];
    for (const line of text.split('\n')) {
      if (/^\[/.test(line)) events = /^\[Events\]$/i.test(line.trim());
      if (!events) continue;
      if (/^Format:/i.test(line)) fields = line.slice(line.indexOf(':')+1).split(',').map(x=>x.trim().toLowerCase());
      if (!/^Dialogue:/i.test(line)) continue;
      if (!fields.length) fields = ['layer','start','end','style','name','marginl','marginr','marginv','effect','text'];
      const parts = line.slice(line.indexOf(':')+1).split(',');
      const textIndex = fields.indexOf('text');
      if (textIndex !== fields.length-1) throw Error('ASS 字幕的 Text 欄位必須位於最後。');
      const content = parts.slice(textIndex).join(',');
      // ASS drawing commands are not subtitle text.
      if (/\\p[1-9]/.test(content)) continue;
      add(parseSubtitleTime(parts[fields.indexOf('start')] || ''), parseSubtitleTime(parts[fields.indexOf('end')] || ''), content.replace(/\{[^}]*\}/g,'').replace(/\\[Nn]/g,'\n').replace(/\\h/g,' '));
    }
  } else throw Error('請選擇 SRT、ASS 或 TXT 字幕檔。');
  if (!cues.length) throw Error('找不到有效的字幕時間碼與文字。');
  return {cues:cues.sort((a,b)=>a.start-b.start)};
}

export function formatSubtitleTime(seconds, separator = '.', alwaysHours = false) {
  const totalMilliseconds = Math.max(0, Math.round(Number(seconds) * 1000));
  const milliseconds = totalMilliseconds % 1000;
  const totalSeconds = Math.floor(totalMilliseconds / 1000);
  const secs = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const minutes = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);
  const main = hours || alwaysHours
    ? `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
    : `${String(totalMinutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  return `${main}${separator}${String(milliseconds).padStart(3, '0')}`;
}

export function serializeSubtitles(data) {
  const cues = (Array.isArray(data?.cues) ? data.cues : [])
    .filter(cue => Number.isFinite(cue.start) && Number.isFinite(cue.end) && cue.end > cue.start && String(cue.text || '').trim())
    .sort((a, b) => a.start - b.start || a.end - b.end);
  return cues
    .map((cue, index) => `${index + 1}\n${formatSubtitleTime(cue.start, ',', true)} --> ${formatSubtitleTime(cue.end, ',', true)}\n${String(cue.text).trim()}`)
    .join('\n\n') + (cues.length ? '\n' : '');
}
const segmenter = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter(undefined, {granularity:'grapheme'}) : null;
export function subtitleCharacters(text) {
  return segmenter ? Array.from(segmenter.segment(text), part=>part.segment) : Array.from(text);
}
export function subtitleIndexAt(data, time) {
  if (!Array.isArray(data?.cues) || !Number.isFinite(time)) return -1;
  return data.cues.findIndex(cue => time >= cue.start && time < cue.end);
}
export function subtitleAt(data, time, duration, typewriter = false) {
  if (!data || time < 0 || time >= duration) return '';
  return data.cues.filter(cue=>time >= cue.start && time < cue.end) .map(cue=>{
    if (!typewriter) return cue.text;
    const characters = subtitleCharacters(cue.text);
    const span = Math.min(cue.end, duration) - cue.start;
    const count = Math.min(characters.length, 1 + Math.floor((time - cue.start) / span * characters.length));
    return characters.slice(0, count).join('');
  }).join('\n');
}
