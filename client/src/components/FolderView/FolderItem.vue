<template>
  <!-- The folder PAGE: the whole row is a link, which the keyboard already has. -->
  <router-link v-if="folder_page" :to="{ name: Routes.folder, params: { path: folder.path } }">
    <div
      v-auto-animate
      class="f-item"
      v-context-menu="showContextMenu"
      :class="{ context_menu_showing: context_menu_showing }"
    >
      <SymLinkSvg v-if="folder.is_sym" />
      <FolderSvg v-else />
      <div class="info">
        <div class="f-item-text ellip">{{ folder.name }}</div>
        <div class="f-count" v-if="folder.trackcount">
          {{ folder.trackcount.toLocaleString() + ` File${folder.trackcount == 1 ? "" : "s"}` }}
        </div>
      </div>
    </div>
  </router-link>

  <!-- ⚠️ The folder PICKER (SetRootDirs) is a different control, and it used to
       be the same markup (#137). Inside the router-link, Enter reached the <a>,
       not the row's click handler, so the keyboard LEFT THE DIALOG for the folder
       page instead of stepping into the folder — and the tick was a hover-only
       <div> no keyboard could reach at all. Two real controls now: open, tick. -->
  <div
    v-else
    v-auto-animate
    class="f-item is-picker"
    :class="{ selected: is_checked }"
    @mouseover="mouse_over = true"
    @mouseleave="mouse_over = false"
  >
    <button type="button" class="f-open" :aria-disabled="is_checked" @click="open">
      <SymLinkSvg v-if="folder.is_sym" />
      <FolderSvg v-else />
      <div class="info">
        <div class="f-item-text ellip">{{ folder.name }}</div>
        <div class="f-count" v-if="folder.trackcount">
          {{ folder.trackcount.toLocaleString() + ` File${folder.trackcount == 1 ? "" : "s"}` }}
        </div>
      </div>
    </button>
    <!-- The empty box used to appear on hover only. On a control that would be
         an invisible tab stop, so focus shows it as well. -->
    <button
      type="button"
      class="check"
      :aria-pressed="is_checked"
      :aria-label="`Select ${folder.name}`"
      @click="emit('check')"
      @focus="check_focus = true"
      @blur="check_focus = false"
    >
      <CheckSvg v-if="!is_checked && (mouse_over || check_focus)" />
      <CheckFilledSvg v-if="is_checked" />
    </button>
  </div>
</template>

<script setup lang="ts">
import { Routes } from "@/router";
import { ref } from "vue";

import { Folder } from "@/interfaces";

import FolderSvg from "@/assets/icons/folder.svg";
import SymLinkSvg from "@/assets/icons/symlink.svg";

import CheckFilledSvg from "@/assets/icons/check.filled.svg";
import CheckSvg from "@/assets/icons/square.svg";
import { ContextSrc } from "@/enums";
import { showFolderContextMenu } from "@/helpers/contextMenuHandler";

const props = defineProps<{
  folder: Folder;
  is_checked?: boolean;
  folder_page?: boolean;
}>();

const emit = defineEmits<{
  (e: "navigate"): void;
  (e: "check"): void;
}>();

const mouse_over = ref(false);
const check_focus = ref(false);
const context_menu_showing = ref(false);

/** Step into the folder — unless it is ticked, which pins the picker to it. */
function open() {
  if (!props.is_checked) emit("navigate");
}

function showContextMenu(e: MouseEvent) {
  showFolderContextMenu(e, context_menu_showing, ContextSrc.FolderCard, props.folder.path);
}
</script>

<style lang="scss">
.f-item {
  height: 4rem;
  display: grid;
  grid-template-columns: max-content 1fr;
  align-items: center;
  background-color: $candy-pink;
  border: $candy-border;
  border-radius: $candy-radius-sm;
  position: relative;
  padding: 0 0 0 1rem;
  gap: $small;
  // Grid mode: a raised tile like every other card. (List mode flattens the
  // row and drops the shadow again — see FolderList.vue.)
  @include candy-raised(3px, 3px, $press: false);
  transition: background-color $motion-move ease-out, box-shadow $motion-shadow ease-out;

  &.context_menu_showing {
    background-color: $candy-pink-deep;
  }

  svg {
    color: $candy-black;
    height: 1.75rem;
  }

  .f-count {
    font-size: $medium;
    font-weight: 700;
    color: $candy-text-muted;
    white-space: nowrap;
  }

  .check {
    // `outline: none` sat here. On a <div> it removed nothing; on the button it
    // is now, it would have removed the only sign of keyboard focus.
    @include focus-ring;
    z-index: 10;
    position: absolute;
    top: $smaller;
    right: $smaller;
    min-width: 1.75rem;
    min-height: 1.75rem;
    justify-content: center;
    color: $candy-black;
    transform: scale(0.75);
  }

  // Picker rows: the row is only the plate; the open button inside it takes over
  // the padding, the grid and the gap the row used to carry itself.
  &.is-picker {
    padding: 0;
    grid-template-columns: 1fr;
  }

  .f-open {
    @include focus-ring;
    font: inherit;
    color: inherit;
    text-align: left;
    height: 100%;
    width: 100%;
    display: grid;
    grid-template-columns: max-content 1fr;
    align-items: center;
    gap: $small;
    padding: 0 0 0 1rem;
    border-radius: inherit;
    cursor: pointer;

    &[aria-disabled="true"] {
      cursor: default;
    }
  }

  .f-item-text {
    font-weight: 600;
    margin-right: 1rem;
  }

  &:hover {
    .options {
      display: block;
    }
  }
}
</style>
