import test from "node:test";
import assert from "node:assert/strict";
import { buildJpegPdf } from "../js/pdf-export.js";

test("JPEG report pages produce a valid multi-page PDF container", async () => {
  const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]);
  const pdf = buildJpegPdf([
    { width: 1240, height: 1754, bytes: jpeg },
    { width: 1240, height: 1754, bytes: jpeg },
  ]);
  assert.equal(pdf.type, "application/pdf");
  const source = Buffer.from(await pdf.arrayBuffer()).toString("latin1");
  assert.match(source, /^%PDF-1\.4/);
  assert.match(source, /\/Type \/Pages \/Count 2/);
  assert.equal((source.match(/\/Subtype \/Image/g) || []).length, 2);
  assert.match(source, /xref\n0 9\n/);
  assert.match(source, /%%EOF\n$/);
});
