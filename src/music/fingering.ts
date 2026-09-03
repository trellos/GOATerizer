/**
 * Suggested one-octave guitar fingerings for the run key.
 *
 * A fingering is a **visual convenience**, never an input requirement.
 * Tuninator judges the pitch that was produced; a player who reaches the right
 * note somewhere else on the neck is right. What the fingering decides is:
 *
 *   - the physical reference shown over the pitch lanes in pregame, and
 *   - the five-fret diagram the player picks from, which is how they choose
 *     *where on the neck* to practise this run.
 *
 * It places nothing on the timeline. That was Tablature View's job, and Tab
 * View is gone (`DECISION_LOG.md` DECISION-041); the vertical axis is harmonic
 * role on every screen.
 *
 * Every shape offered fits inside a five-fret window, so the fretting hand
 * stays in one position for the whole exercise. A shape that would make the
 * hand travel is not a shape worth suggesting for an eight-note scale.
 */

import { laneMidiNotes, type RunKey } from "./keys.js";

/** Standard tuning, low to high. Index 0 is the low E string. */
export const OPEN_STRING_MIDI: readonly number[] = [40, 45, 50, 55, 59, 64];

/** Row labels, low to high. `e` is the high E, as tablature always writes it. */
export const STRING_NAMES: readonly string[] = ["E", "A", "D", "G", "B", "e"];

/** How many frets a suggested shape — and its diagram — may span. */
export const DIAGRAM_FRETS = 5;

/** No shape is suggested above this fret; past it the neck stops being useful. */
const MAX_FRET = 15;

export type FretPosition = {
  /** 0 = low E. */
  stringIndex: number;
  fret: number;
};

export type Fingering = {
  id: string;
  label: string;
  /** One position per pitch lane, low to high. Always {@link LANE_COUNT} entries. */
  positions: readonly FretPosition[];
  lowestFret: number;
  highestFret: number;
  /** Which string carries the low root. Index 0 = low E. */
  rootString: number;
  /**
   * Leftmost fret of the five-fret diagram window. Never negative, so an
   * open-position shape still shows the nut rather than a phantom fret 0.
   */
  windowStartFret: number;
};

/** `E3` — low-E string, third fret. GDD §13.3 notation. */
export function formatFretPosition(position: FretPosition): string {
  return `${STRING_NAMES[position.stringIndex] ?? "?"}${position.fret}`;
}

/**
 * Notes-per-string patterns, in the order the shapes are offered.
 *
 * One diatonic octave is eight notes, and how those eight are dealt out across
 * adjacent strings is what decides whether the shape fits under one hand.
 * Adjacent strings are a fourth apart — except B, which sits only a major third
 * above G. Every group of strings that crosses B therefore gains a fret on its
 * upper notes compared with the same deal lower down.
 *
 * That is not a footnote, it is the reason this table exists. A three-string
 * shape rooted on D spans D-G-B; rooted on G it spans G-B-e. Both cross B, both
 * gain that fret, and with only `3-3-2` and `2-3-3` on offer both mostly fell
 * out of the five-fret window and were silently dropped — leaving the picker
 * offering the low strings and almost nothing else. The fix is more ways to
 * deal the notes, not a wider window.
 *
 * Three of these are three-string boxes; the other four spend an extra *string*
 * instead of extra frets, which is the other way to keep a high-rooted shape
 * inside the window:
 *
 *   - `3-3-2` puts the root under the first finger and reaches upward; it is
 *     the scale most people learn first.
 *   - `2-3-3` starts on the same root and reaches *back* a fret, the compact
 *     box that keeps a major scale inside four frets.
 *   - `3-2-3` is the same idea with the middle string carrying only two notes.
 *     That is exactly the deal that absorbs the B string's extra fret, which is
 *     why it is the three-string box that survives on the higher roots.
 *   - `2-3-2-1` runs across four strings and leaves the octave alone on top.
 *     Four strings buy 15 semitones of headroom against the octave's 12, so the
 *     hand never has to reach.
 *   - `1-3-3-1` is the three-notes-per-string shape: the root and its octave
 *     each get a string to themselves and the six notes between them fall three
 *     and three. The root ends up under the little finger with the run behind
 *     it, which is how most players actually take a scale from a high root.
 *   - `1-2-3-2` hangs the root alone below a seven-note box on the three
 *     strings above it. It is the deal that reaches furthest *back* behind the
 *     root, and it earns its place for exactly that: it costs no extra chip
 *     anywhere, and it pulls the lower of the two D-string offers down a fret
 *     or two, so the pair the player chooses between sits a mean of 2.9 frets
 *     apart instead of 2.2.
 *   - `1-3-2-2` is the same family again, dealt three-then-two-and-two. It is
 *     the plainest way to take a scale whose root falls under the little
 *     finger, and it is here for a blunt reason: without it there are twenty
 *     places on the neck, across sixteen keys, that a hand can reach and the
 *     picker was not offering. With it there are none.
 *
 * That last point is the standard the table is held to, and
 * `tests/fingering-hand-positions.test.ts` enforces it: for every root string
 * in every key, the picker offers the outermost places the neck can actually
 * take, never a subset chosen by which deals happened to be listed here.
 *
 * These seven are drawn from the eight distributions that can *ever* fit. An
 * exhaustive search — every way to deal eight notes across two to six adjacent
 * strings, up to eight notes on one string, rooted on each of E/A/D/G, in all
 * 24 keys — finds only `3-3-2`, `2-3-3`, `3-2-3`, `2-2-3-1`, `2-3-2-1`,
 * `1-3-2-2`, `1-2-3-2` and `1-3-3-1` inside five frets. Nothing with five notes
 * on a string, nothing on two strings, nothing on five. The one left out was
 * measured across all 24 keys rather than judged:
 *
 *   - `2-2-3-1` changes nothing at all. In every key it fits, it lands on the
 *     same fret as `2-3-2-1`: one note moves between two strings, the hand does
 *     not move. Adding it moves no count and no position, so it would be a row
 *     in this table that no player could ever see the effect of.
 *
 * `2-2-2-2`, the two-notes-per-string spread, is absent because it never fits:
 * two diatonic notes cover one or two frets while a string change buys five
 * semitones, so the shape walks backwards down the neck faster than the scale
 * climbs it, and it spans 5 to 7 frets in every key.
 */
