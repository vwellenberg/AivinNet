<template>
  <span
    v-if="bitrate > 1024"
    class="master-flag"
    :class="{ fill }"
    :title="!text ? 'Master audio bitrate - ' + `${bitrate} Kbps` : ''"
    >{{ text ? text : "M" }}</span
  >
</template>

<script setup lang="ts">
defineProps<{
  bitrate: number;
  text?: string;
  fill?: boolean;
}>();
</script>

<style lang="scss">
.master-flag {
  font-size: 10px;
  font-weight: 600;
  margin-left: $smaller;
  padding: 2px 5px;
  border-radius: $candy-radius-pill;
  text-transform: uppercase;
  background-color: $candy-lavender;
  border: 1px solid $mem-line;
  color: $candy-black;

  // Highlighted variant (e.g. the primary version chip on album headers).
  &.fill {
    background-color: $candy-pink-deep;
  }
}
</style>
