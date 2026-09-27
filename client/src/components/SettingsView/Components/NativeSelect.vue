<template>
    <!-- A native <select>, not the segmented Select beside it: that one lays
         every option out as a button, which works for three choices and not for
         24 hours or ~400 time zones. Native also brings keyboard, type-ahead and
         the phone's own picker for free. -->
    <label class="setting-native-select rounded-sm">
        <span class="visually-hidden">{{ label }}</span>
        <select :value="source()" @change="onChange">
            <option v-for="option in options" :key="String(option.value)" :value="option.value">
                {{ option.title }}
            </option>
        </select>
    </label>
</template>

<script setup lang="ts">
import { SettingOption } from '@/interfaces/settings'

const props = defineProps<{
    options: SettingOption[] | undefined
    source: () => any
    setterFn: (value: any) => void
    label?: string
}>()

function onChange(e: Event) {
    // <select> hands back a string; give the setter the option's own value so a
    // numeric option (an hour) stays a number.
    const raw = (e.target as HTMLSelectElement).value
    const option = props.options?.find(o => String(o.value) === raw)
    props.setterFn(option ? option.value : raw)
}
</script>

<style lang="scss">
.setting-native-select {
    display: block;
    flex-shrink: 0;
    position: relative;
    @include candy-box($mem-panel, $candy-radius-sm);
    // Same raised plane as the segmented select and the toggle.
    @include candy-shadow(3px, 3px);
    overflow: hidden;

    select {
        display: block;
        appearance: none;
        -webkit-appearance: none;
        min-height: 2.75rem; // 44 px touch target
        max-width: 16rem;
        padding: 0 2rem 0 0.75rem;
        border: none;
        outline: none;
        background-color: transparent;
        color: $mem-content-text;
        font: inherit;
        font-weight: 600;
        font-variant-numeric: tabular-nums;
        cursor: pointer;
        text-overflow: ellipsis;

        &:hover {
            background-color: var(--mem-hover);
            color: var(--mem-hover-text);
        }

        &:focus-visible {
            outline: $focus-ring-w solid currentColor;
            outline-offset: -4px;
        }

        // The popup list is drawn by the OS; without this, dark mode shows
        // light-on-light options in some browsers.
        option {
            background-color: $mem-panel;
            color: $mem-content-text;
        }
    }

    // Chevron: a CSS triangle in the text colour, so it follows hover and mode.
    &::after {
        content: '';
        position: absolute;
        right: 0.75rem;
        top: 50%;
        margin-top: -2px;
        border: 5px solid transparent;
        border-top-color: currentColor;
        border-bottom: none;
        pointer-events: none;
        color: $mem-content-text;
    }

    &:hover::after {
        color: var(--mem-hover-text);
    }

    .visually-hidden {
        position: absolute;
        width: 1px;
        height: 1px;
        overflow: hidden;
        clip: rect(0 0 0 0);
        white-space: nowrap;
    }
}
</style>
