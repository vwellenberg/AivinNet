import { defineStore } from "pinia";
import Vibrant from "node-vibrant";
import listToRgbString from "@/utils/colortools/listToRgbString";
import { dominantColoredBg } from "@/utils/colortools/swatches";

async function getImageColor(url: string) {
  const vibrant = new Vibrant(url);

  const palette = await vibrant.getPalette();
  const lightvibrant = listToRgbString(palette.LightVibrant?.getRgb()) || "";
  const darkvibrant = listToRgbString(palette.Muted?.getRgb()) || "";
  // Dominant cover colour, darkened to the Album/Playlist gradient base. '' when
  // the cover has no colour to tint with (greyscale / no-cover placeholder), so
  // the Now Playing page can fall back to the brand green.
  const bg = dominantColoredBg(palette);

  return { lightvibrant, darkvibrant, bg };
}

export default defineStore("SwingMusicColors", {
  state: () => ({
    theme1: "",
    theme2: "",
    bg: "",
  }),
  actions: {
    async setTheme1Color(url: string) {
      const { lightvibrant, darkvibrant, bg } = await getImageColor(url);
      this.theme1 = lightvibrant;
      this.theme2 = darkvibrant;
      this.bg = bg;
    },
  },
  persist: true,
});
