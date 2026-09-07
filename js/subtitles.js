function timestamp(value) {
  const match = /^(\d+):(\d{2}):(\d{2})[.,](\d{1,3})$/.exec(value.trim());
  return match && Number(match[2]) < 60 && Number(match[3]) < 60
    ? Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) + Number(`0.${match[4]}`) : NaN;
}
export function parseSubtitles(source, extension) {
  const text = source.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trim();
  if (!text) throw Error('字幕檔沒有文字內容。');
  if (extension === 'txt') return {lines:text.split('\n').map(line=>line.trim()).filter(Boolean)};
  const cues = [];
  const add = (start, end, text) => {
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || !text.trim()) return;
    cues.push({start, end, text:text.trim()});
  };
  if (extension === 'srt') {
    for (const block of text.split(/\n\s*\n/)) {
      const lines = block.split('\n');
      const index = lines.findIndex(line=>line.includes('-->'));
      if (index < 0) continue;
      const [start,end] = lines[index].split('-->');
      add(timestamp(start), timestamp(end.trim().split(/\s/)[0]), lines.slice(index+1).join('\n').replace(/<[^>]*>/g,''));
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
      add(timestamp(parts[fields.indexOf('start')] || ''), timestamp(parts[fields.indexOf('end')] || ''), content.replace(/\{[^}]*\}/g,'').replace(/\\[Nn]/g,'\n').replace(/\\h/g,' '));
    }
  } else throw Error('請選擇 SRT、ASS 或 TXT 字幕檔。');
  if (!cues.length) throw Error('找不到有效的字幕時間碼與文字。');
  return {cues:cues.sort((a,b)=>a.start-b.start)};
}
export function subtitleAt(data, time, duration) {
  if (!data || time < 0 || time >= duration) return '';
  if (data.lines) return data.lines[Math.min(data.lines.length-1, Math.floor(time/duration*data.lines.length))] || '';
  return data.cues.filter(cue=>time >= cue.start && time < cue.end).map(cue=>cue.text).join('\n');
}
