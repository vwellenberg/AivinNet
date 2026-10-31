/**
 * `v-tip="'Sleep timer'"`: a hover hint in the app's own look, for icon-only
 * buttons whose glyph alone does not say what they do (user, 2026-10-30:
 * "what is the sleep button for?").
 *
 * Why not the native `title`: it shows only after about a second, in the OS
 * look, and not at all while the mouse keeps moving, so in practice nobody
 * sees it. This one shows after a short pause, in the progress bar's tooltip
 * look (`Global/hover-tip.scss`), above the element and kept on screen.
 *
 * Mouse and keyboard only. A touch has no hover, and a hint that pops up on a
 * tap would cover the menu the tap just opened. The text also becomes the
 * element's `aria-label`, so a screen reader names the button the same way.
 *
 * One shared element for the whole app: only one hint is ever visible.
 */
import type { Directive } from 'vue'

export const SHOW_DELAY_MS = 300
// Space between the element and the hint, and the least distance to the window edge.
const GAP = 8
const EDGE = 4

interface TipState {
    text: string
    timer?: ReturnType<typeof setTimeout>
    off: () => void
}

const states = new WeakMap<HTMLElement, TipState>()
let bubble: HTMLDivElement | null = null
let owner: HTMLElement | null = null

function bubbleEl(): HTMLDivElement {
    if (!bubble || !bubble.isConnected) {
        bubble = document.createElement('div')
        bubble.className = 'hover-tip'
        bubble.setAttribute('role', 'tooltip')
        document.body.appendChild(bubble)
    }
    return bubble
}

function place(el: HTMLElement, tip: HTMLDivElement): void {
    const box = el.getBoundingClientRect()
    const width = tip.offsetWidth
    const height = tip.offsetHeight
    const maxLeft = window.innerWidth - width - EDGE

    const left = Math.min(Math.max(box.left + box.width / 2 - width / 2, EDGE), Math.max(maxLeft, EDGE))
    // Above by default (the player bar sits at the bottom); below if there is no room.
    const above = box.top - GAP - height
    const top = above >= EDGE ? above : box.bottom + GAP

    tip.style.left = `${Math.round(left)}px`
    tip.style.top = `${Math.round(top)}px`
}

export function showTip(el: HTMLElement): void {
    const state = states.get(el)
    if (!state || !state.text || !el.isConnected) return
    const tip = bubbleEl()
    tip.textContent = state.text
    tip.classList.add('visible')
    owner = el
    place(el, tip)
}

export function hideTip(el?: HTMLElement): void {
    if (el) {
        const state = states.get(el)
        if (state?.timer) clearTimeout(state.timer)
        if (state) state.timer = undefined
        if (owner !== el) return
    }
    owner = null
    bubble?.classList.remove('visible')
}

function setText(el: HTMLElement, text: unknown): void {
    const state = states.get(el)
    if (!state) return
    state.text = typeof text === 'string' ? text : ''
    if (state.text) el.setAttribute('aria-label', state.text)
    // A hint that changes while it is shown (the sleep timer counting down).
    if (owner === el) {
        if (state.text) showTip(el)
        else hideTip(el)
    }
}

const vTip: Directive<HTMLElement, string> = {
    mounted(el, binding) {
        const state: TipState = { text: '', off: () => {} }
        states.set(el, state)
        setText(el, binding.value)

        const enter = (e: PointerEvent) => {
            if (e.pointerType !== 'mouse') return
            if (state.timer) clearTimeout(state.timer)
            state.timer = setTimeout(() => {
                state.timer = undefined
                showTip(el)
            }, SHOW_DELAY_MS)
        }
        const leave = () => hideTip(el)
        // Keyboard focus shows it at once; a click's focus does not (`:focus-visible`).
        const focus = () => {
            if (el.matches(':focus-visible')) showTip(el)
        }

        el.addEventListener('pointerenter', enter)
        el.addEventListener('pointerleave', leave)
        // A click opens a menu or a modal; the hint would only cover it.
        el.addEventListener('pointerdown', leave)
        el.addEventListener('focus', focus)
        el.addEventListener('blur', leave)
        state.off = () => {
            el.removeEventListener('pointerenter', enter)
            el.removeEventListener('pointerleave', leave)
            el.removeEventListener('pointerdown', leave)
            el.removeEventListener('focus', focus)
            el.removeEventListener('blur', leave)
        }
    },
    updated(el, binding) {
        if (binding.value !== binding.oldValue) setText(el, binding.value)
    },
    unmounted(el) {
        hideTip(el)
        states.get(el)?.off()
        states.delete(el)
    },
}

export default vTip
