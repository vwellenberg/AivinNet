<template>
    <div class="setting-select rounded-sm no-scroll">
        <div
            v-for="option in optionsWithActive"
            :key="option.title"
            class="option"
            :class="{ active: option.active }"
            @click="setterFn(option.value)"
        >
            {{ option.title }}
        </div>
    </div>
</template>

<script setup lang="ts">
import { SettingOption } from "@/interfaces/settings";
import { computed } from "vue";

const props = defineProps<{
    options: SettingOption[] | undefined;
    source: () => string;
    setterFn: (value: any) => void;
}>();

const optionsWithActive = computed(() => {
    return props.options?.map(option => {
        return {
            ...option,
            active: option.value === props.source(),
        };
    });
});
</script>

<style lang="scss">
.setting-select {
    display: flex;
    flex-shrink: 0;
    @include candy-box($mem-panel, $candy-radius-sm);
    // Same raised control as the toggle beside it — it had the 3px frame but
    // no shadow, so two controls in the same column sat on different planes.
    @include candy-shadow(3px, 3px);
    // Clip the segments to the rounded frame; without it the active fill
    // squares off the corner it sits in.
    overflow: hidden;

    .option {
        font-weight: 600;
        padding: 0.5rem;
        cursor: pointer;
        user-select: none;
        min-width: 4rem;
        text-align: center;
        color: $mem-content-text;

        // The pointer token, not an accent (#422).
        &:hover:not(.active) {
            background-color: var(--mem-hover);
            color: var(--mem-hover-text);
        }
    }

    .option.active {
        // Yellow means ON -> pin static ink for the label. The fill itself is
        // handed to the mixin through `--row-fill`, which paints it twice: once
        // as the surface, once as the cover that keeps the texture out of the
        // text band. Setting `background-color` here as well would only be a
        // second source for the same colour.
        --row-fill: #{$mem-yellow};
        color: $mem-ink;
        // The hatch as a RING: texture in the padding, smooth under the word.
        // Running it across the whole segment puts strokes through the label —
        // see the hatch section in .claude/rules/styling.md.
        @include mem-hatch-ring(26px, $on: accent);
    }
}
</style>
