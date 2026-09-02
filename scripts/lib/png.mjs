/**
 * A minimal PNG encoder and a tiny pixel-art canvas.
 *
 * Node ships `zlib`, which is the only hard part of writing a PNG, so the
 * placeholder art generator has no image-library dependency at all.
 */

import { deflateSync, inflateSync } from "node:zlib";

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typed = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed));
  return Buffer.concat([length, typed, crc]);
}

/** An RGBA pixel buffer with just enough drawing to author pixel art. */
export class Pixels {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.data = new Uint8Array(width * height * 4);
  }

  set(x, y, [r, g, b, a = 255]) {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    const i = (y * this.width + x) * 4;
    if (a === 255) {
      this.data[i] = r;
      this.data[i + 1] = g;
      this.data[i + 2] = b;
      this.data[i + 3] = 255;
      return;
    }
    // Source-over, so soft dust edges composite instead of punching holes.
    const srcA = a / 255;
    const dstA = this.data[i + 3] / 255;
    const outA = srcA + dstA * (1 - srcA);
    if (outA === 0) return;
    this.data[i] = Math.round((r * srcA + this.data[i] * dstA * (1 - srcA)) / outA);
    this.data[i + 1] = Math.round((g * srcA + this.data[i + 1] * dstA * (1 - srcA)) / outA);
    this.data[i + 2] = Math.round((b * srcA + this.data[i + 2] * dstA * (1 - srcA)) / outA);
    this.data[i + 3] = Math.round(outA * 255);
  }

  fillRect(x, y, w, h, colour) {
    for (let dy = 0; dy < h; dy += 1) {
      for (let dx = 0; dx < w; dx += 1) this.set(x + dx, y + dy, colour);
    }
  }

  fillEllipse(cx, cy, rx, ry, colour) {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y += 1) {
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x += 1) {
        const nx = (x - cx) / rx;
        const ny = (y - cy) / ry;
        if (nx * nx + ny * ny <= 1) this.set(x, y, colour);
      }
    }
  }

  /**
   * Stamps an ASCII-art sprite. `rows` is an array of equal-length strings;
   * `palette` maps each character to a colour, and any character missing from
   * the palette is transparent.
   */
  stamp(x, y, rows, palette) {
    rows.forEach((row, dy) => {
      [...row].forEach((ch, dx) => {
        const colour = palette[ch];
        if (colour) this.set(x + dx, y + dy, colour);
      });
    });
  }

  toPng() {
    const stride = this.width * 4;
    const raw = Buffer.alloc((stride + 1) * this.height);
    for (let y = 0; y < this.height; y += 1) {
      raw[y * (stride + 1)] = 0; // filter: none
      Buffer.from(this.data.buffer, y * stride, stride).copy(raw, y * (stride + 1) + 1);
    }

    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(this.width, 0);
    ihdr.writeUInt32BE(this.height, 4);
    ihdr[8] = 8; // bit depth
    ihdr[9] = 6; // colour type: RGBA
    ihdr[10] = 0;
    ihdr[11] = 0;
    ihdr[12] = 0;

    return Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk("IHDR", ihdr),
      chunk("IDAT", deflateSync(raw, { level: 9 })),
      chunk("IEND", Buffer.alloc(0)),
    ]);
  }
}

/** Deterministic PRNG, so re-running the generator produces identical files. */
export function lcg(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

/* -------------------------------------------------------------------------- */
/* Decoding                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Reads a PNG into RGBA, so external art can be sliced into per-slot files.
 *
 * The encoder above exists because the placeholder art is *drawn*. This exists
 * for the opposite case: art that already exists as somebody else's sprite
 * sheet and has to be cut down to the one static billboard a slot binds. Both
 * directions stay dependency-free — `zlib` is still the only hard part.
 *
 * Supports the 8-bit non-interlaced colour types real sprite sheets use
 * (greyscale, RGB, palette, greyscale+alpha, RGBA) and throws on anything else
 * rather than returning quietly wrong pixels.
 */
export function decodePng(buffer) {
  let idat = [];
  let ihdr = null;
  let palette = null;
  let transparency = null;

  for (let i = 8; i < buffer.length; ) {
    const length = buffer.readUInt32BE(i);
    const type = buffer.toString("ascii", i + 4, i + 8);
    const body = buffer.subarray(i + 8, i + 8 + length);
    if (type === "IHDR") ihdr = body;
    else if (type === "IDAT") idat.push(body);
    else if (type === "PLTE") palette = body;
    else if (type === "tRNS") transparency = body;
    i += 12 + length;
  }
  if (!ihdr) throw new Error("not a PNG: no IHDR");

  const width = ihdr.readUInt32BE(0);
  const height = ihdr.readUInt32BE(4);
  const depth = ihdr[8];
  const colourType = ihdr[9];
  const interlace = ihdr[12];
  if (depth !== 8 || interlace !== 0) {
    throw new Error(`unsupported PNG: bit depth ${depth}, interlace ${interlace}`);
  }

  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colourType];
  if (!channels) throw new Error(`unsupported PNG colour type ${colourType}`);

  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const lines = Buffer.alloc(stride * height);
  let previous = Buffer.alloc(stride);
  let offset = 0;

  for (let y = 0; y < height; y += 1) {
    const filter = raw[offset];
    offset += 1;
    const line = Buffer.from(raw.subarray(offset, offset + stride));
    offset += stride;
    for (let x = 0; x < stride; x += 1) {
      const a = x >= channels ? line[x - channels] : 0;
      const b = previous[x];
      const c = x >= channels ? previous[x - channels] : 0;
      if (filter === 1) line[x] = (line[x] + a) & 0xff;
      else if (filter === 2) line[x] = (line[x] + b) & 0xff;
      else if (filter === 3) line[x] = (line[x] + ((a + b) >> 1)) & 0xff;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        line[x] = (line[x] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 0xff;
      }
    }
    line.copy(lines, y * stride);
    previous = line;
  }

  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    const s = i * channels;
    let r;
    let g;
    let b;
    let a = 255;
    if (colourType === 6) [r, g, b, a] = [lines[s], lines[s + 1], lines[s + 2], lines[s + 3]];
    else if (colourType === 2) [r, g, b] = [lines[s], lines[s + 1], lines[s + 2]];
    else if (colourType === 3) {
      const index = lines[s];
      [r, g, b] = [palette[index * 3], palette[index * 3 + 1], palette[index * 3 + 2]];
      if (transparency && index < transparency.length) a = transparency[index];
    } else if (colourType === 0) [r, g, b] = [lines[s], lines[s], lines[s]];
    else [r, g, b, a] = [lines[s], lines[s], lines[s], lines[s + 1]];
    data.set([r, g, b, a], i * 4);
  }

  return { width, height, data };
}
