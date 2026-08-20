/**
 * The scenario strip: half the previous scenario, the whole current one, half
 * the next one (GDD §11.2).
 *
 * The next scenario is deliberately visible before the player knows whether
 * they survive the current one — its identity is already decided, because the
 * whole 16-slot run is generated at run start.
 *
 * Rendering obeys the visual system's constraints: static billboards, shown,
 * hidden, translated, scaled and rotated. One foothold sprite is instantiated
 * once per waypoint. There is no frame animation and no particle system; the
 * apparent motion comes from *when* the player's guitar triggers each step.
 */

import type { ClimbVisualState } from "../scenario/minigames/climb-minigame.js";
import type { RouteData, ScenarioDefinition } from "../scenario/types.js";
import type { AssetStore } from "./assets.js";

export type StripPanel = {
  scenario: ScenarioDefinition | null;
  route: RouteData | null;
  /** Only the current panel has live climb state. */
  climb: ClimbVisualState | null;
  stars: number;
  starProgress: number;
  difficulty: number;
  label: string;
  /** Attempt-relative beat for THIS panel, so its effects decay correctly. */
  beat: number;
};

export type StripRender = {
  previous: StripPanel | null;
  current: StripPanel | null;
  next: StripPanel | null;
  /** 0..1 through the one-beat slide transition. */
  slide: number;
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

    if (!panel.scenario) {
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

    this.#drawBackground(panel.scenario, x, width);
    if (panel.route) this.#drawRoute(panel, x, width, panel.beat);
    this.#drawLabel(panel, x, width);
    if (isCurrent) this.#drawStarMeter(panel, x, width);

    ctx.strokeStyle = isCurrent ? "rgba(255,255,255,0.16)" : "rgba(255,255,255,0.06)";
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 1, 1, width - 2, this.#height - 2);
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

  #drawRoute(panel: StripPanel, x: number, width: number, beat: number): void {
    const ctx = this.#ctx;
    const route = panel.route;
    const scenario = panel.scenario;
    if (!route || !scenario) return;

    const toScreen = (point: { x: number; y: number }) => ({
      x: x + point.x * width,
      y: point.y * this.#height,
    });

    // Footholds: one reusable sprite, instantiated per waypoint, varied only by
    // transform. Thirty of these is thirty draws of one 18x11 image.
    const stepId = scenario.assetBindings.waypointVisuals[0];
    const step = stepId ? this.#assets.get(stepId) : null;
    const climb = panel.climb;

    route.waypoints.forEach((waypoint, index) => {
      const at = toScreen(waypoint);
      const reached = climb ? index <= climb.waypointIndex : false;
      const spriteScale = (this.#height / 260) * waypoint.scale * 1.6;
      ctx.save();
      ctx.translate(at.x, at.y);
      ctx.rotate((waypoint.rotationDeg * Math.PI) / 180);
      ctx.globalAlpha = reached ? 1 : 0.72;
      if (step) {
        ctx.drawImage(
          step,
          (-step.width * spriteScale) / 2,
          (-step.height * spriteScale) / 2,
          step.width * spriteScale,
          step.height * spriteScale
        );
      } else {
        ctx.fillStyle = "#7a7a84";
        ctx.fillRect(-6, -3, 12, 6);
      }
      ctx.restore();
    });

    // The destination, visible from the start so the climb has a point.
    const goal = this.#assets.get(scenario.assetBindings.destinationVisual);
    const goalAt = toScreen(route.destination);
    if (goal) {
      const goalScale = (this.#height / 300) * 1.7;
      ctx.drawImage(
        goal,
        goalAt.x - (goal.width * goalScale) / 2,
        goalAt.y - goal.height * goalScale,
        goal.width * goalScale,
        goal.height * goalScale
      );
    }

    if (climb) this.#drawClimber(panel, climb, toScreen, beat);
  }

  #drawClimber(
    panel: StripPanel,
    climb: ClimbVisualState,
    toScreen: (point: { x: number; y: number }) => { x: number; y: number },
    beat: number
  ): void {
    const ctx = this.#ctx;
    const scenario = panel.scenario;
    if (!scenario) return;

    // Effects first, so the climber lands on top of its own dust.
    for (const effect of climb.effects) {
      const image = this.#assets.get(effect.assetId);
      const at = toScreen(effect.position);
      const age = Math.max(0, Math.min(1, (beat - effect.bornAtBeat) / effect.lifeBeats));
      const alpha = 1 - age;
      if (!image) continue;

      ctx.save();
      ctx.globalAlpha = alpha * (effect.kind === "accent" ? 1 : 0.85);
      // The contact effect settles; the accent scales in and out.
      const pulse =
        effect.kind === "accent" ? 0.6 + Math.sin(age * Math.PI) * 0.9 : 1 + age * 0.35;
      const scale = (this.#height / 240) * effect.strength * pulse * 1.4;
      const offsetY = effect.kind === "contact" ? 6 : -10;
      ctx.drawImage(
        image,
        at.x - (image.width * scale) / 2,
        at.y - (image.height * scale) / 2 + offsetY,
        image.width * scale,
        image.height * scale
      );
      ctx.restore();
    }

    const pose = this.#assets.get(climb.poseAssetId);
    const at = toScreen(climb.position);
    const scale = (this.#height / 200) * 1.5;

    ctx.save();
    ctx.translate(at.x, at.y);
    if (climb.wobble > 0) {
      // Wobble: a brief lean and a nudge, returning to the same waypoint. It
      // never costs earned progress.
      const swing = Math.sin(climb.wobble * Math.PI * 4) * climb.wobble;
      ctx.rotate((swing * 9 * Math.PI) / 180);
      ctx.translate(swing * 2.5, 0);
    }
    if (pose) {
      ctx.drawImage(
        pose,
        (-pose.width * scale) / 2,
        -pose.height * scale + 4,
        pose.width * scale,
        pose.height * scale
      );
    } else {
      ctx.fillStyle = "#eee6d6";
      ctx.fillRect(-8, -16, 16, 16);
    }
    ctx.restore();
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
