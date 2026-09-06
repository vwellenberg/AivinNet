<template>
  <!-- Canonical order: Play · Favourite · Pin · Secondary action · Overflow.
       `header-actions` is the row's shared anatomy (flex, gap, wrap, stagger);
       `album-buttons` only scopes what is peculiar to THIS header. -->
  <div class="album-buttons header-actions">
    <PlayBtnRect :source="playSources.album" />

    <HeartSvg btn_role="action" :state="album.is_favorite" @handleFav="handleFav" />
    <PinButton :pinned="album.is_pinned" @toggle="handlePin" />
    <!-- The title is NOT "Find cover online": that names the manual gallery in
         the context menu, where you pick from suggestions. This button searches
         and decides on its own, and only accepts a verified match. -->
    <button
      v-if="auth.is_admin"
      class="mb-cover"
      :class="{ loading: mbLoading }"
      :title="mbLoading ? 'Loading…' : 'Fetch cover automatically'"
      :disabled="mbLoading"
      @click.prevent="fetchCover"
    >
      <!-- A magnifier, not the download glyph. This button SEARCHES for a
           cover; "Download as ZIP" wears the download glyph in the playlist
           header and in this album's own context menu. One glyph for two
           unrelated actions is a trap, and the context menu already uses the
           magnifier for exactly this action. -->
      <SearchSvg />
    </button>
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
import useAuth from "@/stores/auth";

import MoreSvg from "@/assets/icons/more.svg";
import SearchSvg from "@/assets/icons/search.svg";
import PinButton from "@/components/shared/PinButton.vue";
import HeartSvg from "@/components/shared/HeartSvg.vue";
import PlayBtnRect from "@/components/shared/PlayBtnRect.vue";
import favoriteHandler from "@/helpers/favoriteHandler";
import { toggleAlbumPin } from "@/helpers/pinAlbum";
import { showAlbumContextMenu } from "@/helpers/contextMenuHandler";
import { fetchCoverFromMusicBrainz } from "@/requests/musicbrainz";
import { NotifType, Notification } from "@/stores/notification";

const store = useAlbumStore();
const auth = useAuth();
const { info: album } = storeToRefs(store);

const context_menu_showing = ref(false);
const mbLoading = ref(false);

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

async function fetchCover() {
  if (mbLoading.value) return;
  mbLoading.value = true;
  try {
    const res = await fetchCoverFromMusicBrainz(album.value.albumhash);
    if (res.success) {
      store.bumpCoverVersion();
      new Notification("Cover found", NotifType.Success);
    } else {
      new Notification(
        res.error || "No cover found online",
        NotifType.Error
      );
    }
  } finally {
    mbLoading.value = false;
  }
}
</script>

<style lang="scss">
// Flex, gap and wrapping now come from `.header-actions` (Global/
// _button-classes.scss). What is left here is what only this header has.
.album-buttons {
  .options,
  .mb-cover {
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

  .mb-cover {
    &:disabled { cursor: default; }
    &.loading svg { animation: mb-cover-spin 1s linear infinite; }
  }
}

@keyframes mb-cover-spin {
  to { transform: rotate(360deg); }
}
</style>
