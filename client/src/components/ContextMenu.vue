<template>
  <div
    id="context-menu"
    ref="contextMenuRef"
    class="context-menu rounded shadow-lg no-select"
    :class="{ 'is-open': context.visible }"
    role="menu"
    aria-orientation="vertical"
    :style="{
      visibility: context.visible ? 'visible' : 'hidden',
      opacity: context.visible ? '1' : '0',
    }"
    @keydown="onMenuKey"
  >
    <!-- A separator is not an item: it takes no focus and does nothing when
         clicked. It used to be a ContextItem, i.e. a clickable row that closed
         the menu. -->
    <template v-for="(option, index) in context.options" :key="option.label ?? `separator-${index}`">
      <div v-if="option.type === 'separator'" class="context-item separator" role="separator"></div>
      <ContextItem
        v-else
        class="context-item"
        :class="[{ critical: option.critical }, option.type]"
        :option="option"
        @hideContextMenu="context.hideContextMenu()"
      />
    </template>
  </div>
</template>

<script setup lang="ts">
import { onClickOutside } from "@vueuse/core";
import { nextTick, ref, watch } from "vue";

import useContextStore from "@/stores/context";
import { focusWhenVisible } from "@/utils/focusWhenVisible";

import ContextItem from "./Contextmenu/ContextItem.vue";

const context = useContextStore();
const contextMenuRef = ref<HTMLElement>();

// ---------------------------------------------------------------------------
// The keyboard (#137). The trigger — the overflow button, the row — hands focus
// into the menu when it opens and gets it back when the menu closes. Without
// that the items were unreachable: the `…` buttons opened a menu the keyboard
// could see and never enter.
// ---------------------------------------------------------------------------

let trigger: HTMLElement | null = null;

function items(): HTMLElement[] {
  return Array.from(contextMenuRef.value?.querySelectorAll<HTMLElement>(':scope > [role="menuitem"]') ?? []);
}

watch(
  () => context.visible,
  async (visible) => {
    if (visible) {
      const active = document.activeElement as HTMLElement | null;
      trigger = active && active !== document.body && !contextMenuRef.value?.contains(active) ? active : null;
      await nextTick();
      // Not straight after the render — see utils/focusWhenVisible.ts.
      if (context.visible) await focusWhenVisible(items()[0]);
      return;
    }

    // Only when focus is still IN the menu — closed by Escape, Tab or an item.
    // A click somewhere else has already put focus where the user wanted it.
    const inside = contextMenuRef.value?.contains(document.activeElement);
    if (inside && trigger && document.contains(trigger)) trigger.focus();
    trigger = null;
  }
);

function onMenuKey(e: KeyboardEvent) {
  const list = items();
  const at = list.indexOf(document.activeElement as HTMLElement);

  switch (e.key) {
    case "ArrowDown":
      list[(at + 1) % list.length]?.focus();
      break;
    case "ArrowUp":
      list[(at - 1 + list.length) % list.length]?.focus();
      break;
    case "Home":
      list[0]?.focus();
      break;
    case "End":
      list[list.length - 1]?.focus();
      break;
    case "Escape":
      context.hideContextMenu();
      break;
    // Tab leaves a menu rather than walking through it.
    case "Tab":
      context.hideContextMenu();
      break;
    default:
      return;
  }

  if (e.key !== "Tab") e.preventDefault();
  // The global shortcuts would otherwise act too: arrows seek and change volume.
  e.stopPropagation();
}

let watcher: any = null;

context.$subscribe((mutation, state) => {
  if (state.visible) {
    setTimeout(() => {
      if (watcher !== null) {
        watcher();
      }
      watcher = onClickOutside(
        contextMenuRef,
        (e: any) => {
          if (e.type == "pointerup") return;
          context.hideContextMenu();
        },
        {
          capture: false,
        }
      );
    }, 200);
    return;
  }

  if (watcher !== null) {
    watcher();
  }
});
</script>

<style lang="scss">
.context-menu {
  position: fixed;
  top: 0;
  left: 0;
  // 14rem, not 13: the labels name their subject since the "Play next"
  // mix-up, and the longest of them ("Add playlist to queue", 148px of Space
  // Grotesk) did not fit the label column a 13rem menu leaves over — it
  // ellipsed away the very word that disambiguates the entry.
  width: 14rem;
  z-index: 1000 !important;
  height: min-content;
  padding: $small;
  @include candy-box($candy-white, $candy-radius);
  color: $candy-text;
  transform-origin: top left;
  font-size: 0.875rem;
  font-weight: 500;
  opacity: 0;
  visibility: hidden;
  // ⚠️ `visibility` flips AT ONCE when opening and only after the fade when
  // closing. A plain `visibility` transition starts at progress 0 — i.e. still
  // `hidden` in the first frame — and a hidden element cannot take focus, so the
  // menu opened by keyboard silently refused the focus it was handed (#137).
  // jsdom has no transitions, which is why the unit test could not see it.
  // Visually nothing changes: the transition read as instant on open anyway.
  transition: opacity $motion-settle ease-out, visibility 0s linear $motion-settle;

  &.is-open {
    transition: opacity $motion-settle ease-out, visibility 0s;
  }

  .separator {
    height: 1px;
    padding: 0;
    margin-left: -$medium;
    width: calc(100% + $medium * 2);
    pointer-events: none;
  }

  .critical {
    color: $candy-text;
    // No red in the candy palette — bold weight marks destructive entries
    // at rest, the deeper pink hover marks them on approach.
    font-weight: 700;
    transition: background-color $motion-move ease-out, color $motion-move ease-out;

    &:hover {
      background-color: var(--look-menu-hover, #{$candy-pink-deep});
      // Yellow accent on hover → pin static ink for the label.
      color: var(--look-menu-hover-text, #{$mem-ink});
    }
  }
}
</style>
