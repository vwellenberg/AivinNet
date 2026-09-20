<template>
  <!-- Canonical order: Play · Favourite · Pin · Secondary action · Overflow.
       `header-actions` is the row's shared anatomy (flex, gap, wrap, stagger);
       `album-buttons` only scopes what is peculiar to THIS header. -->
  <div class="album-buttons header-actions">
    <PlayBtnRect :source="playSources.album" />

    <HeartSvg btn_role="action" :state="album.is_favorite" @handleFav="handleFav" />
    <PinButton :pinned="album.is_pinned" @toggle="handlePin" />
    <!-- No secondary action here. Fetching a cover automatically used to sit in
         this row as a magnifier, next to a magnifier in the overflow menu that
         did something else ("Find cover online" = pick from a gallery). Two
         magnifiers, one row apart, for two different actions is a coin toss —
         both now live in the menu, where their labels can say which is which. -->
    <button
      class="options"
      :class="{ context_menu_showing }"
      @click.prevent="showContextMenu"
    >
      <MoreSvg />
    </button>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { storeToRefs } from "pinia";

import { favType, playSources } from "@/enums";
import useAlbumStore from "@/stores/pages/album";

import MoreSvg from "@/assets/icons/more.svg";
import PinButton from "@/components/shared/PinButton.vue";
import HeartSvg from "@/components/shared/HeartSvg.vue";
import PlayBtnRect from "@/components/shared/PlayBtnRect.vue";
import favoriteHandler from "@/helpers/favoriteHandler";
import { toggleAlbumPin } from "@/helpers/pinAlbum";
import { showAlbumContextMenu } from "@/helpers/contextMenuHandler";

const store = useAlbumStore();
const { info: album } = storeToRefs(store);

const context_menu_showing = ref(false);

function showContextMenu(e: MouseEvent) {
  showAlbumContextMenu(e, context_menu_showing);
}

function handleFav() {
  favoriteHandler(
    album.value.is_favorite,
    favType.album,
    album.value.albumhash,
    store.makeFavorite,
    store.removeFavorite
  );
}

function handlePin() {
  toggleAlbumPin(album.value);
}

</script>

<style lang="scss">
// Flex, gap and wrapping now come from `.header-actions` (Global/
// _button-classes.scss). What is left here is what only this header has.
.album-buttons {
  .options {
    @include btn-action;
  }

  .options {
    &.context_menu_showing {
      background-color: $darkblue;
      // Yellow accent fill while the menu is open -> pin static ink.
      //
      // On the BUTTON, not on `svg { color: … !important }`. The glyph is
      // currentColor, so the button is where the state belongs, and the artist
      // header (the only other overflow button) writes it the same way. Two
      // spellings of one state is how they drift apart.
      color: $mem-ink;
    }
  }
}
</style>
