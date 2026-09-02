/**
 * The scenario strip: half the previous scenario, the whole current one, half
 * the next one (GDD §11.2).
 *
 * The next scenario is deliberately visible before the player knows whether
 * they survive the current one — its identity is already decided, because the
 * whole 16-slot run is generated at run start.
 *
 * This view knows nothing about goats, waypoints or any other minigame's
 * vocabulary. A minigame hands it a {@link Scene} — a background and a list of
 * billboards in normalised panel space — and everything here is panel chrome
 * (ground, vignette, label, star meter) plus one generic sprite blitter. That
 * blitter is the whole visual system `AGENTS.md` §10 asks for: show/hide,
 * translate, scale, rotate, and nothing else. There is no frame animation and
 * no particle system; the apparent motion comes from *when* the player's guitar
 * triggers each change.
 */

import type { Scene, Sprite } from "../minigame/api.js";
import type { AssetStore } from "./assets.js";

export type StripPanel = {
  /** What the slot's minigame wants drawn, or null when nothing is authored. */
  scene: Scene | null;
  stars: number;
  starProgress: number;
  difficulty: number;
  label: string;
};

export type StripRender = {
  previous: StripPanel | null;
  current: StripPanel | null;
  next: StripPanel | null;
  /** 0..1 through the one-beat slide transition. */
  slide: number;
};

/**
 * Panel height that {@link Sprite.scale} 1 is calibrated against.
 *
 * Sprite size is `natural × scale × (panelHeight / this)`, so the art keeps its
 * proportions on any panel and a minigame never sees a pixel.
 */
const SPRITE_REFERENCE_HEIGHT = 200;

/** Coarse draw order. {@link Sprite.z} orders within a layer. */
const LAYER_ORDER: Readonly<Record<NonNullable<Sprite["layer"]>, number>> = {
  back: 0,
  stage: 1,
  actor: 2,
  front: 3,
};

const PANEL_BACKDROP = "#0a0d11";
const STAR_EMPTY = "rgba(255,255,255,0.22)";
const STAR_FILLED = "#ffd34d";

export class ScenarioStripView {
  readonly #canvas: HTMLCanvasElement;
  readonly #ctx: CanvasRenderingContext2D;
  readonly #assets: AssetStore;
  #width = 0;
  #height = 0;

