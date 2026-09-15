export const IMAGE_RATIOS = Object.freeze({
  "1:1": [1, 1],
  "4:3": [4, 3],
  "3:4": [3, 4],
  "16:9": [16, 9],
  "9:16": [9, 16],
});

export const IMAGE_WIDTHS = Object.freeze([480, 512, 640, 720, 768, 1024, 1280, 1080, 1920]);

export function calculateImageSize(ratio, width) {
  const normalizedRatio = IMAGE_RATIOS[ratio] ? ratio : "16:9";
  const numericWidth = Number(width);
  const normalizedWidth = IMAGE_WIDTHS.includes(numericWidth) ? numericWidth : 1280;
  const [horizontal, vertical] = IMAGE_RATIOS[normalizedRatio];
  return {
    ratio: normalizedRatio,
    width: normalizedWidth,
    height: Math.round(normalizedWidth * vertical / horizontal),
  };
}

const MAX_GENERATION_DIMENSION = 2000;

export function imageResolutionsForRatio(ratio) {
  const [horizontal, vertical] = IMAGE_RATIOS[ratio] || IMAGE_RATIOS["16:9"];
  return [...IMAGE_WIDTHS]
    .sort((a, b) => a - b)
    .map(width => ({ width, height: Math.round(width * vertical / horizontal) }))
    .filter(({ width, height }) => width < MAX_GENERATION_DIMENSION && height < MAX_GENERATION_DIMENSION);
}
