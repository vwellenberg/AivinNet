<template>
  <div class="versions">
    <MasterFlag
      v-for="(v, index) in versions"
      :key="v"
      :bitrate="1200"
      :text="v"
      :fill="versions.length > 1 && index === 0"
    />
  </div>
</template>

<script setup lang="ts">
import MasterFlag from "@/components/shared/MasterFlag.vue";

defineProps<{
  versions: string[];
}>();
</script>