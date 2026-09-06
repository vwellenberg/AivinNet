<template>
    <div class="r-sidebar">
        <div class="rtopbar">
            <AvatarWithDropdown />
        </div>
        <NowPlayingPanel />
    </div>
</template>

<script setup lang="ts">
/**
 * The right sidebar IS the Now Playing panel (#424).
 *
 * It used to be three tabs — a dashboard, a search view and the queue — behind
 * a setting that is off by default and needs more than 1280px. What it showed
 * was a search field, a shuffle button and one queue row in the pre-Inlay
 * style, while the same information had better homes everywhere else in the
 * app. The panel replaces all of it with the one thing this space is good for:
 * what is playing, who made it, and what comes next.
 *
 * The search field moved out rather than moving along. Search has its own page
 * and sits in the top bar; a second entry point here only ever duplicated it.
 */
import AvatarWithDropdown from '@/components/nav/AvatarWithDropdown.vue'
import NowPlayingPanel from './NowPlayingPanel.vue'
</script>

<style lang="scss">
.r-sidebar {
    width: 100%;
    display: grid;
    grid-template-rows: max-content 1fr;
    background-color: $candy-white;
    padding-bottom: 1rem;
    border-top: none;
    border-bottom: none;
    margin-bottom: -1rem;

    .rtopbar {
      display: flex;
      align-items: center;
      // The avatar is the only child now that the search field moved out —
      // `space-between` would have parked it on the left.
      justify-content: flex-end;
      padding: $small $small 0;
    }

    .gsearch-input {
        height: 2.5rem;
        margin: 1rem;
        width: 100%;

        #ginner {
            button {
                width: 2rem;
                height: 2rem;
                margin-left: 4px;
                margin-right: $smallest;

                > svg {
                    width: 1.75rem;
                    height: 1.75rem;
                }
            }
            > .clear_input {
                width: 2rem;
                height: 2rem;
            }
        }
    }

    .r-content {
        width: 100%;
        height: 100%;
        background-color: $candy-white;

        .r-search {
            height: 100%;
        }

        .r-dash {
            height: 100%;
        }

        .r-queue {
            height: 100%;
            overflow: hidden;
            display: grid;
            gap: $small;
            grid-template-rows: max-content 1fr;
        }
    }
}

.designatedOS .r-sidebar > .r-content > .r-queue > .queue-virtual-scroller > .scroller::-webkit-scrollbar-track {
    background-color: transparent;
}

.designatedOS .r-sidebar > .r-content > .r-queue > .queue-virtual-scroller > .scroller::-webkit-scrollbar-thumb {
    border-color: transparent;
}
</style>
