/**
 * GOAT rank titles, one per possible star total.
 *
 * A run earns 0 to 48 stars (16 minigames x 3), and every total has a rank.
 * Transcribed verbatim from `docs/game-design/GOATerizer_Game_Design.md` §18 —
 * these are content, not mechanics, and may be rewritten freely as long as the
 * one-title-per-star-total structure survives.
 */

export const MAX_RUN_STARS = 48;

export const GOAT_RANKS: readonly string[] = [
  "Hairless Baby Lamb",
  "Wet Hairless Baby Lamb",
  "Baby Lamb With a Guitar",
  "Lamb Who Has Heard Music",
  "Lamb With Delusions",
  "Petting-Zoo Liability",
  "Almost Technically Caprine",
  "Goat Intern",
  "Probationary Goat",
  "Discount Goat",
  "Yard Goat",
  "Tin-Can Amateur",
  "Fence-Licker",
  "Bell With Legs",
  "Junior Headbutter",
  "Goat, Unfortunately",
  "Serviceable Goat",
  "Adequate Billy",
  "Headbutt Trainee",
  "Junior Mountain Nuisance",
  "Rock-Hopper",
  "Salt-Lick Specialist",
  "Goat With a Van",
  "Goat With Chops",
  "Certified Billy Goat",
  "Swagger Goat",
  "Mean Little Bastard Goat",
  "Cliff Idiot",
  "Mountain Goat",
  "Mountain Goat With Receipts",
  "Unreasonably Competent Goat",
  "Ibex Intern",
  "Ibex",
  "Ibex With Swagger",
  "Peak Ibex",
  "Horn Technician",
  "Alpine Menace",
  "Markhor Apprentice",
  "Markhor Adjacent",
  "Discount Markhor",
  "Proper Markhor",
  "Battle Markhor",
  "Shred Markhor",
  "War Markhor",
  "GOAT Candidate",
  "Suspiciously GOATed",
  "GOATed",
  "Transcendent Markhor",
  "GOAT Markhor",
];

export function rankForStars(stars: number): string {
  const index = Math.max(0, Math.min(MAX_RUN_STARS, Math.round(stars)));
  return GOAT_RANKS[index] ?? GOAT_RANKS[0] ?? "Hairless Baby Lamb";
}
