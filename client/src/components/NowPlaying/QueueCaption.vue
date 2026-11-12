<template>
    <div class="queue-caption-row">
        <!-- The played section folds: its caption is the switch. A real button
             inside the heading, so it is reachable by keyboard and announces
             its state. -->
        <h3 v-if="open !== undefined" class="queue-caption is-toggle">
            <button type="button" :aria-expanded="open" @click="emit('toggle')">
                {{ text }}
                <span v-if="count" class="queue-count" aria-hidden="true">{{ count }}</span>
                <span class="fold" :class="{ open }" aria-hidden="true">&rsaquo;</span>
            </button>
        </h3>
        <h3 v-else-if="text" class="queue-caption">
            {{ text }}
            <!-- `aria-hidden` for the same reason as the Queue caption in
                 Header.vue: the number would become part of the heading's name
                 and change on every queue mutation. -->
            <span v-if="count" class="queue-count" aria-hidden="true">{{ count }}</span>
        </h3>
        <p v-if="note" class="queue-note">{{ note }}</p>
    </div>
</template>

<script setup lang="ts">
// One caption line of the split queue (Played / Now playing / Up next), or the
// note that stands in for an empty "Up next". Rendered as a scroller row, so it
// sits outside `.now-playing-header` and carries its own sticker.
defineProps<{
    text?: string
    count?: number
    // Set = this caption folds a section; the value is whether it is open.
    open?: boolean
    note?: string
}>()

const emit = defineEmits<{ (e: 'toggle'): void }>()
</script>

<style lang="scss">
.queue-caption-row {
    // Padding, not margin: the virtual scroller measures the row's box, and a
    // child's margin collapses out of it.
    padding: 0.75rem 0 0.75rem;

    .queue-caption {
        @include mem-sticker;
        margin: 0;
        display: inline-flex;
        align-items: center;
        gap: $small;

        &.is-toggle {
            // The button is the plate's whole face, so the padding moves onto it.
            padding: 0;

            button {
                all: unset;
                box-sizing: border-box;
                display: inline-flex;
                align-items: center;
                gap: $small;
                padding: 0.3rem 0.7rem;
                cursor: pointer;

                &:focus-visible {
                    outline: $focus-ring-w solid currentColor;
                    outline-offset: 2px;
                }
            }
        }
    }

    .queue-count {
        @include mem-count-chip('track');
    }

    .fold {
        font-size: 1.2em;
        line-height: 1;
        transition: transform $motion-tint ease;

        &.open {
            transform: rotate(90deg);
        }
    }

    .queue-note {
        margin: 0;
        padding: 0.5rem 0.25rem;
        color: $candy-text;
        font-size: 0.9rem;
    }
}
</style>
