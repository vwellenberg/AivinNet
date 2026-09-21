<template>
    <div class="smdropdown buttons" :class="component_key">
        <div class="select rounded-sm">
            <button
                class="selected"
                :class="{ showDropDown }"
                @click.prevent="handleOpener"
                :title="
                    reverse !== 'hide'
                        ? `sort by: ${current.title} ${reverse ? 'Descending' : 'Ascending'}`.toUpperCase()
                        : undefined
                "
            >
                <span class="ellip">{{ current.title }}</span>
                <ArrowSvg :class="{ reverse }" class="dropdown-arrow" v-if="reverse !== 'hide'" />
            </button>
            <div v-if="showDropDown" ref="dropOptionsRef" class="options rounded no-scroll shadow-lg">
                <!-- The opener was already a button; its options were not (#137). -->
                <button
                    v-for="item in items"
                    :key="item.key"
                    type="button"
                    class="option"
                    :class="{ current: current.key == item.key }"
                    :aria-pressed="current.key == item.key"
                    @click.prevent="handleClick(item)"
                >
                    {{ item.title }}
                </button>
            </div>
        </div>
    </div>
</template>
<script setup lang="ts">
import { onClickOutside } from '@vueuse/core'
import { Ref, ref } from 'vue'

import ArrowSvg from '@/assets/icons/arrow.svg'

const showDropDown = ref(false)
const dropOptionsRef: Ref<HTMLElement | undefined> = ref()

interface Item {
    key: string
    title: string
}

defineProps<{
    items: Item[]
    current: Item
    component_key: string
    reverse: boolean | 'hide'
}>()

const emit = defineEmits<{
    (event: 'itemClicked', item: any): void
}>()

const handleOpener = () => {
    showDropDown.value = !showDropDown.value
}

const handleClick = (item: any) => {
    emit('itemClicked', item)
    showDropDown.value = false
}

onClickOutside(dropOptionsRef, e => {
    // @ts-ignore
    e.stopImmediatePropagation()
    showDropDown.value = false
})
</script>

<style lang="scss">
.smdropdown {
    z-index: 1000;

    .dropdown-arrow {
        width: 100%;
        aspect-ratio: 1;
    }

    // A control that has to READ as a button, so it takes the role rather than
    // inventing a look. It used to be `background: transparent` with a 1px
    // outline: on the folder page that puts 12px uppercase text straight on the
    // memphis ground, where a doodle passing behind it decides whether the
    // current sort is legible. `btn-action` brings the panel fill, the ink
    // frame, the offset shadow and a theme-aware label — plus the 44px touch
    // target the 32px box never had.
    .selected {
        // A dropdown option is a full-width label -> no hatch (#476).
        @include btn-action($width: 100%, $radius: $candy-radius-sm, $hatch: false);
        // The role lays out flex; this control is label + fixed arrow column.
        display: grid;
        grid-template-columns: minmax(0, 1fr) 2rem;
        justify-items: start;
        gap: $smaller;
        padding-right: 0;
        text-transform: uppercase;
        font-size: 12px;

        svg {
            // Overrides the role's 1.5rem glyph: the arrow fills its column.
            width: 100%;
            height: auto;
            transform: rotate(90deg) scale(0.65);
        }

        svg.reverse {
            transform: rotate(-90deg) scale(0.65);
        }

        // Open state uses the role's own hover fill rather than a second,
        // thicker outline — the frame is already the frame.
        &.showDropDown {
            background-color: $mem-blush;
            color: $mem-ink;
        }
    }

    .select {
        position: relative;
        display: flex;
        align-items: center;
        font-size: calc($medium + 2px);
        z-index: 10;

        .options {
            @include candy-box($candy-white, $candy-radius);
            position: absolute;
            top: 120%;
            padding: $small;
            display: grid;
            width: 100%;
        }

        .option {
            // Restated for the <button>: the base reset takes the padding and
            // the block layout the option list is built on.
            display: block;
            width: 100%;
            text-align: left;
            background-color: transparent;
            border: none;
            color: inherit;
            font: inherit;
            font-weight: 500;
            cursor: pointer;
            padding: $small;
            border-radius: $candy-radius-sm;
            transition: background-color $motion-move ease-out;

            &:hover {
                background-color: $candy-pink-soft;
            }

            &:last-child {
                border-bottom: none;
            }
        }

        .current {
            // Blush accent -> pin static ink for the label.
            background-color: $candy-pink;
            color: $mem-ink;
        }
    }
}
</style>
