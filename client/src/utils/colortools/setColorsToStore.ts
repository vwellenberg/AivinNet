import Vibrant from "node-vibrant";
import listToRgbString from "./listToRgbString";
import { darkenHex } from "./index";
import { collectSwatches, dominance } from "./swatches";

/**
 * Assigns `colors.bg`, `colors.bg2` and `colors.btn` on the store.
 *
 * Background used to be node-vibrant's `DarkMuted` swatch (grey) and was
 * then briefly the *most saturated* swatch (which over-picked tiny vivid
 * accents). We now pick the *dominant* coloured swatch and darken it, so the
 * gradient matches the cover's overall feel like Spotify.
 *
 * @param store - The store object to assign the color values to.
 * @param img_url - The URL of the image to extract colors from.
 * @param btn_only - If true, only assign the `colors.btn` property.
 */
export default (store: any, img_url: string, btn_only: boolean = false) => {
  // Supersede any in-flight extraction for this store. Several lifecycle
  // hooks can call this in quick succession; without a token the async
  // results race and the page colour flips randomly between reloads.
  // Only the most recently started call is allowed to write.
  const token = (store._colorToken || 0) + 1;
  store._colorToken = token;

  const vibrant = new Vibrant(img_url);

  vibrant
    .getPalette()
    .then((palette) => {
    if (store._colorToken !== token) return; // a newer call took over

    const swatches = collectSwatches(palette);

    // Button: a bright, punchy colour.
    store.colors.btn =
      listToRgbString(
        palette.LightVibrant?.getRgb() ||
          palette.Vibrant?.getRgb() ||
          palette.DarkVibrant?.getRgb()
      ) || "";

    if (btn_only) return;

    if (!swatches.length) {
      store.colors.bg = "";
      store.colors.bg2 = "";
      return;
    }

    // Prefer the dominant *coloured* swatch — but only when colour actually
    // carries a meaningful share of the cover. A near-monochrome cover (e.g.
    // a b/w photo with a slight olive tint) still yields one saturated
    // Vibrant swatch; picking it (and then boosting it for the gradient top)
    // painted a loud colour behind a grey cover. Below the share threshold
    // the cover counts as greyscale and the dominant grey wins.
    const total = swatches.reduce((sum, s) => sum + dominance(s), 0);
    const colored = swatches.filter((s) => s.hsl[1] >= 0.15);
    const coloredShare = total > 0 ? colored.reduce((sum, s) => sum + dominance(s), 0) / total : 0;

    const pool = colored.length && coloredShare >= 0.25 ? colored : swatches;
    const primary = [...pool].sort((a, b) => dominance(b) - dominance(a))[0];

    // The BASE tone is the cover's population-weighted average colour — for
    // a mostly dark cover that is a dark tone, and dark is fine (Spotify).
    // The dominant coloured swatch may only TINT that base as much as its
    // actual share of the artwork: a niche saturated cluster (the maroon
    // frame of an otherwise dark beige cover) no longer takes over the page.
    const totalPop = swatches.reduce((sum, s) => sum + s.pop, 0);
    const accentWeight = Math.min(0.6, coloredShare);
    const blended =
      totalPop > 0
        ? primary.rgb.map((v, i) => {
            const avg = swatches.reduce((sum, s) => sum + s.rgb[i] * s.pop, 0) / totalPop;
            return Math.round(avg * (1 - accentWeight) + v * accentWeight);
          })
        : primary.rgb;

    // bg/bg2 are the dark, Spotify-style gradient colours (same hue, two
    // lightness levels). Darkening here keeps the gradient and the header
    // text colour (which is derived from bg) perfectly in sync.
    const primaryRgb = listToRgbString(blended);
    store.colors.bg = darkenHex(primaryRgb, 16);
    store.colors.bg2 = darkenHex(primaryRgb, 12);
    })
    .catch(() => {
      // Image failed to load/decode — leave whatever colours are set.
    });
};
