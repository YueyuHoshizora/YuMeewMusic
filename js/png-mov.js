const encoder = new TextEncoder();

function bytes(length) {
  return new Uint8Array(length);
}

function ascii(value, length = value.length) {
  const result = bytes(length);
  result.set(encoder.encode(value).subarray(0, length));
  return result;
}

function numbers(size, values) {
  const result = bytes(size * values.length);
  const view = new DataView(result.buffer);
  values.forEach((value, index) => {
    if (size === 2) view.setUint16(index * size, value);
    else view.setUint32(index * size, value);
  });
  return result;
}

function join(parts) {
  const length = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const result = bytes(length);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.byteLength;
  }
  return result;
}

function atom(type, ...parts) {
  const size = 8 + parts.reduce((sum, part) => sum + part.byteLength, 0);
  if (size > 0xffffffff) throw Error("MOV 資料區塊超過 4 GB，請縮短影片或降低解析度。");
  return join([numbers(4, [size]), ascii(type, 4), ...parts]);
}

const fullBox = (versionAndFlags = 0) => numbers(4, [versionAndFlags]);
const matrix = () => numbers(4, [0x00010000, 0, 0, 0, 0x00010000, 0, 0, 0, 0x40000000]);

function movieHeader(timescale, duration) {
  return atom("mvhd", fullBox(), numbers(4, [0, 0, timescale, duration, 0x00010000]), numbers(2, [0x0100, 0]), bytes(8), matrix(), bytes(24), numbers(4, [2]));
}

function trackHeader(width, height, duration) {
  return atom("tkhd", fullBox(7), numbers(4, [0, 0, 1, 0, duration]), bytes(8), numbers(2, [0, 0, 0, 0]), matrix(), numbers(4, [width << 16, height << 16]));
}

function mediaHeader(timescale, duration) {
  return atom("mdhd", fullBox(), numbers(4, [0, 0, timescale, duration]), numbers(2, [0, 0]));
}

function handler(type, name) {
  return atom("hdlr", fullBox(), numbers(4, [0]), ascii(type, 4), bytes(12), ascii(`${name}\0`));
}

function pngSampleEntry(width, height) {
  const compressor = bytes(32);
  const name = ascii("PNG");
  compressor[0] = name.length;
  compressor.set(name, 1);
  return atom(
    "png ",
    bytes(6), numbers(2, [1]), numbers(2, [0, 0]), ascii("YUME", 4), numbers(4, [0, 0]),
    numbers(2, [width, height]), numbers(4, [0x00480000, 0x00480000, 0]), numbers(2, [1]),
    compressor, numbers(2, [32, 0xffff]),
  );
}

function sampleTable(width, height, sizes, offsets) {
  const count = sizes.length;
  const stsd = atom("stsd", fullBox(), numbers(4, [1]), pngSampleEntry(width, height));
  const stts = atom("stts", fullBox(), numbers(4, [1, count, 1]));
  const stsc = atom("stsc", fullBox(), numbers(4, [1, 1, 1, 1]));
  const stsz = atom("stsz", fullBox(), numbers(4, [0, count, ...sizes]));
  const stco = atom("stco", fullBox(), numbers(4, [count, ...offsets]));
  const stss = atom("stss", fullBox(), numbers(4, [count, ...Array.from({ length: count }, (_, index) => index + 1)]));
  return atom("stbl", stsd, stts, stsc, stsz, stco, stss);
}

function mediaInfo(width, height, sizes, offsets) {
  const vmhd = atom("vmhd", fullBox(1), numbers(2, [0, 0, 0, 0]));
  const url = atom("url ", fullBox(1));
  const dref = atom("dref", fullBox(), numbers(4, [1]), url);
  const dinf = atom("dinf", dref);
  return atom("minf", vmhd, dinf, sampleTable(width, height, sizes, offsets));
}

export function createPngMov(frameBlobs, width, height, fps) {
  if (!Array.isArray(frameBlobs) || !frameBlobs.length) throw Error("MOV 至少需要一個影格。");
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) throw Error("MOV 畫面尺寸無效。");
  if (![30, 60].includes(Number(fps))) throw Error("MOV 影格率必須是 30 或 60 fps。");
  const sizes = frameBlobs.map(frame => frame.size);
  const ftyp = atom("ftyp", ascii("qt  ", 4), numbers(4, [0x200]), ascii("qt  ", 4));
  const mdatSize = 8 + sizes.reduce((sum, size) => sum + size, 0);
  if (ftyp.byteLength + mdatSize > 0xffffffff) throw Error("MOV 超過 4 GB，請縮短影片或降低解析度。");
  const offsets = [];
  let offset = ftyp.byteLength + 8;
  for (const size of sizes) {
    offsets.push(offset);
    offset += size;
  }
  const duration = frameBlobs.length;
  const mdia = atom("mdia", mediaHeader(Number(fps), duration), handler("vide", "VideoHandler"), mediaInfo(width, height, sizes, offsets));
  const moov = atom("moov", movieHeader(Number(fps), duration), atom("trak", trackHeader(width, height, duration), mdia));
  const mdatHeader = join([numbers(4, [mdatSize]), ascii("mdat", 4)]);
  return new Blob([ftyp, mdatHeader, ...frameBlobs, moov], { type: "video/quicktime" });
}
