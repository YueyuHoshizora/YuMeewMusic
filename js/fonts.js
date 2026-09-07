// Local fonts only. Missing fonts fall back without downloading any resources.
export const SUBTITLE_FONTS = Object.freeze({
  system: 'system-ui, sans-serif',
  jasonRounded: '"YuMeew Jason Handwriting Rounded", "Microsoft JhengHei", sans-serif',
  jhenghei: '"Microsoft JhengHei", "PingFang TC", sans-serif',
  pingfang: '"PingFang TC", "Microsoft JhengHei", sans-serif',
  notoSans: '"Noto Sans TC", "Noto Sans CJK TC", sans-serif',
  notoSerif: '"Noto Serif TC", "Noto Serif CJK TC", serif',
  mingliu: '"PMingLiU", "MingLiU", "Songti TC", serif',
  kai: '"DFKai-SB", "BiauKai", "Kaiti TC", serif',
  arial: 'Arial, sans-serif',
  times: '"Times New Roman", serif',
  courier: '"Courier New", monospace',
});
export function subtitleFontFamily(key) {
  return Object.hasOwn(SUBTITLE_FONTS, key) ? SUBTITLE_FONTS[key] : SUBTITLE_FONTS.system;
}
