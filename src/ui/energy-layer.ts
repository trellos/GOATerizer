/**
 * Short flights across the screen, in musical time.
 *
 * One caller now: the stars earned by a finished minigame flying from the
 * timeline up into their slot in the run history. That is a real distance
 * between two regions, and the flight is what connects them.
 *
 * It used to have a second and more important job — carrying a judged note from
 * the timeline into the scenario panel, with its *arrival* triggering the
 * reaction so the player read causation rather than coincidence. The scenario
 * panel is gone (GDD §11.2): the note and the reaction are now the same pixels,
 * so a streak between them would have nowhere to go. Whether any *delay* should
 * survive that is `REACTION_DELAY_BEATS` in `config/tuning.ts`, and it belongs
 * to the attempt runtime rather than to a visual effect.
 *
 * Flight time is measured in **beats**, not milliseconds, so it stays
 * proportionate at 60bpm and at 140bpm.
 */

const FLIGHT_BEATS = 0.28;
const TRAIL_SEGMENTS = 7;

/**
 * Kept, though only `"good"` has a producer today.
 *
 * The bad-energy flight died with the scenario panel. This is one line and a
 * colour, and a minigame reaction that ever wants to throw something across the
 * screen will want the other half of it back.
 */
export type EnergyPolarity = "good" | "bad";

export type StreakOptions = {
  from: { x: number; y: number };
  to: { x: number; y: number };
  polarity: EnergyPolarity;
  /** Perfect reads brighter and cleaner than Good. */
  strong: boolean;
  bornBeat: number;
  onArrive: () => void;
};

type Streak = StreakOptions & { arrived: boolean };

const COLOURS: Record<EnergyPolarity, { core: string; trail: string }> = {
  good: { core: "#fff6c4", trail: "rgba(255,211,77,0.55)" },
  bad: { core: "#ffb1b1", trail: "rgba(255,91,91,0.45)" },
};

export class EnergyLayer {
  readonly #canvas: HTMLCanvasElement;
  readonly #ctx: CanvasRenderingContext2D;
  #streaks: Streak[] = [];
  #width = 0;
  #height = 0;

  constructor(canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2D canvas context unavailable");
    this.#canvas = canvas;
    this.#ctx = ctx;
  }

  get activeCount(): number {
    return this.#streaks.length;
  }

  spawn(options: StreakOptions): void {
    this.#streaks.push({ ...options, arrived: false });
  }

  clear(): void {
    this.#streaks = [];
  }

  /**
   * Advances flights and fires arrivals.
   *
   * Arrivals fire here rather than in the draw pass, so a hidden or offscreen
   * canvas still runs the callback: a star must land in the history bar whether
   * or not anyone watched it fly.
   */
  update(nowBeat: number): void {
    for (const streak of this.#streaks) {
      if (streak.arrived) continue;
      if (nowBeat - streak.bornBeat >= FLIGHT_BEATS) {
        streak.arrived = true;
        streak.onArrive();
      }
    }
    this.#streaks = this.#streaks.filter(
      (streak) => nowBeat - streak.bornBeat < FLIGHT_BEATS * 1.35
    );
  }

  render(nowBeat: number): void {
    this.#resize();
    const ctx = this.#ctx;
    ctx.clearRect(0, 0, this.#width, this.#height);

    for (const streak of this.#streaks) {
      const t = Math.min(1, (nowBeat - streak.bornBeat) / FLIGHT_BEATS);
      const colours = COLOURS[streak.polarity];
      const fade = t < 1 ? 1 : Math.max(0, 1 - (nowBeat - streak.bornBeat - FLIGHT_BEATS) * 3);

      ctx.save();
      ctx.globalAlpha = fade;
      ctx.lineCap = "round";

      // A short tapering trail behind the head, drawn as a few segments rather
      // than a particle system.
      for (let i = 0; i < TRAIL_SEGMENTS; i += 1) {
        const tail = Math.max(0, t - i * 0.045);
        const a = this.#point(streak, tail);
        const b = this.#point(streak, Math.max(0, tail - 0.045));
        ctx.strokeStyle = i === 0 ? colours.core : colours.trail;
        ctx.lineWidth = (streak.strong ? 5 : 3.2) * (1 - i / TRAIL_SEGMENTS);
        ctx.globalAlpha = fade * (1 - i / (TRAIL_SEGMENTS + 1));
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }

      const head = this.#point(streak, t);
      ctx.globalAlpha = fade;
      ctx.fillStyle = colours.core;
      ctx.beginPath();
      ctx.arc(head.x, head.y, streak.strong ? 4.5 : 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  /**
   * Position along the flight.
   *
   * A slight arc, biased upwards early, so the streak reads as *launched* out
   * of the timeline rather than dragged along a ruler.
   */
  #point(streak: Streak, t: number): { x: number; y: number } {
    const eased = t * t * (3 - 2 * t);
    const x = streak.from.x + (streak.to.x - streak.from.x) * eased;
    const y = streak.from.y + (streak.to.y - streak.from.y) * eased;
    const arc = Math.sin(eased * Math.PI) * 26 * (streak.polarity === "good" ? -1 : 0.6);
    return { x, y: y + arc };
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
  }
}
