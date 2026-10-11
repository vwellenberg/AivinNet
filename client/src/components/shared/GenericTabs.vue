<template>
  <!-- The plate is the tab group, so it wraps only as wide as its segments;
       the outer div is what scrolls when they outgrow a narrow screen. -->
  <div class="generictabs-scroll">
    <div ref="strip" class="generictabs">
      <!-- The plate sits first in the DOM, so the tabs paint over it. It glides
           to the active tab instead of the tab changing colour in place. -->
      <span ref="plate" class="tab-plate" aria-hidden="true"></span>
      <!-- `replace` is a RouterLink PROP. It sat inside the `:to` object, where
           vue-router ignores it, so every tab click pushed a history entry and
           Back walked through the tabs one by one instead of leaving the page.
           Written as intended now. -->
      <RouterLink
        v-for="(item, index) in items"
        :key="index"
        class="tab"
        :class="{ active: active(item) }"
        replace
        :to="{
          name: route,
          params: item.params,
          query: item.query,
        }"
      >
        {{ item.title }}
      </RouterLink>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, onUpdated, ref } from 'vue';

defineProps<{
  items: { title: string; params: any; query?: any }[];
  active: (item: any) => boolean;
  route: string;
}>();

const strip = ref<HTMLElement | null>(null);
const plate = ref<HTMLElement | null>(null);

// The active test is a function prop, so the plate cannot ask it directly. The
// tabs already say which one is active (`.active`), so the plate follows the
// DOM: width and offset of the active segment, measured after every render.
function placePlate() {
  const tab = strip.value?.querySelector<HTMLElement>('.tab.active');
  if (!tab || !plate.value) return;
  plate.value.style.width = `${tab.offsetWidth}px`;
  plate.value.style.transform = `translateX(${tab.offsetLeft}px)`;
}

onMounted(placePlate);
onUpdated(placePlate);
</script>

<style lang="scss">
.generictabs-scroll {
  // The scroller anatomy is `mem-seg-scroll` (_candy.scss) — it was written
  // here and is now shared with the charts header, which needed the same box
  // and had nothing (#558).
  @include mem-seg-scroll;
}

.generictabs {
  // Same segmented plate as the charts tabs — see mem-seg-tabs.
  //
  // What stood here was pre-memphis: `$gray` labels, a 1px bottom hairline and
  // a white 3px indicator, i.e. the design from before the redesign. This is
  // the only place GenericTabs is used, so the page kept it while every other
  // surface moved on, and the labels sat as bare text on the doodle ground —
  // "EP & Singles" ran straight through a saturated shape.
  @include mem-seg-tabs(".tab");

  position: relative;

  .tab {
    white-space: nowrap;
  }

  // The active fill moves with the plate, so the segment itself stops painting
  // it. The ring of the label (mem-label-hatch) keeps its hole and shows the
  // plate through it.
  .tab.active {
    background-color: transparent;
  }

  // Transform and width only. A colour transition here would be the grey
  // mid-frame the hover flip is written to avoid (styling.md).
  .tab-plate {
    position: absolute;
    top: 0;
    bottom: 0;
    left: 0;
    width: 0;
    background-color: var(--look-selected-fill, #{$mem-yellow});
    transition:
      transform $motion-move $motion-curve,
      width $motion-move $motion-curve;
  }
}
</style>
