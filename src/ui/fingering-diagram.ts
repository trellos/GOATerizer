/**
 * The little neck diagram next to each suggested fingering.
 *
 * Its whole job is to answer one question before the run starts: *where on the
 * neck am I about to play this?* A five-fret window is enough to answer it —
 * every shape `fingeringsForKey` offers fits in one — and small enough that all
 * the offers sit side by side and can be compared at a glance.
 *
 * Drawn in SVG rather than on a canvas so it stays crisp at any zoom, and in
 * `currentColor` rather than fixed hues so a selected chip (dark ink on the
 * accent) reads as well as an unselected one.
 */

import { DIAGRAM_FRETS, STRING_NAMES, type Fingering } from "../music/fingering.js";

const SVG_NS = "http://www.w3.org/2000/svg";

/** Geometry, in the diagram's own user units. */
const CELL_W = 17;
const ROW_H = 9;
const LEFT = 13;
const TOP = 7;
const BOTTOM = 12;
const RIGHT = 5;
const STRING_COUNT = STRING_NAMES.length;

const WIDTH = LEFT + CELL_W * DIAGRAM_FRETS + RIGHT;
const HEIGHT = TOP + ROW_H * (STRING_COUNT - 1) + BOTTOM;

function el<K extends keyof SVGElementTagNameMap>(
  name: K,
  attrs: Record<string, string | number>
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  return node;
}

/** Low E at the bottom, as tablature has always written it. */
function stringY(stringIndex: number): number {
  return TOP + (STRING_COUNT - 1 - stringIndex) * ROW_H;
}

/**
 * Renders one fingering as a five-fret neck diagram.
 *
 * The window starts at the shape's lowest fret, except that fret 0 is the open
 * string rather than a fret: an open-position shape shows the nut and hangs its
 * open notes off the left of it, exactly as a chord box does.
 */
export function renderFingeringDiagram(fingering: Fingering): SVGSVGElement {
  const firstFret = Math.max(1, fingering.windowStartFret);
  const svg = el("svg", {
    class: "fret-diagram",
    viewBox: `0 0 ${WIDTH} ${HEIGHT}`,
    width: WIDTH,
    height: HEIGHT,
    "aria-hidden": "true",
    focusable: "false",
  });

  // Fret wires. The nut — the wire before fret 1 — is drawn heavy, which is
  // what tells the eye "this is the end of the neck" without a label.
  for (let i = 0; i <= DIAGRAM_FRETS; i += 1) {
    const x = LEFT + i * CELL_W;
    const isNut = i === 0 && firstFret === 1;
    svg.append(
      el("line", {
        x1: x,
        y1: TOP,
        x2: x,
        y2: stringY(0),
        stroke: "currentColor",
        "stroke-width": isNut ? 2.4 : 0.8,
        "stroke-opacity": isNut ? 0.75 : 0.3,
      })
    );
  }

  for (let s = 0; s < STRING_COUNT; s += 1) {
    svg.append(
      el("line", {
        x1: LEFT,
        y1: stringY(s),
        x2: LEFT + CELL_W * DIAGRAM_FRETS,
        y2: stringY(s),
        stroke: "currentColor",
        "stroke-width": 0.7,
        "stroke-opacity": 0.34,
      })
    );
  }

  // The lane the note occupies decides its weight: the two roots are the
  // landmarks the player navigates by, so they are solid and everything else
  // is a quieter dot.
  fingering.positions.forEach((position, lane) => {
    const isRoot = lane === 0 || lane === fingering.positions.length - 1;
    const y = stringY(position.stringIndex);

    if (position.fret === 0) {
      svg.append(
        el("circle", {
          cx: LEFT - 6,
          cy: y,
          r: 2.6,
          fill: "none",
          stroke: "currentColor",
          "stroke-width": isRoot ? 1.6 : 1,
          "stroke-opacity": isRoot ? 1 : 0.6,
        })
      );
      return;
    }

    svg.append(
      el("circle", {
        cx: LEFT + (position.fret - firstFret + 0.5) * CELL_W,
        cy: y,
        r: isRoot ? 3.6 : 2.8,
        fill: "currentColor",
        "fill-opacity": isRoot ? 1 : 0.55,
      })
    );
  });

  // The position marker. Without it every diagram in the row looks the same,
  // which is precisely the information the player is choosing between.
  const marker = el("text", {
    x: LEFT + CELL_W / 2,
    y: HEIGHT - 3,
    "text-anchor": "middle",
    "font-size": 9,
    fill: "currentColor",
    "fill-opacity": 0.85,
  });
  marker.textContent = String(firstFret);
  svg.append(marker);

  return svg;
}
