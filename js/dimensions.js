export function videoDimensions(resolution, aspectRatio = "16:9") {
  const shortSide = Number(resolution);
  if (![720, 1080].includes(shortSide) || !["16:9", "9:16"].includes(aspectRatio))
    throw Error("無效的畫面比例或解析度。");
  const longSide = shortSide * 16 / 9;
  return aspectRatio === "9:16" ? { width: shortSide, height: longSide } : { width: longSide, height: shortSide };
}
