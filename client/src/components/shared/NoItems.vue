<template>
  <div v-if="flag" class="nothing rounded">
    <div>
      <component :is="icon" />
      <div class="nothingtitle">
        <b>{{ title }}</b>
      </div>
      <p>
        {{ description }}
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  icon: any;
  flag: boolean;
  title: string;
  description: string;
}>();
</script>

<style lang="scss">
.nothing {
  height: 100%;
  max-width: 25rem;
  margin: 0 auto;
  display: grid;
  // Empty states are shown mostly at page level (over the page ground), so use
  // theme-aware colours. The few white-panel hosts (queue, right-sidebar
  // search) re-pin ink via local overrides in those components.
  color: $mem-content-text;

  p {
    word-break: break-word;
    color: $mem-content-muted;
  }

  .nothingtitle {
    // margin-top: 2.75rem;
    font-size: 1.15rem;
  }

  svg {
    height: 9rem;
  }

  & > * {
    margin: auto;
    text-align: center;
  }
}
</style>
