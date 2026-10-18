<template>
    <div class="rangeinput">
        <input
            ref="input"
            type="range"
            :min="min"
            :max="max"
            :step="step"
            :value="value"
            :aria-label="label"
            :aria-valuetext="text"
            @input="onInput"
        />
        <span class="readout">{{ text }}</span>
    </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

import { holdPeek } from '@/utils/settingsPeek'

const props = defineProps<{
    value: number
    min: number
    max: number
    step: number
    label?: string
    /** Hold the settings modal in peek mode while the thumb is held. */
    peek?: boolean
    format?: (value: number) => string
    onChange: (value: number) => void
}>()

const input = ref<HTMLInputElement | null>(null)
const text = computed(() => (props.format ? props.format(props.value) : String(props.value)))

function onInput(e: Event) {
    props.onChange(Number((e.target as HTMLInputElement).value))
}

let release: (() => void) | null = null
onMounted(() => {
    if (props.peek && input.value) release = holdPeek(input.value)
})
onBeforeUnmount(() => release?.())
</script>

<style lang="scss">
.rangeinput {
    display: flex;
    align-items: center;
    gap: $small;
    width: 14rem;
    max-width: 100%;

    // Same geometry source as the seek and volume bars: the custom properties
    // size the track and the thumb, the thumb is centred by arithmetic.
    @include range-geometry(0.75rem, 1.5rem);

    input[type='range'] {
        flex: 1 1 auto;
        min-width: 0;
        // 44px touch target: the row is the target, the track is drawn inside.
        height: 2.75rem;
        margin: 0;
        background: transparent;
        appearance: none;
        -webkit-appearance: none;
        // The horizontal drag must belong to the slider, or the page scrolls.
        touch-action: pan-y;
        cursor: pointer;

        &::-webkit-slider-runnable-track {
            // The content height: with the 3px frame the bar totals --range-h,
            // the same as Firefox's track below, and the thumb maths holds.
            height: var(--range-track);
            border: $candy-border;
            border-radius: $candy-radius-pill;
            background: $mem-panel;
        }

        &::-moz-range-track {
            height: var(--range-track);
            border: $candy-border;
            border-radius: $candy-radius-pill;
            background: $mem-panel;
        }

        &::-webkit-slider-thumb {
            appearance: none;
            -webkit-appearance: none;
            width: var(--range-thumb);
            height: var(--range-thumb);
            // centre on the track: half the track minus half the thumb
            margin-top: calc((var(--range-h) - var(--range-thumb)) / 2 - #{$candy-border-w});
            border: $candy-border;
            border-radius: 50%;
            background: $mem-teal;
            box-shadow: mem-shadow(3px, 3px);
        }

        &::-moz-range-thumb {
            width: calc(var(--range-thumb) - #{$candy-border-w * 2});
            height: calc(var(--range-thumb) - #{$candy-border-w * 2});
            border: $candy-border;
            border-radius: 50%;
            background: $mem-teal;
            box-shadow: mem-shadow(3px, 3px);
        }

        &:focus-visible {
            outline: none;
            &::-webkit-slider-thumb {
                outline: $focus-ring-w solid $mem-focus;
                outline-offset: 2px;
            }
        }
    }

    .readout {
        min-width: 3.25rem;
        text-align: right;
        font-weight: 700;
        font-variant-numeric: tabular-nums;
    }
}
</style>
