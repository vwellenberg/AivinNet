<template>
  <button class="play-btn circular" @click.prevent.stop="handlePlay">
    <PlaySvg />
  </button>
</template>

<script setup lang="ts">
import { playSources } from "@/enums";
import {
  playFromAlbumCard,
  playFromArtistCard,
  playFromFavorites,
  playFromFolderCard,
  playFromPlaylist,
} from "@/helpers/usePlayFrom";
import { Playlist, Track } from "@/interfaces";

import PlaySvg from "@/assets/icons/play.svg";
import useQueue from "@/stores/queue";
import useTracklist from "@/stores/queue/tracklist";
import useSearchStore from "@/stores/search";

const props = defineProps<{
  source: playSources | null;
  albumHash?: string;
  albumName?: string;
  artisthash?: string;
  artistname?: string;
  folderpath?: string;
  playlist?: string;
  track?: Track;
}>();

function handlePlay() {
  switch (props.source) {
    case playSources.album:
      playFromAlbumCard(props.albumHash || "", props.albumName || "");
      break;

    case playSources.artist:
      playFromArtistCard(props.artisthash || "", props.artistname || "");
      break;
    case playSources.folder:
      playFromFolderCard(props.folderpath || "");
      break;
    case playSources.recentlyAdded:
      playFromPlaylist("recentlyadded", props.track);
      break;
    case playSources.track: {
      // insert after current and play
      if (!props.track) break;

      const queue = useQueue();
      const search = useSearchStore();
      const tracklist = useTracklist();

      // No clearQueue() first: setFromSearch replaces the list wholesale and
      // play() sets the index, so the clear was a no-op locally — but in group
      // mode it is a queue-set of an EMPTY queue racing the real one.
      tracklist.setFromSearch(search.query, [props.track]);
      queue.play();
      break;
    }
    case playSources.favorite:
      playFromFavorites(props.track);
      break;
    case playSources.playlist:
      playFromPlaylist(props.playlist as string);
      break;

    default:
      break;
  }
}
</script>

<style lang="scss">
// The round teal play disc on every cover card — the same PRIMARY role as the
// header Play CTA and the transport's play button, just circular. This file
// used to hand-build that anatomy (teal fill, ink border, sprinkle, 3px offset,
// scale-on-hover) a fourth time; the role owns it now.
//
// Size is deliberately NOT passed: call sites drive it by WIDTH
// (`.card-play-btn { width: 3.25rem }`) and the aspect ratio squares it. An
// explicit height would win over `aspect-ratio` and render an oval on every
// card — which is exactly what the global base's `height: 2.25rem` used to do.
.play-btn {
  @include btn-primary(
    $w: auto,
    $h: auto,
    $radius: $candy-radius-pill,
    $pad: 0,
    $glyph: 1.75rem
  );
  aspect-ratio: 1;

  svg {
    transition: transform 0.2s ease;
  }
}
</style>
