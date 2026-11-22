<template>
    <Teleport to="body">
        <div v-if="open" class="shortcuts-help">
            <div class="sh-bg" @click="close"></div>
            <div
                ref="panelEl"
                class="sh-panel"
                role="dialog"
                aria-modal="true"
                aria-labelledby="sh-title"
                tabindex="-1"
                @keydown="onKeydown"
            >
                <header class="sh-head">
                    <h2 id="sh-title" class="sh-title">Keyboard shortcuts</h2>
                    <button ref="closeEl" type="button" class="sh-close" aria-label="Close keyboard shortcuts" title="Close" @click="close">
                        <CloseSvg />
                    </button>
                </header>
                <ShortcutList />
                <p class="sh-foot">Press ? again to close.</p>
            </div>
        </div>
    </Teleport>
</template>

<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'

import ShortcutList from '@/components/shared/ShortcutList.vue'
import CloseSvg from '@/assets/icons/close.svg'
import { closeShortcutsHelp, shortcutsHelpOpen as open } from '@/stores/shortcutsHelp'

const panelEl = ref<HTMLElement | null>(null)
const closeEl = ref<HTMLButtonElement | null>(null)

function close() {
    closeShortcutsHelp()
}

// The panel answers Esc and ? itself, because the global handler is not reached
// while focus is in here. Keys without Ctrl/Cmd stop here so nothing behind the
// panel plays or seeks; Ctrl/Cmd combinations go on to the global handler, which
// ignores them while the list is up.
function onKeydown(e: KeyboardEvent) {
    if (!e.ctrlKey && !e.metaKey) e.stopPropagation()
    if (e.key === 'Escape' || (e.key === '?' && !e.ctrlKey && !e.metaKey)) {
        e.preventDefault()
        // A held ? repeats: the repeat landed here, after the press that opened
        // the list, and closed it again at once.
        if (e.repeat) return
        close()
        return
    }
    // Focus stays in the dialog, and Tab reaches its one control: the close button.
    if (e.key === 'Tab') {
        e.preventDefault()
        closeEl.value?.focus()
    }
}

// Focus goes into the panel on open and back to the element that had it on close,
// the same as the quick play box.
let previousFocus: HTMLElement | null = null

watch(open, async (isOpen, wasOpen) => {
    if (isOpen && !wasOpen) {
        previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
        await nextTick()
        panelEl.value?.focus()
    }
    if (!isOpen && wasOpen) {
        const back = previousFocus
        previousFocus = null
        if (back && back.isConnected) back.focus()
    }
})
</script>

<style lang="scss">
.shortcuts-help {
    position: fixed;
    inset: 0;
    // Above the page chrome, level with the quick play box, which is never open
    // together with this one.
    z-index: 70;
    display: grid;
    place-items: start center;
    padding-top: 8vh;

    .sh-bg {
        position: absolute;
        inset: 0;
        background-color: rgb(0, 0, 0, 0.6);
    }

    .sh-panel {
        position: relative;
        width: min(640px, 100vw - 32px);
        max-height: 84vh;
        overflow-y: auto;
        padding: 1rem 1.25rem 1.25rem;
        display: grid;
        gap: 1rem;
        color: $candy-text;
        outline: none;
        @include candy-box($candy-white, $candy-radius);
        @include candy-shadow(6px, 6px);
        animation: mem-plate-rise $motion-settle ease-out;
    }

    .sh-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: $small;
    }

    .sh-title {
        margin: 0;
        font-size: 1.25rem;
        font-weight: 700;
        color: $candy-text;
    }

    // The one pressable thing in the overlay: a role, so the 44px target, the
    // shadow and the hover come with it.
    .sh-close {
        @include btn-action($glyph: 1.5rem);
    }

    .sh-foot {
        margin: 0;
        font-size: 13px;
        color: $candy-text-muted;
    }
}
</style>
