import { buildJpegPdf } from "./pdf-export.js";

const PAGE_WIDTH = 1240;
const PAGE_HEIGHT = 1754;
const MARGIN = 82;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const FONT_FAMILY = '-apple-system, BlinkMacSystemFont, "PingFang TC", "Microsoft JhengHei", sans-serif';

function canvasJpeg(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(async blob => {
      if (!blob) return reject(Error("瀏覽器無法建立 PDF 頁面。"));
      resolve({ width: canvas.width, height: canvas.height, bytes: new Uint8Array(await blob.arrayBuffer()) });
    }, "image/jpeg", 0.9);
  });
}

function wrapText(context, text, maxWidth) {
  const lines = [];
  for (const paragraph of String(text ?? "").split(/\r?\n/)) {
    if (!paragraph) {
      lines.push("");
      continue;
    }
    let line = "";
    for (const character of Array.from(paragraph)) {
      const candidate = line + character;
      if (line && context.measureText(candidate).width > maxWidth) {
        lines.push(line);
        line = character;
      } else line = candidate;
    }
    if (line) lines.push(line);
  }
  return lines;
}

function mediaElement(tag, file) {
  return new Promise((resolve, reject) => {
    const element = document.createElement(tag);
    const url = URL.createObjectURL(file);
    const cleanup = () => URL.revokeObjectURL(url);
    const timer = setTimeout(() => {
      cleanup();
      reject(Error("媒體預覽載入逾時。"));
    }, 10000);
    const done = () => {
      clearTimeout(timer);
      resolve({ element, cleanup });
    };
    element.onerror = () => {
      clearTimeout(timer);
      cleanup();
      reject(Error("媒體預覽無法載入。"));
    };
    if (tag === "video") {
      element.muted = true;
      element.preload = "auto";
      element.onloadeddata = done;
    } else element.onload = done;
    element.src = url;
  });
}

async function resourcePreview(resource) {
  if (!resource?.file || !["image", "video"].includes(resource.kind)) return null;
  const { element, cleanup } = await mediaElement(resource.kind === "video" ? "video" : "img", resource.file);
  try {
    const sourceWidth = element.videoWidth || element.naturalWidth;
    const sourceHeight = element.videoHeight || element.naturalHeight;
    if (!sourceWidth || !sourceHeight) return null;
    const canvas = document.createElement("canvas");
    canvas.width = 960;
    canvas.height = 540;
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.fillStyle = "#eef0f5";
    context.fillRect(0, 0, canvas.width, canvas.height);
    const scale = Math.min(canvas.width / sourceWidth, canvas.height / sourceHeight);
    const width = sourceWidth * scale;
    const height = sourceHeight * scale;
    context.drawImage(element, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height);
    return canvas;
  } finally {
    cleanup();
  }
}

export async function createStoryboardCardsPdf(project, generatedAt = new Date()) {
  if (!project?.scenes?.length) throw Error("請先加入至少一張分鏡卡。");
  await document.fonts?.ready;
  const pages = [];
  let canvas;
  let context;
  let y;

  const startPage = () => {
    canvas = document.createElement("canvas");
    canvas.width = PAGE_WIDTH;
    canvas.height = PAGE_HEIGHT;
    context = canvas.getContext("2d");
    if (!context) throw Error("瀏覽器無法建立 PDF 畫布。");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, PAGE_WIDTH, PAGE_HEIGHT);
    y = MARGIN;
    pages.push(canvas);
  };
  const ensureSpace = amount => {
    if (y + amount > PAGE_HEIGHT - MARGIN) startPage();
  };
  const write = (text, { size = 25, lineHeight = Math.round(size * 1.55), weight = 400, color = "#282a33", indent = 0, after = 8 } = {}) => {
    const font = `${weight} ${size}px ${FONT_FAMILY}`;
    context.font = font;
    const lines = wrapText(context, text, CONTENT_WIDTH - indent);
    for (const line of lines) {
      ensureSpace(lineHeight);
      context.font = font;
      context.fillStyle = color;
      context.fillText(line, MARGIN + indent, y + size);
      y += lineHeight;
    }
    y += after;
  };
  const sectionHeading = title => {
    ensureSpace(75);
    context.fillStyle = "#7651c8";
    context.fillRect(MARGIN, y, 8, 45);
    write(title, { size: 31, lineHeight: 45, weight: 800, color: "#5b35b1", indent: 24, after: 15 });
  };
  const mediaEntry = async (entry, details = []) => {
    ensureSpace((["image", "video"].includes(entry.kind) ? 760 : 250) + details.filter(([, value]) => value).length * 45);
    sectionHeading(entry.referenceName);
    for (const [label, value] of details) {
      if (value) write(`${label}：${value}`, { size: 22, color: "#4d5260", indent: 18, after: 4 });
    }
    if (entry.meta) write(entry.meta, { size: 21, color: "#666b78", after: 14 });
    let preview = null;
    try {
      preview = await resourcePreview(entry);
    } catch {
      preview = null;
    }
    if (preview) {
      const height = Math.round(CONTENT_WIDTH * preview.height / preview.width);
      ensureSpace(height + 28);
      context.drawImage(preview, MARGIN, y, CONTENT_WIDTH, height);
      y += height + 28;
    } else {
      ensureSpace(130);
      context.fillStyle = "#f1eef9";
      context.fillRect(MARGIN, y, CONTENT_WIDTH, 105);
      context.fillStyle = "#5b35b1";
      context.font = `700 25px ${FONT_FAMILY}`;
      context.fillText(entry.kind === "audio" ? "音效資源" : "此格式無法產生預覽", MARGIN + 28, y + 63);
      y += 133;
    }
  };

  startPage();
  write("影片分鏡表", { size: 48, lineHeight: 65, weight: 800, color: "#5b35b1", after: 6 });
  write(new Intl.DateTimeFormat("zh-TW", { dateStyle: "long", timeStyle: "medium" }).format(generatedAt), { size: 20, color: "#747986", after: 30 });
  for (const scene of project.scenes) {
    sectionHeading(scene.title);
    if (scene.summary) write(scene.summary, { size: 27, weight: 700, color: "#343743", after: 12 });
    for (const [label, value] of scene.fields || []) {
      if (!value) continue;
      write(`${label}：${value}`, { indent: 18, after: 5 });
    }
    y += 18;
  }

  if (project.characters?.length) {
    startPage();
    write("引用人物", { size: 45, lineHeight: 62, weight: 800, color: "#5b35b1", after: 20 });
    for (const character of project.characters) {
      await mediaEntry(character, [
        ["聲線", character.voice],
        ["口氣", character.tone],
        ["風格", character.style],
        ["服裝", character.clothing],
      ]);
    }
  }

  if (project.resources?.length) {
    startPage();
    write("引用資源", { size: 45, lineHeight: 62, weight: 800, color: "#5b35b1", after: 20 });
    for (const resource of project.resources) {
      await mediaEntry(resource);
    }
  }

  pages.forEach((page, index) => {
    const pageContext = page.getContext("2d");
    pageContext.font = `20px ${FONT_FAMILY}`;
    pageContext.fillStyle = "#8a8f9b";
    pageContext.textAlign = "right";
    pageContext.fillText(`${index + 1} / ${pages.length}`, PAGE_WIDTH - MARGIN, PAGE_HEIGHT - 34);
  });
  return buildJpegPdf(await Promise.all(pages.map(canvasJpeg)));
}
