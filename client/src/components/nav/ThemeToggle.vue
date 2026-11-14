<template>
    <button
        v-context-menu="openMenu"
        class="theme-toggle"
        :class="settings.theme === 'light' ? 'to-dark' : 'to-light'"
        :title="title"
        aria-haspopup="menu"
        @click="settings.toggleTheme"
    >
        <MoonSvg v-if="settings.theme === 'light'" />
        <SunSvg v-else />
        <span v-if="settings.auto_theme" class="auto-badge" aria-hidden="true">A</span>
    </button>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import { ContextSrc } from '@/enums'
import useContextStore from '@/stores/context'
import useModalStore from '@/stores/modal'
import useSettings from '@/stores/settings'
import { themeMenuOptions } from '@/utils/themeMenu'

import MoonSvg from '@/assets/icons/moon.svg'
import SunSvg from '@/assets/icons/sun.svg'

const settings = useSettings()

// The glyph shows what the click will DO (moon = switch to dark), so the title
// has to say the same thing or the two contradict each other. Mentioning the
// side effect matters: toggling by hand turns automatic switching off.
const title = computed(() => {
    const target = settings.theme === 'light' ? 'dark' : 'light'
    return settings.auto_theme
        ? `Auto dark mode is on. Click: switch to ${target} (turns Auto off) — hold or right-click for options`
        : `Switch to ${target} mode — hold or right-click for Auto`
})

// Long-press, right-click and the context-menu key come in through the
// v-context-menu directive: iOS never fires a plain contextmenu listener for a
// touch (styling.md, "iOS feuert kein contextmenu").
function openMenu(e: MouseEvent) {
    const options = () => themeMenuOptions(settings, () => useModalStore().showSettingsModal())
    useContextStore().showContextMenu(e, options, ContextSrc.ThemeToggle)
}
</script>

<style lang="scss">
.theme-toggle {
    // One chrome footprint, desktop and phone. It used to be 2.25rem on the
    // desktop (sized to the avatar beside it) and 2.75rem on phones, which put
    // a 36px control next to a 48px home button in the same row and made the
    // touch target a breakpoint's job rather than the control's.
    //
    // Nothing but the fill is stated here: the role owns border, shadow, glyph
    // size and BOTH pointer answers. The local `svg { 1.3rem }` made this the
    // one 20.8px glyph in a bar of 24px ones, and the local
    // `:active { scale(0.94) }` was a third press behaviour next to the role's
    // 0.98 and the home button's push-into-the-shadow.
    @include btn-action($size: $bar-control);
    // Hatch = "you can press this" (#378). `accent` because every fill below is
    // a static memphis colour: the strokes stay ink in both themes, like the
    // glyph on top of them. 28px is the button tile — the play CTA's.
    @include mem-hatch(28px, $on: accent);
    color: $candy-black;
    // Anchor for the auto badge in the bottom-right corner.
    position: relative;

    // "A" tag while Auto dark mode is on. Decorative only: the button stays
    // the one control, so the badge takes no pointer of its own.
    .auto-badge {
        position: absolute;
        right: -4px;
        bottom: -4px;
        z-index: 1;
        display: flex;
        align-items: center;
        height: 16px;
        padding: 0 3px;
        border: $mem-ring-w solid $mem-ink;
        border-radius: 4px;
        background-color: var(--look-on-fill, #{$mem-yellow});
        color: var(--look-on-glyph, #{$mem-ink});
        font-size: 0.65rem;
        font-weight: 700;
        line-height: 1;
        pointer-events: none;
    }

    // The fill follows the GLYPH, not the theme: the moon (switch to dark)
    // sits on lavender, the sun (switch to light) on yellow. The button says
    // what the click will do, so its colour may as well say it too.
    &.to-dark {
        background-color: mem-pastel($mem-lavender);
    }

    &.to-light {
        background-color: mem-pastel($mem-yellow);
    }

    // Restated on purpose, though the role already hovers: `.to-dark` and
    // `.to-light` tie with the role's `:hover` on specificity and stand later
    // in source, so their fill would win and the button would not answer the
    // pointer (this copy was still blush, the colour #422 retired). The hatch
    // arrives from the role unopposed; the text token stands beside the fill
    // because the two only ever move together.
    // Only where there is a pointer: on touch `:hover` latches after the tap,
    // and the toggle just tapped stood as a paper-white plate in the dark
    // theme until the next tap elsewhere (user, 2026-10-17).
    @media (hover: hover) {
        &:hover {
            background-color: var(--mem-hover);
            color: var(--mem-hover-text);
        }
    }
}
</style>
