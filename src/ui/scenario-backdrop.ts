/**
 * The scenario backdrop: one full-frame background per minigame, and the slide
 * between them.
 *
 * The scenario used to be a diorama you watched — a goat on an authored route,
 * footholds lighting up, dust at the contact point. The timeline-actor draft
 * moved all of that onto the note bars themselves
 * (`docs/game-design/PROPOSED_Timeline_Actors.md`), so the art panel has one job
 * left: be the place the minigame happens. That is a background.
 *
 * ## Why this is not the strip GDD §11.2 describes
 *
 * §11.2 asks for half the previous scenario, the whole current one, and half
 * the next, with the next deliberately visible before the player knows whether
 * they survive. That composition assumed the scenario panel *was* the playfield,
 * so a panel wide enough to read was worth two thirds of the screen and its
 * neighbours could sit beside it.
 *
 * They cannot now. The timeline is the playfield and it spans the full width, so
 * a scenario occupying the middle half leaves the lanes running out over black
 * on both sides, and the two seams cut straight through the notes. A background
 * that covers half the playfield is not doing the one job it has left.
 *
 * So each panel is the full frame, and the neighbours live off-screen until the
 * transition slides them through. What is lost is the early peek at the next
 * scenario; what replaces it, for now, is the run's own labelling. Putting the
 * peek back — as a cross-fade beginning in the last measure, say — is a real
 * option and is noted in `DECISION_LOG.md` (DECISION-022).
 */

import type { ScenarioDefinition } from "../scenario/types.js";
import type { AssetStore } from "./assets.js";

export type BackdropPanel = {
  scenario: ScenarioDefinition | null;
  stars: number;
  starProgress: number;
  difficulty: number;
  label: string;
};

export type BackdropRender = {
  previous: BackdropPanel | null;
  current: BackdropPanel | null;
  next: BackdropPanel | null;
  /** -1..0 through the transition: -1 is the previous panel centred, 0 the current. */
  slide: number;
};

const GROUND = "#0a0d11";
const STAR_EMPTY = "rgba(255,255,255,0.22)";
const STAR_FILLED = "#ffd34d";

/**
 * How much the backdrop is darkened.
 *
 * It is behind a playfield now, not beside one. A pixel-art sunset at full
 * strength competes with the note bars for exactly the attention the notes need;
 * a quarter-stop down it still reads as a place while the notes stay the
 * brightest thing on screen. The timeline lays its own heavier scrim under the
 * lane band on top of this.
 */
const BACKDROP_SCRIM = "rgba(6,8,11,0.28)";

export class ScenarioBackdropView {
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

  /** Canvas-space centre of the current scenario — where a trophy flies from. */
  get currentPanelTarget(): { x: number; y: number } {
    return { x: this.#width / 2, y: this.#height * 0.45 };
  }

  render(state: BackdropRender): void {
    this.#resize();
    const ctx = this.#ctx;
    ctx.fillStyle = GROUND;
    ctx.fillRect(0, 0, this.#width, this.#height);

    // One panel per screen, so the neighbours are only visible while sliding.
    const width = this.#width;
    const offset = -width * state.slide;

    this.#drawPanel(state.previous, offset - width, width);
    this.#drawPanel(state.next, offset + width, width);
    this.#drawPanel(state.current, offset, width);

    ctx.fillStyle = BACKDROP_SCRIM;
    ctx.fillRect(0, 0, width, this.#height);

    // The meter goes on last and unscrimmed: it is HUD, not scenery.
    if (state.current) this.#drawStarMeter(state.current, offset, width);
  }

  #drawPanel(panel: BackdropPanel | null, x: number, width: number): void {
    const ctx = this.#ctx;
    if (x >= this.#width || x + width <= 0) return;
    // No slot at all — before the first minigame, or after the last.
    if (!panel) return;

    ctx.save();
    ctx.beginPath();
    ctx.rect(x, 0, width, this.#height);
    ctx.clip();

    if (!panel.scenario) {
      // A slot exists but the library authors nothing for its difficulty. Say
      // so, rather than inventing an exercise for it.
      ctx.fillStyle = GROUND;
      ctx.fillRect(x, 0, width, this.#height);
      ctx.fillStyle = "#3a4450";
      ctx.font = "600 13px ui-monospace, Menlo, Consolas, monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(`L${panel.difficulty} — no scenario authored`, x + width / 2, this.#height / 2);
      ctx.restore();
      return;
    }

    this.#drawBackground(panel.scenario, x, width);
    this.#drawLabel(panel, x, width);
    ctx.restore();
  }

  #drawBackground(scenario: ScenarioDefinition, x: number, width: number): void {
    const image = this.#assets.get(scenario.assetBindings.background);
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

  #drawLabel(panel: BackdropPanel, x: number, width: number): void {
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
  #drawStarMeter(panel: BackdropPanel, x: number, width: number): void {
    const ctx = this.#ctx;
    const centre = x + width / 2;
    const size = Math.min(20, this.#height * 0.075);
    const gap = size * 1.7;

    // A plate behind the row, because the meter has to stay readable over
    // whatever the scenario put up there.
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
