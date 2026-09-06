<template>
  <div style="height: 1px">
    <button v-if="show_text" class="btn-pill" @click="fetch_callback">Load More</button>
  </div>
</template>

<script setup lang="ts">
import { onMounted } from "vue";
import { onBeforeRouteUpdate } from "vue-router";

const props = defineProps<{
  show_text?: boolean;
  fetch_callback: () => Promise<void>;
  reset_callback?: () => Promise<void>;
  outside_route?: boolean;
}>();

onMounted(async () => {
  props.fetch_callback();
});

!props.outside_route &&
  onBeforeRouteUpdate(() => {
    if (!props.reset_callback) return;
    props.reset_callback();
  });
</script>
