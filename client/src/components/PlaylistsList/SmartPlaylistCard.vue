<template>
  <!-- The tile of a smart playlist: the same three plates as every other tile
       (type label, artwork, name plate). It has no picture of its own, so the
       artwork is the glyph cell a folder tile uses, and the plate says what
       the rules are instead of how many tracks they hold: that number is only
       known once the rules are evaluated, and the list does not do that. -->
  <RouterLink
    v-context-menu="showMenu"
    :to="{ name: Routes.smartPlaylist, params: { smartid: playlist.id } }"
    class="p-card"
    :class="{ 'context-menu-open': contextMenuFlag }"
  >
    <CardTypeLabel type="smartPlaylist" />
    <div class="card-art is-glyph">
      <SparklesSvg class="bg" />
      <PlayBtn :source="playSources.smartPlaylist" :playlist="playlist.id.toString()" />
    </div>
    <div class="card-plate">
      <div class="ellip title" :title="playlist.name">{{ playlist.name }}</div>
      <div class="rtcount ellip" :title="rulesText">{{ rulesText }}</div>
    </div>
  </RouterLink>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { playSources } from "@/enums";
import { showSmartPlaylistContextMenu } from "@/helpers/contextMenuHandler";
import { Routes } from "@/router";
import { SmartPlaylist } from "@/interfaces";
import { summarize } from "@/utils/smartPlaylistRules";
import CardTypeLabel from "@/components/shared/CardTypeLabel.vue";
import PlayBtn from "@/components/shared/PlayBtn.vue";
import SparklesSvg from "@/assets/icons/sparkles.svg";

const props = defineProps<{
  playlist: SmartPlaylist;
}>();

const contextMenuFlag = ref(false);
const rulesText = computed(() => summarize(props.playlist));

function showMenu(e: MouseEvent) {
  showSmartPlaylistContextMenu(e, props.playlist, contextMenuFlag);
}
</script>