const SHAPES: readonly { id: string; label: string; perString: readonly number[] }[] = [
  { id: "3-3-2", label: "reaching up", perString: [3, 3, 2] },
  { id: "2-3-3", label: "compact box", perString: [2, 3, 3] },
  { id: "3-2-3", label: "two on the middle string", perString: [3, 2, 3] },
  { id: "2-3-2-1", label: "four-string spread", perString: [2, 3, 2, 1] },
  { id: "1-3-3-1", label: "three notes per string", perString: [1, 3, 3, 1] },
  { id: "1-2-3-2", label: "reaching back", perString: [1, 2, 3, 2] },
  { id: "1-3-2-2", label: "under the little finger", perString: [1, 3, 2, 2] },
];

/**
 * Strings a shape may be rooted on.
 *
 * Not the B or high e: an octave rooted there runs off the top of the neck.
 *
 * How much of the key set each of these four can actually serve is decided
 * elsewhere and cannot be argued with here. The low root has to *be* on the
 * root string, so the string's open pitch cannot be above it, and the run's
 * tonic lives in the fixed one-octave register `LOWEST_TONIC_MIDI` opens
 * (`music/keys.ts`) — C3 up to B3. Counting tonics inside that register:
 *
 *   - the low E and A strings can carry every key — though on the low E the
 *     root runs from fret 8 to fret 19, so the highest keys are past
 *     {@link MAX_FRET} and are simply not offered there;
 *   - the D string (open D3) can carry the ten tonics from D up, so 20 of the
 *     24 keys;
 *   - the G string (open G3) can carry five, G through B, so 10 keys — with the
 *     root inside the first four frets, which is why a key never has more than a
 *     couple of G-rooted places to stand.
 *
 * No shape table can widen that. Adding deals fills in the keys that *can* take
 * a high root and were being dropped by the five-fret filter; it does not, and
 * cannot, reach the keys whose octave starts below the string.
 */
const ROOT_STRINGS: readonly number[] = [0, 1, 2, 3];

/**
 * How many offers one root string may contribute to the picker.
 *
 * The chip row is a neck map, not a fingering seminar. Two offers on a string
 * are a real choice — down here or up there — and a third is a variation on one
 * of them. With six distributions and four root strings the unfiltered list
 * reaches eleven chips in a key, and nine even after same-place shapes are
 * collapsed; this holds the worst case at eight and the observed worst case at
 * six, which is exactly where it was before.
 *
 * Never below 2. One offer per string is not a choice, which is the only thing
 * the picker is for.
 */
const OFFERS_PER_ROOT_STRING = 2;

function buildShape(
  laneNotes: readonly number[],
  startString: number,
  perString: readonly number[]
): FretPosition[] | null {
  const positions: FretPosition[] = [];
  let note = 0;

  for (let s = 0; s < perString.length; s += 1) {
    const stringIndex = startString + s;
    const open = OPEN_STRING_MIDI[stringIndex];
    if (open === undefined) return null;

    for (let n = 0; n < (perString[s] ?? 0); n += 1) {
      const midi = laneNotes[note];
      if (midi === undefined) return null;
      const fret = midi - open;
      // A negative fret is off the end of the neck; a very high one is not a
      // shape anyone would suggest. Either way the shape is simply not offered.
      if (fret < 0 || fret > MAX_FRET) return null;
      positions.push({ stringIndex, fret });
      note += 1;
    }
  }

  return note === laneNotes.length ? positions : null;
}

