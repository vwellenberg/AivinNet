<template>
  <!-- The page's own title. Albums and Artists left the left navigation
       (2026-11-14) and are reached from Home's Browse Library block, so nothing
       else on the screen names the page any more. Coloured by its entity, like
       "Favorite Albums" and the tiles below it. -->
  <GenericHeader :entity="entity">
    <template #name>{{ entity === "album" ? "Albums" : "Artists" }}</template>
  </GenericHeader>
</template>

<script setup lang="ts">
import GenericHeader from "@/components/shared/GenericHeader.vue";

defineProps<{ entity: "album" | "artist" }>();
</script>
