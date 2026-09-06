<template>
  <!-- Canonical order: Play · Favourite · Pin · Secondary action · Overflow.
       An artist has no pin and no secondary action, so those slots are simply
       absent — the remaining ones keep their places. -->
  <div class="artist-buttons header-actions">
    <PlayBtnRect :source="playSources.artist" />
    <HeartSvg btn_role="action" :state="artist.info.is_favorite" @handleFav="handleFav" />
    <button
      class="options"
      :class="{ context_menu_showing }"
      @click="showContext"
    >
      <MoreSvg />
    </button>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";

import { favType, playSources } from "@/enums";
import { showArtistContextMenu } from "@/helpers/contextMenuHandler";
import favoriteHandler from "@/helpers/favoriteHandler";
import useArtistPageStore from "@/stores/pages/artist";

import MoreSvg from "@/assets/icons/more.svg";
import HeartSvg from "@/components/shared/HeartSvg.vue";
import PlayBtnRect from "@/components/shared/PlayBtnRect.vue";

const artist = useArtistPageStore();
const context_menu_showing = ref(false);

function handleFav() {
  favoriteHandler(
    artist.info.is_favorite,
    favType.artist,
    artist.info.artisthash,
    artist.makeFavorite,
    artist.removeFavorite
  );
}

function showContext(e: MouseEvent) {
  showArtistContextMenu(
    e,
    context_menu_showing,
    artist.info.artisthash,
    artist.info.name
  );
}
</script>

<style lang="scss">
// Flex, gap and wrapping now come from `.header-actions` (Global/
// _button-classes.scss). The favourite brings its own role via `btn_role`, so
// the two rules that used to patch it from out here — the role include and the
// re-assert of the teal — are gone with it.
.artist-buttons {
  // This row was the odd one out: it never adopted the shared header-action
  // anatomy, so the overflow button kept the global button base (a box, but
  // ~36px tall next to the 44px Play CTA). It matches its album-header twin now.
  .options {
    @include btn-action;

    &.context_menu_showing {
      background-color: $darkblue;
      // Yellow accent fill while the menu is open -> pin static ink.
      //
      // On the BUTTON. This used to be `svg { color: … !important }`, which
      // said the same thing in a second dialect (the glyph is currentColor, so
      // the button reaches it) and needed an `!important` to say it. Same state,
      // same spelling as the album header now.
      color: $mem-ink;
    }
  }
}
</style>