/**
 * A shape that fits, before the picker decides whether it is worth offering.
 *
 * The ranking fields are wrapped around the fingering rather than mixed into
 * it: they are how this module chooses, and no caller should be able to read
 * "this was the third-listed deal" off a fingering it was handed.
 */
type Candidate = {
  fingering: Fingering;
  /** Index into {@link SHAPES}. Breaks ties in favour of the more familiar deal. */
  rank: number;
  /** Frets from the first finger to the fourth. Smaller is easier to hold. */
  span: number;
};

/**
 * Every shape that physically fits this key, before thinning.
 *
 * "Fits" means: on the neck, and inside one five-fret window.
 */
function candidatesForKey(key: RunKey): Candidate[] {
  const laneNotes = laneMidiNotes(key);
  const candidates: Candidate[] = [];

  for (const rootString of ROOT_STRINGS) {
    for (let rank = 0; rank < SHAPES.length; rank += 1) {
      const shape = SHAPES[rank];
      if (!shape) continue;
      const positions = buildShape(laneNotes, rootString, shape.perString);
      if (!positions) continue;

      const frets = positions.map((position) => position.fret);
      const lowestFret = Math.min(...frets);
      const highestFret = Math.max(...frets);
      // The hand must not have to travel: an eight-note scale that spans more
      // than one position is exactly the thing this rework exists to remove.
      if (highestFret - lowestFret > DIAGRAM_FRETS - 1) continue;

      candidates.push({
        fingering: {
          id: `${STRING_NAMES[rootString]}-${shape.id}`,
          label: `Root on the ${STRING_NAMES[rootString]} string, ${shape.label} — frets ${lowestFret}–${highestFret}`,
          positions,
          lowestFret,
          highestFret,
          rootString,
          windowStartFret: Math.max(0, Math.min(lowestFret, MAX_FRET - (DIAGRAM_FRETS - 1))),
        },
        rank,
        span: highestFret - lowestFret,
      });
    }
  }

  return candidates;
}

/**
 * The shapes offered for this key, low position first.
 *
 * Sorting by position is what turns the list into a neck map — the first chip
 * is the lowest place to play this octave, the last is the highest.
 *
 * Not every shape that fits is worth a chip. The question the picker asks is
 * *where on the neck do I want to practise this*, so the answer is a set of
 * places, and two shapes that put the hand in the same place are one answer
 * however differently they finger it. Two rules thin the list to places:
 *
 *   1. **One offer per hand position.** A position is a root string and the
 *      fret the first finger sits at, so `(rootString, lowestFret)` is its
 *      identity. Where several deals land on the same position the tightest
 *      one wins, then the more familiar one — the player gets the easiest way
 *      to hold that place, not three ways.
 *
 *   2. **At most {@link OFFERS_PER_ROOT_STRING} offers per root string**, and
 *      when a string has more it keeps the lowest and the highest. Those are
 *      the two that are genuinely far apart; the ones in between are a fret or
 *      two from a neighbour, which is a wall of near-identical diagrams rather
 *      than a choice.
 *
 * The thinning is deliberately blind to *which* string it is thinning. It is
 * not a quota that props up the D and G strings — those gained ground purely
 * because {@link SHAPES} now contains deals they can fit, and where the neck
 * cannot take a high root no rule here invents one.
 */
export function fingeringsForKey(key: RunKey): Fingering[] {
  const byPosition = new Map<string, Candidate>();
  for (const candidate of candidatesForKey(key)) {
    const { rootString, lowestFret } = candidate.fingering;
    const position = `${rootString}:${lowestFret}`;
    const held = byPosition.get(position);
    if (
      !held ||
      candidate.span < held.span ||
      (candidate.span === held.span && candidate.rank < held.rank)
    ) {
      byPosition.set(position, candidate);
    }
  }

  const fingerings: Fingering[] = [];
  for (const rootString of ROOT_STRINGS) {
    const onString = [...byPosition.values()]
      .map((candidate) => candidate.fingering)
      .filter((fingering) => fingering.rootString === rootString)
      .sort((a, b) => a.lowestFret - b.lowestFret);
    if (onString.length <= OFFERS_PER_ROOT_STRING) {
      fingerings.push(...onString);
      continue;
    }
    // The extremes first, so the offering spans as much neck as this string
    // can, and evenly spaced places between them if the budget is ever raised.
    const step = (onString.length - 1) / Math.max(1, OFFERS_PER_ROOT_STRING - 1);
    for (let i = 0; i < OFFERS_PER_ROOT_STRING; i += 1) {
      const pick = onString[Math.round(i * step)];
      if (pick) fingerings.push(pick);
    }
  }

  if (fingerings.length === 0) {
    // Every key fits at least one shape today; if a future tuning or register
    // change breaks that, fail visibly rather than rendering an empty tablature.
    throw new Error("no playable one-octave fingering for this key");
  }

  fingerings.sort((a, b) => a.lowestFret - b.lowestFret || a.rootString - b.rootString);
  return fingerings;
}
