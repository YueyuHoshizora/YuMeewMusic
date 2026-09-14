const encoder = new TextEncoder();
const A4_WIDTH = 595.28;
const A4_HEIGHT = 841.89;

function textBytes(value) {
  return encoder.encode(value);
}

function joinBytes(chunks) {
  const size = chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
  const output = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

export function buildJpegPdf(pages) {
  if (!Array.isArray(pages) || !pages.length) throw Error("PDF 至少需要一頁內容。");
  const objects = new Map();
  const pageIds = pages.map((_, index) => 3 + index * 3);
  objects.set(1, textBytes("<< /Type /Catalog /Pages 2 0 R >>"));
  objects.set(2, textBytes(`<< /Type /Pages /Count ${pages.length} /Kids [${pageIds.map(id => `${id} 0 R`).join(" ")}] >>`));

  pages.forEach((page, index) => {
    const pageId = pageIds[index];
    const contentId = pageId + 1;
    const imageId = pageId + 2;
    const imageName = `Im${index + 1}`;
    const content = textBytes(`q\n${A4_WIDTH} 0 0 ${A4_HEIGHT} 0 0 cm\n/${imageName} Do\nQ`);
    objects.set(pageId, textBytes(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${A4_WIDTH} ${A4_HEIGHT}] /Resources << /XObject << /${imageName} ${imageId} 0 R >> >> /Contents ${contentId} 0 R >>`));
    objects.set(contentId, joinBytes([textBytes(`<< /Length ${content.byteLength} >>\nstream\n`), content, textBytes("\nendstream")]));
    const jpeg = page.bytes instanceof Uint8Array ? page.bytes : new Uint8Array(page.bytes);
    objects.set(imageId, joinBytes([
      textBytes(`<< /Type /XObject /Subtype /Image /Width ${page.width} /Height ${page.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.byteLength} >>\nstream\n`),
      jpeg,
      textBytes("\nendstream"),
    ]));
  });

  const chunks = [textBytes("%PDF-1.4\n%YuMeewMusic\n")];
  const offsets = [0];
  let length = chunks[0].byteLength;
  const objectCount = objects.size;
  for (let id = 1; id <= objectCount; id += 1) {
    offsets[id] = length;
    const object = joinBytes([textBytes(`${id} 0 obj\n`), objects.get(id), textBytes("\nendobj\n")]);
    chunks.push(object);
    length += object.byteLength;
  }
  const xrefOffset = length;
  chunks.push(textBytes([
    `xref\n0 ${objectCount + 1}\n`,
    "0000000000 65535 f \n",
    ...offsets.slice(1).map(offset => `${String(offset).padStart(10, "0")} 00000 n \n`),
    `trailer\n<< /Size ${objectCount + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`,
  ].join("")));
  return new Blob(chunks, { type: "application/pdf" });
}

function canvasJpeg(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(async blob => {
      if (!blob) return reject(Error("瀏覽器無法建立 PDF 頁面。"));
      resolve({ width: canvas.width, height: canvas.height, bytes: new Uint8Array(await blob.arrayBuffer()) });
    }, "image/jpeg", 0.92);
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
      } else {
        line = candidate;
      }
    }
    if (line) lines.push(line);
  }
  return lines;
}

export async function createStoryboardReportPdf(report, generatedAt = new Date()) {
  const width = 1240;
  const height = 1754;
  const margin = 88;
  const maxWidth = width - margin * 2;
  const canvases = [];
  let canvas;
  let context;
  let y;

  const startPage = () => {
    canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    context = canvas.getContext("2d");
    if (!context) throw Error("瀏覽器無法建立 PDF 畫布。");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
    y = margin;
    canvases.push(canvas);
  };
  const ensureSpace = amount => {
    if (y + amount > height - margin) startPage();
  };
  const write = (text, { size = 27, lineHeight = Math.round(size * 1.55), weight = 400, color = "#23252d", indent = 0, after = 10 } = {}) => {
    const font = `${weight} ${size}px -apple-system, BlinkMacSystemFont, "PingFang TC", "Microsoft JhengHei", sans-serif`;
    context.font = font;
    const lines = wrapText(context, text, maxWidth - indent);
    for (const line of lines) {
      ensureSpace(lineHeight);
      context.font = font;
      context.fillStyle = color;
      context.fillText(line, margin + indent, y + size);
      y += lineHeight;
    }
    y += after;
  };
  const heading = title => {
    ensureSpace(70);
    write(title, { size: 31, lineHeight: 45, weight: 700, color: "#6941c6", after: 14 });
  };
  const bulletList = values => {
    for (const value of values || []) write(`• ${value}`, { indent: 16, after: 4 });
  };

  startPage();
  write("AI 分鏡分析報告", { size: 48, lineHeight: 64, weight: 800, color: "#5b35b1", after: 8 });
  write(new Intl.DateTimeFormat("zh-TW", { dateStyle: "long", timeStyle: "medium" }).format(generatedAt), { size: 21, color: "#6b7280", after: 28 });
  write(`${Math.round(Number(report.overall_score))} 分 · ${{ pass: "可直接生成", needs_revision: "建議修改", fail: "需要重整" }[report.status] || "分析完成"}`, { size: 36, lineHeight: 52, weight: 800, color: "#5b35b1", after: 12 });
  write(report.summary, { size: 29, lineHeight: 44, after: 24 });

  if (report.strengths?.length) {
    heading("做得好的地方");
    bulletList(report.strengths);
  }
  if (report.problems?.length) {
    heading("需要處理的問題");
    for (const problem of report.problems) {
      const related = problem.related_scene === null || problem.related_scene === undefined ? "" : ` ↔ Scene ${problem.related_scene}`;
      write(`Scene ${problem.scene}${related} · ${problem.severity || "提醒"}`, { weight: 700, color: "#9f1239", after: 3 });
      write(problem.message, { indent: 16, after: 2 });
      if (problem.suggestion) write(`建議：${problem.suggestion}`, { size: 24, lineHeight: 37, color: "#4b5563", indent: 16, after: 13 });
    }
  }
  if (report.scene_reviews?.length) {
    heading("逐鏡分析");
    for (const review of report.scene_reviews) {
      write(`Scene ${review.scene} · ${review.score ?? "—"} 分`, { weight: 700, color: "#5b35b1", after: 3 });
      write(`連續性：${review.continuity || "未說明"}`, { indent: 16, after: 1 });
      write(`鏡頭：${review.camera || "未說明"}`, { indent: 16, after: 1 });
      write(`時間：${review.timing || "未說明"}`, { indent: 16, after: 1 });
      write(`生成穩定性：${review.ai_generation || "未說明"}`, { indent: 16, after: 13 });
    }
  }
  if (report.corrected_scenes?.length) {
    heading("修正版分鏡");
    for (const scene of report.corrected_scenes) {
      const duration = scene.duration === null || scene.duration === undefined ? "" : ` · ${scene.duration} 秒`;
      const camera = [scene.shot, scene.camera].filter(Boolean).join("／");
      write(`Scene ${scene.id}${duration}${camera ? ` · ${camera}` : ""}`, { weight: 700, color: "#5b35b1", after: 3 });
      write(scene.description, { indent: 16, after: 2 });
      if (scene.reason) write(`原因：${scene.reason}`, { size: 24, lineHeight: 37, color: "#4b5563", indent: 16, after: 13 });
    }
  }
  if (report.generation_advice?.length) {
    heading("生成建議");
    bulletList(report.generation_advice);
  }

  canvases.forEach((page, index) => {
    const pageContext = page.getContext("2d");
    pageContext.font = '20px -apple-system, BlinkMacSystemFont, "PingFang TC", "Microsoft JhengHei", sans-serif';
    pageContext.fillStyle = "#8a8f9b";
    pageContext.textAlign = "right";
    pageContext.fillText(`${index + 1} / ${canvases.length}`, width - margin, height - 38);
  });
  return buildJpegPdf(await Promise.all(canvases.map(canvasJpeg)));
}
