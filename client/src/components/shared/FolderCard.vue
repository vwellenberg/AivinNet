<template>
  <RouterLink
    :to="{
      name: Routes.folder,
      params: {
        path: folder.path,
      },
    }"
    class="foldercard"
  >
    <CardTypeLabel type="folder" />
    <div class="rimg card-art is-glyph">
      <!-- The folder glyph used to be pasted in here as a raw path — a private
           copy of folder-1.svg that no icon change would ever reach. It reads
           from the shared asset now. -->
      <FolderSvg class="bg" />
      <PlayBtn :source="playSources.folder" :folderpath="folder.path" />
    </div>

    <div class="card-plate">
      <div v-if="folder.help_text && !isTypeEcho(folder.help_text, 'folder')" class="rhelp folder">
        <span class="help">{{ folder.help_text }}</span>
        <span class="time">{{ folder.time }}</span>
      </div>
      <div class="ellip title" :title="name(folder.path)">
        {{ name(folder.path) }}
      </div>
      <div class="rtcount">
        <b>{{ folder.count }} Track{{ folder.count == 1 ? "" : "s" }}</b>
      </div>
    </div>
  </RouterLink>
</template>

<script setup lang="ts">
import { playSources } from "@/enums";
import { Routes } from "@/router";
import CardTypeLabel from "../shared/CardTypeLabel.vue";
import PlayBtn from "../shared/PlayBtn.vue";
import FolderSvg from "@/assets/icons/folder.svg";
import { isTypeEcho } from "@/utils/cardTypes";

defineProps<{
  folder: {
    path: string;
    count: number;
    help_text: string;
    time?: string;
  };
}>();

const name = (path: string) => {
  // remove trailing slash
  if (path.endsWith("/")) {
    path = path.slice(0, -1);
  }

  const splits = path.split("/");

  return splits[splits.length - 1];
};
</script>

<style lang="scss">
// Shape, frame, shadow and hover live in the shared anatomy
// (Global/cards.scss). Only what is specific to a folder tile stays here.
.foldercard {
  .title {
    font-weight: 700;
    font-size: 0.95rem;
    color: $candy-text;
  }

  svg.bg {
    // The placeholder glyph for a folder tile. Sized here rather than by a
    // scale factor on a 30px box: the new set fills its viewBox to a known
    // 18/24, so an explicit size is the honest way to say how big it should be.
    width: 3.6rem;
    height: 3.6rem;
    color: $candy-text-muted;
  }

  .rtcount {
    font-size: 0.75rem;
    color: $candy-text-muted;
    margin-top: $smaller;
  }
}
</style>
