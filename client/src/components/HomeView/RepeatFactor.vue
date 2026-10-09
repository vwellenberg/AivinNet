<template>
    <!-- "On repeat": how many times the usual this week's plays are. Below one
         play a week there is no factor, and nothing is shown. -->
    <div v-if="factor" class="repeat-factor">
        <span class="factor">{{ factor }}× usual</span>
    </div>
</template>

<script setup lang="ts">
defineProps<{
    factor: number | null
}>()
</script>

<style lang="scss">
.repeat-factor {
    display: flex;
    justify-content: flex-end;
    margin-top: $small;

    .factor {
        font-size: 0.7rem;
        font-weight: 700;
        white-space: nowrap;
        color: $candy-black;
        background-color: $mem-yellow;
        border: $mem-hairline-w solid $mem-ink;
        border-radius: $candy-radius-xs;
        padding: 0 0.3rem;
    }
}
</style>
