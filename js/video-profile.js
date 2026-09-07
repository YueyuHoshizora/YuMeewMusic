// Level follows the macroblock limits for this editor's 720p/1080p at 30/60 fps.
export function videoProfileConfig(profile = 'main', {width, height}, fps) {
  if (profile === 'auto') return {};
  const prefixes = {baseline:'42e0', main:'4d00', high:'6400'};
  if (!Object.hasOwn(prefixes, profile)) throw Error('無效的 H.264 Profile。');
  const blocks = Math.ceil(width/16) * Math.ceil(height/16);
  const levels = [[31,3600,108000],[32,5120,216000],[40,8192,245760],[42,8704,522240]];
  const level = levels.find(([,frame,second])=>blocks<=frame && blocks*fps<=second);
  if (!level) throw Error('此解析度與影格率超出支援範圍。');
  return {fullCodecString:`avc1.${prefixes[profile]}${level[0].toString(16).padStart(2,'0')}`};
}
