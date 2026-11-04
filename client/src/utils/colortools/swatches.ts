import type { Vibrant } from "node-vibrant/browser";
import listToRgbString from "./listToRgbString";
import { darkenHex } from "./index";

/**
 * node-vibrant's palette, derived from its own API (the package exports no
 * `Palette` type from its browser entry). Typed, so the next accessor change
 * fails the typecheck: v4 turned `getRgb()`/`getHsl()`/`getPopulation()` into
 * the getters `rgb`/`hsl`/`population`, and with `palette: any` the colours
 * broke silently at runtime while every test, mocked, stayed green.
 */
export type VibrantPalette = Awaited<ReturnType<ReturnType<typeof Vibrant.from>["getPalette"]>>;

export interface SwatchLite {
  rgb: number[];
  hsl: number[]; // [h, s, l] each 0..1
  pop: number;
}

const SWATCH_NAMES: (keyof VibrantPalette)[] = [
  "Vibrant",
  "DarkVibrant",
  "LightVibrant",
  "Muted",
  "DarkMuted",
  "LightMuted",
];

export function collectSwatches(palette: VibrantPalette): SwatchLite[] {
  const out: SwatchLite[] = [];
  for (const name of SWATCH_NAMES) {
    const sw = palette[name];
    if (sw) {
      out.push({ rgb: sw.rgb, hsl: sw.hsl, pop: sw.population });
    }
  }
  return out;
}

/**
 * Score used to pick the *dominant* colour, NOT the most
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
 * Dominant *coloured* swatch of a cover, darkened to the same
 * page-gradient base used by the Album/Playlist headers.
 *
 * Unlike setColorsToStore (which falls back to grey swatches so a greyscale
 * album still gets *some* tint), this returns `''` when the cover has no colour
 * to tint with — a genuinely greyscale cover or the no-cover placeholder. The
 * Now Playing page uses that empty result to fall back to the brand green.
 */
export function dominantColoredBg(palette: VibrantPalette): string {
  const colored = collectSwatches(palette).filter((s) => s.hsl[1] >= 0.15);
  if (!colored.length) return "";
  const primary = [...colored].sort((a, b) => dominance(b) - dominance(a))[0];
  return darkenHex(listToRgbString(primary.rgb), 16);
}
