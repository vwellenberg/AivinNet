
// @ts-ignore
import { colorShift, brightness } from "@nextcss/color-tools";
import rgb2Hex from "./rgb2Hex";
import { parseColor } from "./index";

/**
 * Shifts a color by a multiplier to get a lighter or darker color.
 * @param color rgb color
 * @param multipliers Two multipliers for the shift. First one is used when the color is light (positive), and the other when color is dark (negative)
 */
export function getShift(color: string, multipliers: number[]) {
  if (!color) return "";

  color = rgb2Hex(color);
  const is_light = brightness(color) > 50;

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