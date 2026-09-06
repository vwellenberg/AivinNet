<template>
  <!-- Reading order, top to bottom — the same order the album header uses.
       This block used to be written BACKWARDS (buttons first, type label last)
       and flipped with `flex-direction: column-reverse`, purely to pin it to
       the bottom of the header. `justify-content: flex-end` does that without
       making the markup lie about what comes first. -->
  <div class="playlist-info dh-body">
    <div class="type dh-type">Playlist</div>
    <!-- One line, ellipsed — no `balanceText` any more. Balancing a title over
         two lines made sense while the head was 18rem of free space; inside the
         plate every extra line pushes the whole head taller (measured: 289px
         against 221px for a one-line title) and stretches the media cell into a
         portrait crop with it. Same decision the Now-Playing source plate made
         for the same reason. -->
    <div class="title dh-title ellip" :title="playlist.info.name">{{ playlist.info.name }}</div>
    <!-- One meta line. "Last updated" used to be an absolutely positioned box
         in the header's bottom-right corner, which is why it kept colliding
         with the action row on small screens; it is part of the meta now. -->
    <div class="duration dh-meta">
      {{ playlist.info.count.toLocaleString() + ` ${playlist.info.count == 1 ? "Track" : "Tracks"}` }}
      •
      {{ formatSeconds(playlist.info.duration, true) }}
      <LastUpdated />
    </div>
    <!-- Canonical order: Play · Favourite · Pin · Secondary action · Overflow.
         A playlist has no favourite, so that slot is absent and the rest keep
         their places. It used to be play → download → pin, which put the
         secondary action ahead of the pin. -->
    <div class="btns header-actions">
      <PlayBtnRect :source="playSources.playlist" />
      <PinButton
        v-if="Number.isInteger(playlist.info.id)"
        :pinned="playlist.info.pinned"
        @toggle="pinPlaylist(playlist.info.id)"
      />
      <button class="download-btn" @click="downloadPlaylist" title="Download as ZIP">
        <span v-html="DownloadIcon" class="icon"></span>
      </button>
      <!-- Edit and Delete used to sit in `.last-updated`, an absolutely
           positioned box in the header's bottom-right corner. On a phone the
           status text hides and that box lands NEXT TO this row without being
           part of it: measured 4px higher than its neighbours and 30px away
           instead of the row's 8px. They are overflow actions, so they go where
           the album and artist headers put theirs. -->
      <button
        v-if="Number.isInteger(playlist.info.id)"
        class="options"
        :class="{ context_menu_showing }"
        title="More options"
        @click.prevent="showContextMenu"
      >
        <MoreSvg />
      </button>
    </div>
  </div>
</template>
<script setup lang="ts">
import { playSources } from "@/enums";
import { formatSeconds } from "@/utils";
import { getBaseUrl, paths } from "@/config";
import { DownloadIcon } from "@/icons";

import MoreSvg from "@/assets/icons/more.svg";
import LastUpdated from "./LastUpdated.vue";
import PlayBtnRect from "@/components/shared/PlayBtnRect.vue";
import PinButton from "@/components/shared/PinButton.vue";
import usePStore from "@/stores/pages/playlist";
import { showPlaylistContextMenu } from "@/helpers/contextMenuHandler";
import { togglePlaylistPin } from "@/helpers/pinPlaylist";
import { ref } from "vue";

const playlist = usePStore();

const context_menu_showing = ref(false);

function showContextMenu(e: MouseEvent) {
  // `on_page`: this menu is the page's own header, so it may offer Edit.
  showPlaylistContextMenu(e, playlist.info, context_menu_showing, true);
}

function downloadPlaylist() {
    const a = document.createElement('a')
    a.href = getBaseUrl() + paths.api.download + `/playlist/${playlist.info.id}`
    a.click()
}

function pinPlaylist(pid: number) {
  // Shared helper keeps the sidebar list + this page in sync.
  togglePlaylistPin(pid);
}
</script>

<style lang="scss">
// Type, title and meta sizes come from `.dh-type` / `.dh-title` / `.dh-meta`
// in the shared anatomy (Global/detail-head.scss). The ground halos went with
// them: they existed because this text stood free on the doodle ground, and it
// now stands on a panel.
.playlist-info {
  .title {
    width: fit-content;
    cursor: text;
  }

  .duration {
    cursor: text;
  }

  // Flex, gap and wrapping come from `.header-actions`; the margin is this
  // column's business, not the row's.
  .btns {
    margin-top: 0;

    .download-btn,
    .options {
      // Shared header-action anatomy: 44px touch target, theme-aware glyph
      // (it was static ink and vanished on the dark ground), no squeezing.
      @include btn-action;
    }

    .download-btn .icon {
      display: flex;
      color: inherit;

      svg {
        width: 1.5rem;
        height: 1.5rem;
      }
    }

    .options.context_menu_showing {
      background-color: $darkblue;
      // Yellow accent fill while the menu is open -> pin static ink. Same
      // spelling as the album and artist headers; two dialects for one state is
      // how they drift apart.
      color: $mem-ink;
    }
  }
}
</style>
