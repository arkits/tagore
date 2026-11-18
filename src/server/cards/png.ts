/**
 * Character cards travel as PNG images with the card JSON base64-encoded in a tEXt chunk:
 * keyword "chara" (V2) or "ccv3" (V3, preferred when both present).
 */
const SIG = [137, 80, 78, 71, 13, 10, 26, 10];

function isPng(buf: Uint8Array) {
  return SIG.every((b, i) => buf[i] === b);
}

function readChunks(buf: Uint8Array) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const chunks: { type: string; data: Uint8Array; start: number; end: number }[] = [];
  let off = 8;
  while (off + 8 <= buf.length) {
    const len = dv.getUint32(off);
    const type = String.fromCharCode(...buf.subarray(off + 4, off + 8));
    const data = buf.subarray(off + 8, off + 8 + len);
    chunks.push({ type, data, start: off, end: off + 12 + len });
    off += 12 + len;
    if (type === "IEND") break;
  }
  return chunks;
}

function b64ToUtf8(b64: string): string {
  return Buffer.from(b64.trim(), "base64").toString("utf8");
}

export function extractCardFromPng(buf: Uint8Array): unknown {
  if (!isPng(buf)) throw new Error("Not a PNG file");
  const texts = new Map<string, string>();
  for (const c of readChunks(buf)) {
    if (c.type !== "tEXt") continue;
    const nul = c.data.indexOf(0);
    if (nul < 0) continue;
    const key = new TextDecoder("latin1").decode(c.data.subarray(0, nul)).toLowerCase();
    const val = new TextDecoder("latin1").decode(c.data.subarray(nul + 1));
    texts.set(key, val);
  }
  const raw = texts.get("ccv3") ?? texts.get("chara");
  if (!raw) throw new Error("No character data found in this PNG (expected a 'chara' or 'ccv3' text chunk).");
  return JSON.parse(b64ToUtf8(raw));
}

function crc32(data: Uint8Array): number {
  return Bun.hash.crc32(data) >>> 0;
}

function textChunk(key: string, value: string): Uint8Array {
  const enc = new TextEncoder();
  const body = new Uint8Array([...enc.encode(key), 0, ...enc.encode(value)]);
  const out = new Uint8Array(12 + body.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, body.length);
  out.set(enc.encode("tEXt"), 4);
  out.set(body, 8);
  dv.setUint32(8 + body.length, crc32(out.subarray(4, 8 + body.length)));
  return out;
}

/** Return a copy of `png` with a fresh `chara` chunk (any old chara/ccv3 removed). */
export function embedCardInPng(png: Uint8Array, cardJson: unknown): Uint8Array {
  if (!isPng(png)) throw new Error("Avatar is not a PNG");
  const b64 = Buffer.from(JSON.stringify(cardJson), "utf8").toString("base64");
  const parts: Uint8Array[] = [png.subarray(0, 8)];
  for (const c of readChunks(png)) {
    if (c.type === "tEXt") {
      const key = new TextDecoder("latin1").decode(c.data.subarray(0, c.data.indexOf(0))).toLowerCase();
      if (key === "chara" || key === "ccv3") continue;
    }
    if (c.type === "IEND") parts.push(textChunk("chara", b64));
    parts.push(png.subarray(c.start, c.end));
  }
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}
