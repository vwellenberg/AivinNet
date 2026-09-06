import listToRgbString from "./listToRgbString";
import { darkenHex } from "./index";

export interface SwatchLite {
  rgb: number[];
  hsl: number[]; // [h, s, l] each 0..1
  pop: number;
}

const SWATCH_NAMES = [
  "Vibrant",
  "DarkVibrant",
  "LightVibrant",
  "Muted",
  "DarkMuted",
  "LightMuted",
];

export function collectSwatches(palette: any): SwatchLite[] {
  const out: SwatchLite[] = [];
  for (const name of SWATCH_NAMES) {
    const sw = palette[name];
    if (sw) {
      out.push({ rgb: sw.getRgb(), hsl: sw.getHsl(), pop: sw.getPopulation() });
    }
  }
  return out;
}

/**
 * Score used to pick the *dominant* colour (Spotify-style), NOT the most
 * saturated one. Population dominates so a big earthy tone wins over a tiny
 * vivid accent, but a mild saturation factor breaks ties toward the more
 * colourful option and away from near-greys.
 */
export function dominance(s: SwatchLite): number {
  const sat = s.hsl[1];
  const satFactor = 0.35 + 0.65 * Math.min(1, sat / 0.5);
  return s.pop * satFactor;
}

/**
 * Dominant *coloured* swatch of a cover, darkened to the same Spotify-style
 * page-gradient base used by the Album/Playlist headers.
 *
 * Unlike setColorsToStore (which falls back to grey swatches so a greyscale
 * album still gets *some* tint), this returns `''` when the cover has no colour
 * to tint with — a genuinely greyscale cover or the no-cover placeholder. The
 * Now Playing page uses that empty result to fall back to the brand green.
 */
export function dominantColoredBg(palette: any): string {
  const colored = collectSwatches(palette).filter((s) => s.hsl[1] >= 0.15);
  if (!colored.length) return "";
  const primary = [...colored].sort((a, b) => dominance(b) - dominance(a))[0];
  return darkenHex(listToRgbString(primary.rgb), 16);
}
