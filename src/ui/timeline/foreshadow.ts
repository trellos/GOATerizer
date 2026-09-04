/**
 * Where the next-minigame notice sits, and how visible it is.
 *
 * The notice appears in the last measure of a minigame and tells the player
 * the *rhythm* of the one coming — "Ba Da Bing", "Boom Chika" — so they can
 * feel the change before the notes arrive. It is pinned to the top-right of
 * the playfield while that final measure plays, and from the handover beat it
 * belongs to the outgoing minigame: it scrolls left at exactly the timeline's
 * speed, with the old notes, until it leaves the screen.
 *
 * Pure geometry, in the timeline's own units, so it is testable without a
 * canvas and so the view cannot get the speed wrong — the same `pixelsPerBeat`
 * that moves a note moves this.
 */

export type ForeshadowNotice = {
  /** What to say: the next family's rhythm call. */
  readonly call: string;
  /** Absolute timeline beat the notice first appears on. */
  readonly revealBeat: number;
  /** Absolute timeline beat from which it scrolls away with the old minigame. */
  readonly scrollBeat: number;
};

/** How long the notice takes to fade in after `revealBeat`, in beats. */
export const FORESHADOW_FADE_BEATS = 0.5;

/**
 * The notice's x for its pinned edge: `anchorX` until `scrollBeat`, then
 * moving left at `pixelsPerBeat`.
 */
export function foreshadowX(
  anchorX: number,
  pixelsPerBeat: number,
  nowBeat: number,
  scrollBeat: number
): number {
  return anchorX - Math.max(0, nowBeat - scrollBeat) * pixelsPerBeat;
}

/** 0 before `revealBeat`, 1 once faded in. */
export function foreshadowOpacity(nowBeat: number, revealBeat: number): number {
  const t = (nowBeat - revealBeat) / FORESHADOW_FADE_BEATS;
  return t <= 0 ? 0 : t >= 1 ? 1 : t;
}

/** How far the arrow nudges right, in 0..1, pulsing once per beat. */
export function foreshadowArrowNudge(nowBeat: number): number {
  const frac = nowBeat - Math.floor(nowBeat);
  return Math.sin(frac * Math.PI);
}
