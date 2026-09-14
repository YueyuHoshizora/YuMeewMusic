const SCENE_HEADER = /^Scene\s+(\d+)\s*$/gmu;
const STORYBOARD_FIELDS = new Set(["時間", "場景", "鏡頭", "視角", "燈光", "音效", "動作", "人物與對話"]);

function sectionText(text, label) {
  const marker = `${label}：\n`;
  const start = text.indexOf(marker);
  if (start < 0) return "";
  const contentStart = start + marker.length;
  const rest = text.slice(contentStart);
  const next = rest.search(/\n\n(?:全片風格|人物設定|影片細節|分鏡內容|引用資源)：\n/u);
  return (next < 0 ? rest : rest.slice(0, next)).trim();
}

function parseSceneFields(content) {
  const fields = {};
  let active = "";
  for (const line of content.replace(/\r\n?/gu, "\n").split("\n")) {
    const match = line.match(/^([^：\n]+)：\s*(.*)$/u);
    if (match && STORYBOARD_FIELDS.has(match[1].trim())) {
      active = match[1].trim();
      fields[active] = match[2].trim();
      continue;
    }
    if (!line.trim()) continue;
    if (!active) return null;
    fields[active] = `${fields[active]}\n${line.trim()}`.trim();
  }
  const time = String(fields["時間"] || "").match(/^(\d+(?:\.\d)?)\s*-\s*(\d+(?:\.\d)?)s$/u);
  if (!time || !fields["場景"]) return null;
  const start = Number(time[1]);
  const end = Number(time[2]);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) return null;
  return { start, end, fields };
}

export function parseStoryboardPrompt(input) {
  const text = String(input || "").replace(/\r\n?/gu, "\n").trim();
  if (!text) return null;
  const storyboardSection = sectionText(text, "分鏡內容");
  const source = storyboardSection || text;
  const headers = [...source.matchAll(SCENE_HEADER)];
  if (!headers.length) return null;
  const scenes = [];
  for (let index = 0; index < headers.length; index += 1) {
    const header = headers[index];
    if (Number(header[1]) !== index + 1) return null;
    const start = header.index + header[0].length;
    const end = headers[index + 1]?.index ?? source.length;
    const scene = parseSceneFields(source.slice(start, end).trim());
    if (!scene) return null;
    scenes.push(scene);
  }
  return {
    scenes,
    videoDetails: sectionText(text, "影片細節"),
    filmStyle: sectionText(text, "全片風格"),
    characters: sectionText(text, "人物設定"),
  };
}

export function referencedResourceNames(text, names) {
  const source = String(text || "");
  return names.filter(name => {
    const escaped = String(name).replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    return new RegExp(`@${escaped}(?![\\p{L}\\p{N}_-])`, "u").test(source);
  });
}
