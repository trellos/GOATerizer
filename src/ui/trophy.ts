/**
 * The trophy shelf's glyphs.
 *
 * PROTOTYPE. See `docs/game-design/PROPOSED_Timeline_Actors.md` §7.
 *
 * One trophy per *passed* minigame, on the shelf where the star history used to
 * show `★★★`. The rule the design settled on, and the reason for it:
 *
 *   - **Size is full at one star and never varies.** The shelf records results.
 *     Consistency was already carried, live and at full size, by the actor on
 *     the timeline during play; a row of trophies in three sizes would be the
 *     same information a second time, smaller and harder to read.
 *   - **Star count buys ornament, not mass.** Nothing at one star, horns at two,
 *     a crown at three. Sixteen slots at a glance then answer "how many did I
 *     clear" by count and "how well" by silhouette, which a glyph count of
 *     `★`, `★★`, `★★★` at 1.5rem never did.
 *
 * These are the *trophy's* ornaments, earned per attempt from the star tier.
 * They are deliberately not the live actor's decorations, which come from an
 * unbroken streak and vanish with it (`actor-layer.ts`). Two systems, two
 * shapes, no shared art.
 *
 * Drawn as inline SVG in `currentColor` so the shelf's existing state colours —
 * gold for a pass, red for a failed slot — keep applying without this module
 * knowing about them.
 */

/**
 * The goat bust every trophy is built on: plinth, stem, ears, skull, muzzle,
 * beard. Drawn front-on — at shelf size only the silhouette survives, and a
 * head facing the player is the one silhouette that reads as a face.
 */
const BUST = `
  <rect x="4" y="19.6" width="16" height="2.8" rx="0.6" />
  <rect x="6.4" y="17.4" width="11.2" height="2.2" rx="0.5" opacity="0.7" />
  <rect x="10.6" y="14" width="2.8" height="3.6" />
  <ellipse cx="7.9" cy="9.6" rx="1.9" ry="1.1" transform="rotate(-18 7.9 9.6)" />
  <ellipse cx="16.1" cy="9.6" rx="1.9" ry="1.1" transform="rotate(18 16.1 9.6)" />
  <ellipse cx="12" cy="9.2" rx="3.3" ry="3.1" />
  <path d="M9.5 10.6h5l-0.7 3.2a1.9 1.9 0 0 1-3.6 0z" />
  <path d="M12 13.9l1.4 0.5-1.4 3.1-1.4-3.1z" />
`;

/** Two horns sweeping back over the skull. Two stars and up. */
const HORNS = `
  <path d="M9.6 6.6C8.1 5 6 4.7 4.6 5.9c1.6 0.1 3 0.9 4 2.3z" />
  <path d="M14.4 6.6C15.9 5 18 4.7 19.4 5.9c-1.6 0.1-3 0.9-4 2.3z" />
`;

/** A crown, for a perfect attempt and nothing less. */
const CROWN = `
  <path d="M8.6 5.4L9.6 2.4l2.4 1.9 2.4-1.9 1 3v0.9H8.6z" />
`;

/**
 * One trophy, as an SVG string.
 *
 * @param stars 1, 2 or 3. Anything else returns empty — a slot with no stars
 * has no trophy, because the shelf is a record of what was *passed*.
 */
export function trophySvg(stars: number): string {
  if (stars < 1) return "";
  const ornament = (stars >= 2 ? HORNS : "") + (stars >= 3 ? CROWN : "");
  // `data-tier` is what the browser validation suite reads: asserting on a
  // number beats asserting on which SVG paths are present.
  return (
    `<svg class="trophy" viewBox="0 0 24 24" width="100%" height="100%" ` +
    `fill="currentColor" data-tier="${stars}" aria-hidden="true">${ornament}${BUST}</svg>`
  );
}

/** What a screen reader is told a slot holds. */
export function trophyLabel(stars: number): string {
  if (stars < 1) return "failed";
  if (stars === 1) return "trophy";
  return stars === 2 ? "trophy with horns" : "crowned trophy";
}
