<template>
  <!-- The plate is the tab group, so it wraps only as wide as its segments;
       the outer div is what scrolls when they outgrow a narrow screen. -->
  <div class="generictabs-scroll">
    <div class="generictabs">
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
defineProps<{
  items: { title: string; params: any; query?: any }[];
  active: (item: any) => boolean;
  route: string;
}>();
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

  .tab {
    white-space: nowrap;
  }
}
</style>
