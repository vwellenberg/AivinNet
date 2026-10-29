
import { brightness } from "@nextcss/color-tools";
import rgb2Hex from "./rgb2Hex";
import { parseColor } from "./index";

const HEX3 = /^#?([0-9a-f])([0-9a-f])([0-9a-f])$/i;
const HEX6 = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i;
const HEX8 = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i;

/**
 * Port of `colorShift` from @nextcss/color-tools 1.x, kept verbatim: 2.x dropped
 * the function, and its `rgbColorShift` replacement differs by one channel unit
 * in about 0.4 % of cases (rounding), which would change the page colours.
 * Positive amounts darken, negative amounts lighten. Alpha is carried through
 * in the same percent-based form v1 used. Unparseable input yields `undefined`.
 */
export function colorShift(hex: string, amount: number): string | undefined {
  const match = hex.match(HEX3) || hex.match(HEX6) || hex.match(HEX8);
  if (!match) return undefined;

  const channels = match.slice(1).map((part, i) => {
    const value = parseInt(part.padStart(2, part), 16);
    return i === 3 ? Math.round((value / 255) * 100) : value;
  });

  const o = amount / 100;
  const shifted = channels.map((t, i) => {
    if (i >= 3) return t;
    const x = o < 0 ? t + (255 - t) * Math.abs(o) : t - t * o;
    return Math.min(Math.max(Math.round(x), 0), 255);
  });

  return (
    "#" +
    shifted
      .map((t, i) => (i === 3 ? Math.round((t / 100) * 255) : t).toString(16).padStart(2, "0"))
      .join("")
  );
}

/**
 * Shifts a color by a multiplier to get a lighter or darker color.
 * @param color rgb color
 * @param multipliers Two multipliers for the shift. First one is used when the color is light (positive), and the other when color is dark (negative)
 */
export function getShift(color: string, multipliers: number[]) {
  if (!color) return "";

  color = rgb2Hex(color);
  // `undefined` (unparseable) compares false, exactly as the v1 API behaved.
  const is_light = (brightness(color) ?? 0) > 50;

  return is_light
    ? colorShift(color, multipliers[0])
    : colorShift(color, multipliers[1]);
}

/**
 * Returns a readable text colour for the given background: white on dark
 * backgrounds, near-black on light ones. Uses relative luminance instead of
 * hue-shifting the colour, so it never produces a tinted (e.g. blue) text.
 * Accepts both `rgb(r,g,b)` and `#rrggbb` inputs.
 */
export function getTextColor(color: string) {
  if (!color) return "";
  const [r, g, b] = parseColor(color);
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return luminance < 0.55 ? "#ffffff" : "#0a0a0a";
}

export function getBackgroundColor(color: string) {
  return getShift(color, [-50, 50]);
}

// TODO: Support more levels of brightness. ie. slightly light, light, slightly dark, dark
export function addOpacity(rgbString: string, opacity = 1) {
  // Remove spaces and match RGB values
  const rgbValues = rgbString.replace(/\s/g, '').match(/^rgb\((\d+),(\d+),(\d+)\)$/);
  
  if (!rgbValues) {
      throw new Error('Invalid RGB string format. Expected format: rgb(r,g,b)');
  }
  
  // Convert opacity to a value between 0 and 1
  const validOpacity = Math.max(0, Math.min(1, opacity));
  
  return `rgba(${rgbValues[1]}, ${rgbValues[2]}, ${rgbValues[3]}, ${validOpacity})`;
}