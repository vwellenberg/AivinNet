<template>
    <div
        class="gsearch-input"
        @click="
            $route.name !== Routes.search &&
                $router.push({
                    name: Routes.search,
                    params: { page: 'top' },
                    query: { q: search.query },
                })
        "
    >
        <div id="ginner" ref="inputRef" tabindex="0">
            <button
                v-auto-animate
                :title="tabs.current === tabs.tabs.search ? 'back to queue' : 'go to search'"
                :class="{ no_bg: on_nav }"
                @click.prevent="handleButton"
            >
                <SearchSvg v-if="on_nav || tabs.current === tabs.tabs.queue" />
                <BackSvg v-else />
            </button>
            <input
                id="globalsearch"
                v-model.trim="search.query"
                placeholder="Start typing to search"
                type="search"
                autocomplete="off"
                spellcheck="false"
                @blur.prevent="removeFocusedClass"
                @focus.prevent="addFocusedClass"
            />
            <div
                class="clear_input circular noSelect"
                :class="{ active: search.query.length > 0 }"
                @click.stop="clearInput"
            >
                <CancelSvg />
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import useSearch from '@/stores/search'
import useSettings from '@/stores/settings'
import useTabStore from '@/stores/tabs'
import { ref } from 'vue'

import CancelSvg from '@/assets/icons/a.svg'
import BackSvg from '@/assets/icons/arrow.svg'
import SearchSvg from '@/assets/icons/search.svg'
import { Routes } from '@/router'

const props = defineProps<{
    on_nav?: boolean
}>()

const tabs = useTabStore()
const search = useSearch()
const settings = useSettings()

// HANDLE FOCUS
const inputRef = ref<HTMLInputElement | null>(null)

// NOTE: Functions are used because classes are added to the sorrounding element
// and not the input itself.
function addFocusedClass() {
    if (inputRef.value) {
        inputRef.value.classList.add('search-focused')
    }
}

function removeFocusedClass() {
    if (inputRef.value) {
        inputRef.value.classList.remove('search-focused')
    }
}

function clearInput() {
    search.query = ''
    if (inputRef.value) {
        inputRef.value.focus()
    }
}

// @end

function handleButton() {
    if (props.on_nav) return

    if (tabs.current === tabs.tabs.search) {
        tabs.switchToQueue()
    } else {
        tabs.switchToSearch()
    }
}
</script>

<style>
.clear_search {
    /* Style applied when clear_search class is active */
    visibility: visible;
    cursor: pointer;
}
</style>

<style lang="scss">
// Give the search bar a wide, Spotify-style footprint in the top nav and let
// the input fill it (it used to be pinned to a tiny fixed 150px).
.right > .gsearch-input {
    width: clamp(280px, 34vw, 460px);

    @include allPhones {
        width: 100%;
    }
}

.right > .gsearch-input > #ginner > input {
    width: 100%;

    @include allPhones {
        width: 100%;
    }
}

.gsearch-input {
    display: grid;
    grid-template-columns: 1fr max-content;

    #ginner {
        width: 100%;
        // The chrome footprint, same as the home button beside it, so the pill
        // fills the top nav (Spotify-style) instead of sitting small with empty
        // padding above and below.
        height: $bar-control;
        display: flex;
        align-items: center;
        @include candy-box($candy-pink-soft, $candy-radius-pill);
        color: $candy-text;
        transition: background-color $motion-tint $motion-curve;

        &:hover {
            background-color: $candy-pink;
        }

        input::placeholder {
            color: $candy-text-faint;
            opacity: 1;
        }

        button {
            background: transparent;
            border: none;
            width: 1.625rem;
            height: 1.625rem;
            padding: 0;
            margin-left: 6px;
            margin-right: $smaller;
            border-radius: $candy-radius-pill;
            cursor: pointer;
            flex-shrink: 0;
            // Adaptive glyph on the panel input; hover flips to the yellow
            // accent fill -> pin static ink there.
            color: $candy-text;
            // On the transition, not inside `:hover` — declared there it only
            // exists WHILE hovered, so the way back was instant. `all` also
            // animated the geometry, which is never what was wanted here.
            transition: background-color $motion-tint $motion-curve, color $motion-tint $motion-curve;

            &:hover {
                background-color: $candy-pink-deep;
                color: $mem-ink;
            }

            @include allPhones {
                display: none;
            }
        }

        button.no_bg {
            pointer-events: none;
        }

        input {
            width: 100%;
            border: none;
            line-height: 2.25rem;
            color: inherit;
            font-size: 14px;
            font-weight: 500;
            background-color: transparent;
            outline: none;
            appearance: none;
            text-overflow: ellipsis;

            @include allPhones {
                font-size: 0.9rem;
                font-weight: 600;
                padding-right: $small;
            }
        }

        .clear_input {
            cursor: pointer;
            margin-right: $smaller;
            opacity: 0;
            visibility: hidden;
            transition: opacity 0.3s ease-out, visibility 0.3s ease-out, background-color 0.2s ease-out;
            width: 1.75rem;
            aspect-ratio: 1;

            display: grid;
            place-items: center;
            flex-shrink: 0;

            &:hover {
                background-color: $candy-pink-deep;
            }

            svg {
                height: 1rem;
            }

            @include allPhones {
                width: $larger;
                border-radius: 4px;
                margin-right: $small;
            }
        }

        .clear_input.active {
            opacity: 1;
            visibility: visible;
        }

        .clear_input.active:active {
            opacity: 0.3;
        }

        @include allPhones {
            // No pill on phones (transparent, no border) — but the height stays
            // the chrome footprint. It used to drop to 2.25rem here to match a
            // 36px avatar, which is the kind of compensation that disappears
            // the moment the thing it compensates for is itself corrected: the
            // avatar and the toggle are one footprint now, so the top bar keeps
            // a constant height across all views without a second number.
            border: none;
            border-radius: unset;
            background-color: transparent;
        }
    }

    @include allPhones {
        width: 100%;
    }
}

// Focus: the border stays black; the fill swaps to white so the focused
// state is visible on the white top bar (replaces the old white outline ring).
#ginner.search-focused {
    background-color: $candy-white;

    @include allPhones {
        background-color: transparent;
    }
}
</style>
