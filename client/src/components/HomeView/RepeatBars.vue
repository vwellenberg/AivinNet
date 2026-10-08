<template>
    <!-- "On repeat": plays per week, the eight weeks before and this one (last,
         in the accent), and how many times the usual this week is. -->
    <div class="repeat-bars" :aria-label="label" role="img">
        <div class="bars">
            <span
                v-for="(height, i) in heights"
                :key="i"
                class="bar"
                :class="{ now: i === heights.length - 1 }"
                :style="{ height: height + '%' }"
            ></span>
        </div>
        <span v-if="factor" class="factor">{{ factor }}× usual</span>
    </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { barHeights } from '@/utils/homeRows'

const props = defineProps<{
    weeks: number[]
    factor: number | null
}>()

const heights = computed(() => barHeights(props.weeks))
const label = computed(() => `Plays per week, oldest first: ${props.weeks.join(', ')}`)
</script>

<style lang="scss">
.repeat-bars {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: $small;
    margin-top: $small;

    .bars {
        display: flex;
        align-items: flex-end;
        gap: 2px;
        height: 1.5rem;
    }

    .bar {
        width: 5px;
        border-radius: 2px 2px 0 0;
        background-color: $candy-text-faint;

        &.now {
            background-color: $mem-yellow;
            outline: $mem-hairline-w solid $mem-ink;
        }
    }

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
