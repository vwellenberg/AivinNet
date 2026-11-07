import { nextTick } from 'vue'

/**
 * Navigate, then focus a field that only exists on the new page — with the
 * on-screen keyboard open on a phone.
 *
 * ⚠️ iOS opens the keyboard only for a `focus()` that runs INSIDE the tap.
 * A focus after `router.push().then(…)` comes a few microtasks too late: the
 * field gets focus (caret, `:focus` styles), but the keyboard stays closed,
 * so the user has to tap the field a second time. Android's Chrome is more
 * lenient, which is why this only showed on an iPhone.
 *
 * The way round it: focus a stand-in input synchronously, in the tap — that
 * opens the keyboard — and hand the focus on to the real field once it is
 * rendered. Moving focus from one text input to another keeps the keyboard
 * up. The stand-in is removed only AFTER the hand-over; removing the focused
 * element first would close the keyboard again.
 *
 * What the user already typed into the stand-in while the page loaded (the
 * search page is a lazy chunk) travels along, so no keystroke is lost.
 *
 * Must be called synchronously from the tap/click handler.
 * Resolves `true` when the target ended up focused.
 */
export async function focusAcrossNavigation(
    navigate: () => Promise<unknown>,
    findTarget: () => HTMLElement | null,
): Promise<boolean> {
    const standIn = createStandIn()
    document.body.appendChild(standIn)
    standIn.focus({ preventScroll: true })

    try {
        await navigate()
        await nextTick()
        const target = findTarget()
        if (!target) return false
        if (standIn.value && target instanceof HTMLInputElement) {
            target.value = standIn.value
            // v-model listens for `input`, not for a programmatic value.
            target.dispatchEvent(new Event('input', { bubbles: true }))
        }
        target.focus()
        return document.activeElement === target
    } catch (error) {
        console.warn('focusAcrossNavigation: navigation failed', error)
        return false
    } finally {
        standIn.remove()
    }
}

function createStandIn(): HTMLInputElement {
    const input = document.createElement('input')
    input.type = 'text'
    // Named rather than aria-hidden: it really holds focus for a moment.
    input.setAttribute('aria-label', 'Search')
    input.tabIndex = -1
    input.autocomplete = 'off'
    input.dataset.keyboardStandIn = ''
    // Not display:none / visibility:hidden — iOS refuses focus on those.
    // 16px keeps iOS from zooming in on focus; fixed at the top keeps it from
    // scrolling the page to reach the field.
    Object.assign(input.style, {
        position: 'fixed',
        top: '0',
        left: '0',
        width: '1px',
        height: '1px',
        padding: '0',
        border: '0',
        opacity: '0',
        fontSize: '16px',
        pointerEvents: 'none',
    })
    return input
}
