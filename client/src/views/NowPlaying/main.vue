<template>
  <div
    v-if="$route.params.tab == 'home'"
    class="now-playing-view v-scroll-page"
    :class="{ isSmall, isMedium }"
    style="position: relative"
    :style="{ '--page-tint': pageTint(colors.bg) }"
    @dragover="onScrollerDragOver"
    @dragleave="onScrollerDragLeave"
    @drop="stopAutoScroll"
    @dragend="stopAutoScroll"
  >
    <DynamicScroller
      id="nowplaying-scroller"
      :items="scrollerItems"
      :min-item-size="64"
      class="scroller"
      style="height: 100%"
    >
      <template #before>
        <Header />
      </template>
      <template #default="{ item, index, active }">
        <DynamicScrollerItem
          :item="item"
          :active="active"
          :size-dependencies="[item.props]"
          :data-index="index"
        >
          <!-- No `:key`: a key that changes with the item turns every
               recycle into a new row, replaying its entrance mid-scroll
               (census: components/__tests__/scrollerRecycling.test.ts). -->
          <component
            :is="item.component"
            v-bind="item.props"
          ></component>
        </DynamicScrollerItem>
      </template>
    </DynamicScroller>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { ScrollerItem, Track } from "@/interfaces";

import useColors from "@/stores/colors";
import useQueueStore from "@/stores/queue";
import useTracklist from "@/stores/queue/tracklist";
import { isMedium, isMobile, isSmall } from "@/stores/content-width";
import { dropSources } from "@/enums";

import Header from "@/components/NowPlaying/Header.vue";
import QueueCaption from "@/components/NowPlaying/QueueCaption.vue";
import SongItem from "@/components/shared/SongItem.vue";
import updatePageTitle from "@/utils/updatePageTitle";
import { pageTint } from "@/utils/colortools/pageGradient";
import { createDragAutoScroller } from "@/utils/dragAutoScroll";
import useSettings from "@/stores/settings";
import { buildQueueRows } from "./queueRow";


const queue = useQueueStore();
// The playing track's cover colour — extracted on every track change (player.ts),
// the same `bg` the album / playlist pages take from their own cover.
const colors = useColors();
const store = useTracklist();
const settings = useSettings();

function playFromQueue(index: number) {
  queue.play(index);
}

function onTrackDropped(source: dropSources, _track: Track, newIndex: number, oldIndex: number) {
  stopAutoScroll();
  // A row dragged in from a page carries an index into THAT list, not into the
  // queue; acting on it would move the wrong track.
  if (source !== dropSources.queue) return;
  store.moveTrack(oldIndex, newIndex);
}

// Edge auto-scroll while reordering, same as the playlist page: the browser
// does not scroll a container during a native drag.
const autoScroller = createDragAutoScroller(() => document.getElementById("nowplaying-scroller"));

function onScrollerDragOver(e: DragEvent) {
  autoScroller.update(e.clientY);
}

function onScrollerDragLeave(e: DragEvent) {
  // dragleave bubbles up from every row the pointer crosses; only stop once the
  // pointer has truly left the scroller.
  const container = e.currentTarget as HTMLElement;
  const related = e.relatedTarget as Node | null;
  if (related && container.contains(related)) return;
  stopAutoScroll();
}

function stopAutoScroll() {
  autoScroller.stop();
}

// Folded by default: what already played is one line until someone asks for it.
const historyOpen = ref(false);

// The rows carry their own listeners (`onPlayThis` …) instead of the template
// binding them on every `<component>`: a caption row has no `playThis`, and a
// listener it does not declare would land on its root element as a native one.
const scrollerItems = computed<ScrollerItem[]>(() => {
  // Used by the context menu ("remove from queue") and as the index a drag carries.
  store.tracklist.forEach((track, index) => (track.index = index));

  const rows = buildQueueRows(store.tracklist, queue.currentindex, {
    split: !settings.shuffle,
    historyOpen: historyOpen.value,
    wraps: settings.repeat === "all",
    showCurrent: !isMobile.value,
  });

  return rows.map(row => {
    if (row.kind === "track") {
      return {
        id: row.id,
        component: SongItem,
        props: {
          ...row.props,
          onPlayThis: () => playFromQueue(row.queueIndex),
          onTrackDropped,
        },
      };
    }

    if (row.kind === "note") {
      return { id: row.id, component: QueueCaption, props: { note: row.text } };
    }

    return {
      id: row.id,
      component: QueueCaption,
      props: {
        text: row.text,
        count: row.count,
        open: row.open,
        onToggle: () => (historyOpen.value = !historyOpen.value),
      },
    };
  });
});

onMounted(() => updatePageTitle("Now Playing"));
onBeforeUnmount(() => stopAutoScroll());
</script>

<style lang="scss">
.now-playing-view {
  height: 100%;
}
</style>
