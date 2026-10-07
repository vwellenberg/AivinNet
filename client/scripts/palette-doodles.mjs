// Colour-scheme doodles (#395): writes src/assets/images/memphis-doodles-<scheme>.svg
// from the Memphis artwork and the `doodles` colour map of each scheme in
// src/brand-colors.json.
//
//   node scripts/palette-doodles.mjs
//
// Run it after changing the Memphis doodle or a scheme's doodle map. The
// generated files are committed; paletteSchemes.test.ts fails while they differ
// from what this script would write, so a hand-edit cannot drift unnoticed.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Replaces every colour of `map` (`"#2B2733": "#1F2635"`, case-insensitive) in
 * the SVG source, both as `#RRGGBB` and URL-encoded as `%23RRGGBB`. One pass
 * over the text, so a colour that is replaced is never matched a second time —
 * a scheme may map A→B and B→C without B turning into C.
 */
export function recolorDoodle(svg, map) {
  const lookup = new Map(Object.entries(map).map(([from, to]) => [from.slice(1).toUpperCase(), to.slice(1).toUpperCase()]));
  return svg.replace(/(#|%23)([0-9a-fA-F]{6})\b/g, (whole, prefix, hex) => {
    const to = lookup.get(hex.toUpperCase());
    return to ? prefix + to : whole;
  });
}

/** `{ scheme: svgText }` for every scheme in the brand colours. */
export function schemeDoodles(memphisSvg, palettes) {
  return Object.fromEntries(Object.entries(palettes).map(([name, p]) => [name, recolorDoodle(memphisSvg, p.doodles)]));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = new URL("..", import.meta.url);
  const images = new URL("src/assets/images/", root);
  const memphis = readFileSync(new URL("memphis-doodles.svg", images), "utf-8");
  const { palettes } = JSON.parse(readFileSync(new URL("src/brand-colors.json", root), "utf-8"));
  for (const [name, svg] of Object.entries(schemeDoodles(memphis, palettes))) {
    const file = new URL(`memphis-doodles-${name}.svg`, images);
    writeFileSync(file, svg);
    console.log("wrote", fileURLToPath(file));
  }
}
