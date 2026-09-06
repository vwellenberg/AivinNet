<template>
  <div
    v-if="$route.params.tab == 'home'"
    class="now-playing-view v-scroll-page"
    :class="{ isSmall, isMedium }"
    style="position: relative"
    :style="{ backgroundImage: pageGradient() }"
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
          <component
            :is="item.component"
            :key="index"
            v-bind="item.props"
            @playThis="playFromQueue(item.props.index - 1)"
            @trackDropped="onTrackDropped"
          ></component>
        </DynamicScrollerItem>
      </template>
    </DynamicScroller>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted } from "vue";
import { ScrollerItem, Track } from "@/interfaces";

import useQueueStore from "@/stores/queue";
import useTracklist from "@/stores/queue/tracklist";
import { isMedium, isSmall } from "@/stores/content-width";
import { dropSources } from "@/enums";

import Header from "@/components/NowPlaying/Header.vue";
import SongItem from "@/components/shared/SongItem.vue";
import updatePageTitle from "@/utils/updatePageTitle";
import { pageGradient } from "@/utils/colortools/pageGradient";
import { createDragAutoScroller } from "@/utils/dragAutoScroll";
import { trackBandFade } from "@/utils/songItemMethods";


const queue = useQueueStore();
const store = useTracklist();

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

const scrollerItems = computed(() => {
  const items: ScrollerItem[] = [];

  const trackComponents = store.tracklist.map((track, index) => {
    track.index = index; // used in context menu to remove from queue
    return {
      id: index,
      component: SongItem,
      props: {
        track,
        index: index + 1,
        is_first: index === 0,
        is_last: index === store.tracklist.length - 1,
        isCurrent: index === queue.currentindex,
        isCurrentPlaying: index === queue.currentindex && queue.playing,
        isQueueTrack: true,
        // These rows ARE the queue, so that is the drop source — not the label
        // of wherever the queue was originally filled from. `track.index` is
        // overwritten with the queue position just above, so the index the drag
        // carries is a queue index.
        droppable: true,
        source: dropSources.queue,
        band_fade: trackBandFade(index + 1, store.tracklist.length),
      },
    };
  });

  return items.concat(trackComponents);
});

onMounted(() => updatePageTitle("Now Playing"));
onBeforeUnmount(() => stopAutoScroll());
</script>

<style lang="scss">
.now-playing-view {
  height: 100%;
}
</style>
