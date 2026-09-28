<template>
    <div class="setting-select rounded-sm no-scroll">
        <!-- Buttons, not divs (#137): the segments are the app's most common
             setting control, and they were unreachable by keyboard. `aria-
             pressed` says which one is on — the fill alone cannot. -->
        <button
            v-for="option in optionsWithActive"
            :key="option.title"
            type="button"
            class="option"
            :class="{ active: option.active }"
            :aria-pressed="option.active"
            @click="setterFn(option.value)"
        >
            {{ option.title }}
        </button>
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
        // Restated for the <button>: the base reset zeroes padding and switches
        // the display, both of which the segment's geometry relies on.
        display: block;
        background-color: transparent;
        border: none;
        font: inherit;
        font-weight: 600;
        padding: 0.5rem;
        cursor: pointer;
        user-select: none;
        min-width: 4rem;
        text-align: center;
        color: $mem-content-text;

        // Every segment is pressable, so every segment carries the ring — it
        // used to be the ACTIVE one only, which made the texture read as
        // "selected" rather than "pressable" (the same kind of tabs on the
        // charts page had none at all). `$ring-y` stays inside the 0.5rem
        // padding, so the strokes keep clear of the label.
        @include mem-label-hatch(26px, $on: surface, $ring-y: 0.25rem);

        // The pointer token, not an accent (#422).
        &:hover:not(.active) {
            background-color: var(--mem-hover);
            color: var(--mem-hover-text);
            --label-hatch: var(--mem-hatch-hover);
        }
    }

    .option.active {
        // Yellow means ON -> pin static ink for the label, and the static ink
        // sprite with it (styling.md, hatch rule 2).
        background-color: var(--look-selected-fill, #{$mem-yellow});
        color: var(--look-selected-text, #{$mem-ink});
        --label-hatch: var(--mem-hatch-accent);
    }
}
</style>
