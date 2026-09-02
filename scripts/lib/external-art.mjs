/**
 * Cutting external sprite sheets down to the single billboards a slot binds.
 *
 * The placeholder generators in this directory *draw* art. This module is for
 * art that already exists as somebody else's sheet: `AGENTS.md` §10 says a
 * scenario's sprites are static billboards, so a five-frame strip and a 4x4
 * RPG-Maker grid both have to become one PNG per slot before the runtime ever
 * sees them.
 *
 * Everything here is pure and deterministic — same inputs, same bytes — so
 * `npm run art:import` is re-runnable and its output is reviewable as a diff.
 */

import { decodePng, Pixels } from "./png.mjs";

/** An RGBA image as decoded: `{ width, height, data }`. */

/** Reads one pixel as `[r, g, b, a]`. */
function pixelAt(image, x, y) {
  const i = (y * image.width + x) * 4;
  return [image.data[i], image.data[i + 1], image.data[i + 2], image.data[i + 3]];
}

/** A blank image of the given size. */
function blank(width, height) {
  return { width, height, data: new Uint8Array(width * height * 4) };
}

/** Copies a rectangle out of an image. Out-of-bounds reads are transparent. */
export function crop(image, x, y, width, height) {
  const out = blank(width, height);
  for (let dy = 0; dy < height; dy += 1) {
    for (let dx = 0; dx < width; dx += 1) {
      const sx = x + dx;
      const sy = y + dy;
      if (sx < 0 || sy < 0 || sx >= image.width || sy >= image.height) continue;
      out.data.set(pixelAt(image, sx, sy), (dy * width + dx) * 4);
    }
  }
  return out;
}

/**
 * One cell of a uniform grid — the shape both source formats share.
 *
 * A horizontal strip is a grid one row tall, so `frame(sheet, 5, 1, 2, 0)` and
 * `frame(sheet, 4, 4, 1, 2)` are the same call.
 */
export function frame(image, columns, rows, column, row) {
  const w = Math.floor(image.width / columns);
  const h = Math.floor(image.height / rows);
  return crop(image, column * w, row * h, w, h);
}

/**
 * Makes every pixel near `colour` fully transparent.
 *
 * Two of the three sheets this repository uses ship an **opaque background**
 * rather than an alpha channel — alizard's wolf sits on rgb(12,98,98) and
 * MoikMellah's birds on magenta — which is invisible until the sprite is
 * composited over anything. `tolerance` is a sum of absolute channel
 * differences, so 40 catches a lightly-dithered edge without eating the art.
 */
export function keyColour(image, colour, tolerance = 40) {
  const [kr, kg, kb] = colour;
  const out = { width: image.width, height: image.height, data: image.data.slice() };
  for (let i = 0; i < out.data.length; i += 4) {
    const distance =
      Math.abs(out.data[i] - kr) + Math.abs(out.data[i + 1] - kg) + Math.abs(out.data[i + 2] - kb);
    if (distance <= tolerance) out.data[i + 3] = 0;
  }
  return out;
}

/** The colour of the top-left pixel — the key colour, on every sheet so far. */
export function cornerColour(image) {
  return pixelAt(image, 0, 0).slice(0, 3);
}

/**
 * Trims fully transparent margins.
 *
 * A frame cut from a grid is mostly empty space, and a slot's PNG that carries
 * that space makes the sprite's own anchor a lie — `anchor: "bottom"` would sit
 * the actor on the bottom of the *cell* rather than on its feet.
 */
export function trim(image) {
  let minX = image.width;
  let minY = image.height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      if (image.data[(y * image.width + x) * 4 + 3] === 0) continue;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return blank(1, 1);
  return crop(image, minX, minY, maxX - minX + 1, maxY - minY + 1);
}

/** Integer nearest-neighbour upscale. The only scale that preserves pixel art. */
export function scale(image, factor) {
  const out = blank(image.width * factor, image.height * factor);
  for (let y = 0; y < out.height; y += 1) {
    for (let x = 0; x < out.width; x += 1) {
      const p = pixelAt(image, Math.floor(x / factor), Math.floor(y / factor));
      out.data.set(p, (y * out.width + x) * 4);
    }
  }
  return out;
}

/** Draws `top` over `base` at (x, y), source-over. Returns a new image. */
export function over(base, top, x = 0, y = 0) {
  const canvas = new Pixels(base.width, base.height);
  for (let py = 0; py < base.height; py += 1) {
    for (let px = 0; px < base.width; px += 1) canvas.set(px, py, pixelAt(base, px, py));
  }
  for (let py = 0; py < top.height; py += 1) {
    for (let px = 0; px < top.width; px += 1) canvas.set(x + px, y + py, pixelAt(top, px, py));
  }
  return { width: base.width, height: base.height, data: canvas.data };
}

/**
 * Recolours toward night: keep the luminance, push the hue to moonlight.
 *
 * A hue rotation turns this pack's cyan sky brown, which is how the first
 * attempt at this looked. Mixing each pixel toward a single blue by a fixed
 * amount and then darkening keeps the layer separation the parallax depends on
 * — the far ridge stays lighter than the near one — while making the whole
 * thing read as one lit-by-the-moon palette.
 */
export function night(image, { tint = [58, 93, 168], mix = 0.62, brightness = 0.46 } = {}) {
  const out = { width: image.width, height: image.height, data: image.data.slice() };
  for (let i = 0; i < out.data.length; i += 4) {
    if (out.data[i + 3] === 0) continue;
    for (let c = 0; c < 3; c += 1) {
      const lit = out.data[i + c] * (1 - mix) + tint[c] * mix;
      out.data[i + c] = Math.max(0, Math.min(255, Math.round(lit * brightness + tint[c] * 0.18)));
    }
  }
  return out;
}

/** Mirrors horizontally. A sheet is drawn facing one way; a scene needs both. */
export function flipX(image) {
  const out = { width: image.width, height: image.height, data: new Uint8Array(image.data.length) };
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const from = (y * image.width + (image.width - 1 - x)) * 4;
      out.data.set(image.data.subarray(from, from + 4), (y * image.width + x) * 4);
    }
  }
  return out;
}

/** Encodes an image back to PNG bytes. */
export function toPng(image) {
  const canvas = new Pixels(image.width, image.height);
  canvas.data.set(image.data);
  return canvas.toPng();
}

/** Reads a PNG file into an image. */
export function read(buffer) {
  return decodePng(buffer);
}