  constructor(canvas: HTMLCanvasElement, assets: AssetStore) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2D canvas context unavailable");
    this.#canvas = canvas;
    this.#ctx = ctx;
    this.#assets = assets;
  }

  /** Panel width: the strip is exactly two panels wide, so halves show. */
  get #panelWidth(): number {
    return this.#width / 2;
  }

  /** Canvas-space centre of the current scenario, where energy is delivered. */
  get currentPanelTarget(): { x: number; y: number } {
    return { x: this.#width / 2, y: this.#height * 0.45 };
  }

  render(state: StripRender): void {
    this.#resize();
    const ctx = this.#ctx;
    ctx.fillStyle = PANEL_BACKDROP;
    ctx.fillRect(0, 0, this.#width, this.#height);

    const panelWidth = this.#panelWidth;
    const slideOffset = -panelWidth * state.slide;
    const left = this.#width / 4;

    this.#drawPanel(state.previous, left - panelWidth + slideOffset, panelWidth, false);
    this.#drawPanel(state.next, left + panelWidth + slideOffset, panelWidth, false);
    this.#drawPanel(state.current, left + slideOffset, panelWidth, true);

    // Vignette the flanking panels so the current scenario reads as the one
    // being played, without hiding what is coming.
    ctx.fillStyle = "rgba(6,8,11,0.55)";
    ctx.fillRect(0, 0, left + slideOffset, this.#height);
    ctx.fillRect(left + panelWidth + slideOffset, 0, this.#width, this.#height);
  }

  #drawPanel(panel: StripPanel | null, x: number, width: number, isCurrent: boolean): void {
    const ctx = this.#ctx;
    if (x > this.#width || x + width < 0) return;

    // No slot at all — before the first minigame, or after the last. Nothing to
    // draw but the strip's own ground.
    if (!panel) return;

    ctx.save();
    ctx.beginPath();
    ctx.rect(x, 0, width, this.#height);
    ctx.clip();

    if (!panel.scene) {
      // A slot exists but the library authors nothing for its difficulty. Say
      // so, rather than inventing an exercise for it.
      ctx.fillStyle = "#0a0d11";
      ctx.fillRect(x, 0, width, this.#height);
      ctx.fillStyle = "#3a4450";
      ctx.font = "600 13px ui-monospace, Menlo, Consolas, monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(`L${panel.difficulty} — no scenario authored`, x + width / 2, this.#height / 2);
      ctx.restore();
      return;
    }

    this.#drawBackground(panel.scene.background, x, width);
    this.#drawSprites(panel.scene.sprites, x, width);
    this.#drawLabel(panel, x, width);
    if (isCurrent) this.#drawStarMeter(panel, x, width);

    ctx.strokeStyle = isCurrent ? "rgba(255,255,255,0.16)" : "rgba(255,255,255,0.06)";
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 1, 1, width - 2, this.#height - 2);
    ctx.restore();
  }

  #drawBackground(assetId: string | undefined, x: number, width: number): void {
    const image = assetId ? this.#assets.get(assetId) : null;
    const ctx = this.#ctx;
    if (!image) {
      ctx.fillStyle = "#141a22";
      ctx.fillRect(x, 0, width, this.#height);
      return;
    }
    // Cover-fit: the backdrop is opaque and must not letterbox.
    const scale = Math.max(width / image.width, this.#height / image.height);
    const w = image.width * scale;
    const h = image.height * scale;
    ctx.drawImage(image, x + (width - w) / 2, (this.#height - h) / 2, w, h);
  }

  /**
   * The scene, in one pass.
   *
   * Sorted by layer then `z`, with the original order breaking ties, so a
   * minigame that returns sprites in the order it wants them drawn gets exactly
   * that. Position and size come from the panel, never from the sprite: a
   * minigame works in 0..1 and cannot express a pixel.
   */
  #drawSprites(sprites: readonly Sprite[], panelX: number, panelWidth: number): void {
    const ctx = this.#ctx;
    const unit = this.#height / SPRITE_REFERENCE_HEIGHT;

    const ordered = sprites
      .map((sprite, index) => ({ sprite, index }))
      .sort((a, b) => {
        const layer =
          LAYER_ORDER[a.sprite.layer ?? "stage"] - LAYER_ORDER[b.sprite.layer ?? "stage"];
        if (layer !== 0) return layer;
        const z = (a.sprite.z ?? 0) - (b.sprite.z ?? 0);
        return z !== 0 ? z : a.index - b.index;
      });

    for (const { sprite } of ordered) {
      const image = this.#assets.get(sprite.assetId);
      // A missing sprite leaves a visible gap and is reported in the dev panel
      // (`AssetStore.failed`), rather than taking the frame down.
      if (!image) continue;

      const scale = (sprite.scale ?? 1) * unit;
      const w = image.width * scale;
      const h = image.height * scale;
      const cx = panelX + sprite.x * panelWidth;
      const cy = (sprite.y + (sprite.offsetY ?? 0)) * this.#height;

      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1, sprite.opacity ?? 1));
      ctx.translate(cx, cy);
      if (sprite.rotationDeg) ctx.rotate((sprite.rotationDeg * Math.PI) / 180);
      // The anchor is also the pivot: a climber tilts about its feet, a
      // foothold about its middle.
      ctx.drawImage(image, -w / 2, sprite.anchor === "bottom" ? -h : -h / 2, w, h);
      ctx.restore();
    }
  }

  #drawLabel(panel: StripPanel, x: number, width: number): void {
    const ctx = this.#ctx;
    ctx.fillStyle = "rgba(6,8,11,0.62)";
    ctx.fillRect(x, this.#height - 22, width, 22);
    ctx.fillStyle = "#cfd8e3";
    ctx.font = "600 11px ui-monospace, Menlo, Consolas, monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(panel.label, x + width / 2, this.#height - 11);
  }

  /** Three empty stars over the scenario, filling as thresholds are crossed. */
  #drawStarMeter(panel: StripPanel, x: number, width: number): void {
    const ctx = this.#ctx;
    const centre = x + width / 2;
    const size = Math.min(20, this.#height * 0.075);
    const gap = size * 1.7;

    // A plate behind the row, because the meter has to stay readable over
    // whatever the scenario put up there — at L4 the summit cairn sits in
    // exactly this part of the frame.
    const plateWidth = gap * 2 + size * 1.6;
    ctx.fillStyle = "rgba(6,8,11,0.45)";
    this.#roundRect(centre - plateWidth / 2, 4, plateWidth, size * 1.9, size * 0.5);
    ctx.fill();

    for (let i = 0; i < 3; i += 1) {
      const cx = centre + (i - 1) * gap;
      const cy = 8 + size;
      const earned = i < panel.stars;
      const partial = !earned && i === panel.stars ? panel.starProgress : 0;

      ctx.save();
      ctx.translate(cx, cy);
      this.#starPath(size * 0.62);
      ctx.fillStyle = STAR_EMPTY;
      ctx.fill();
      if (earned || partial > 0) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(-size, size * 0.7 - size * 1.4 * (earned ? 1 : partial), size * 2, size * 2);
        ctx.clip();
        this.#starPath(size * 0.62);
        ctx.fillStyle = STAR_FILLED;
        ctx.fill();
        ctx.restore();
      }
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = "rgba(10,12,16,0.85)";
      this.#starPath(size * 0.62);
      ctx.stroke();
      ctx.restore();
    }
  }

  #roundRect(x: number, y: number, width: number, height: number, radius: number): void {
    const ctx = this.#ctx;
    const r = Math.min(radius, width / 2, height / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + width, y, x + width, y + height, r);
    ctx.arcTo(x + width, y + height, x, y + height, r);
    ctx.arcTo(x, y + height, x, y, r);
    ctx.arcTo(x, y, x + width, y, r);
    ctx.closePath();
  }

  #starPath(radius: number): void {
    const ctx = this.#ctx;
    ctx.beginPath();
    for (let i = 0; i < 10; i += 1) {
      const r = i % 2 === 0 ? radius : radius * 0.44;
      const angle = (Math.PI / 5) * i - Math.PI / 2;
      const px = Math.cos(angle) * r;
      const py = Math.sin(angle) * r;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
  }

  #resize(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = this.#canvas.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    if (this.#canvas.width !== width * dpr || this.#canvas.height !== height * dpr) {
      this.#canvas.width = width * dpr;
      this.#canvas.height = height * dpr;
    }
    this.#width = width;
    this.#height = height;
    this.#ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.#ctx.imageSmoothingEnabled = false;
  }
}
