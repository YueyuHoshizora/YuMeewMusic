export function roundUpCurrency(value, decimals = 2) {
  const factor = 10 ** decimals;
  return Math.ceil((Number(value) - Number.EPSILON) * factor) / factor;
}

export function hasSufficientVideoCredit(balance, requiredCost) {
  const available = Number(balance);
  const required = Number(requiredCost);
  if (!Number.isFinite(available) || !Number.isFinite(required) || available < 0 || required < 0) return false;
  const availableCents = Math.floor((available + Number.EPSILON) * 100);
  const requiredCents = Math.ceil((required - Number.EPSILON) * 100);
  return availableCents >= requiredCents;
}

function resourceCounts(resources = []) {
  return resources.reduce((counts, resource) => {
    if (Object.hasOwn(counts, resource?.kind)) counts[resource.kind] += 1;
    return counts;
  }, { image: 0, audio: 0, video: 0 });
}

export function estimateVideoGenerationCost({ billingId, resolution, duration, includeAudio = true, resources = [] }, settings) {
  const seconds = Math.max(0, Number(duration) || 0);
  if (billingId === "minimax-h3") {
    const is2k = String(resolution).toLowerCase() === "2k";
    const outputRate = Number(settings[is2k ? "output2kPerSecond" : "output768PerSecond"]);
    if (!Number.isFinite(outputRate)) throw Error("計費設定缺少影片每秒費率。");
    const counts = resourceCounts(resources);
    const imageCost = Math.max(0, counts.image - Number(settings.imageFreeCount || 0)) * Number(settings.imageOveragePerItem || 0);
    const audioCost = Math.max(0, counts.audio - Number(settings.audioFreeCount || 0)) * Number(settings.audioOveragePerItem || 0);
    const videoCost = Math.max(0, counts.video - Number(settings[is2k ? "video2kFreeCount" : "video768FreeCount"] || 0))
      * Number(settings[is2k ? "video2kOveragePerItem" : "video768OveragePerItem"] || 0);
    const outputCost = outputRate * seconds;
    return { total: outputCost + imageCost + audioCost + videoCost, outputCost, resourceCost: imageCost + audioCost + videoCost };
  }
  if (billingId === "seedance-2-0" || billingId === "seedance-2-5") {
    const resolutionKey = { "480p": "multiplier480", "720p": "multiplier720", "1080p": "multiplier1080", "4k": "multiplier4k" }[String(resolution).toLowerCase()];
    const baseRate = Number(settings.basePerSecond);
    const multiplier = Number(settings[resolutionKey]);
    if (!Number.isFinite(baseRate) || !Number.isFinite(multiplier)) throw Error("計費設定缺少解析度倍率。");
    const unitRate = roundUpCurrency(baseRate * multiplier, Number(settings.roundUpDecimals) || 2);
    return { total: unitRate * seconds, outputCost: unitRate * seconds, resourceCost: 0, unitRate };
  }
  if (billingId === "veo-3-1") {
    const size = String(resolution).toLowerCase() === "1080p" ? "1080" : "720";
    const rate = Number(settings[`${includeAudio ? "audio" : "silent"}${size}PerSecond`]);
    if (!Number.isFinite(rate)) throw Error("計費設定缺少 Veo 每秒費率。");
    return { total: rate * seconds, outputCost: rate * seconds, resourceCost: 0, unitRate: rate };
  }
  throw Error("目前模型沒有可用的計費規則。");
}
