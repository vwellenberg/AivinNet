import { ref } from 'vue'

/**
 * "Peek" mode of the settings modal: while a control that changes the page
 * behind the modal is being held (the tile-size slider), the modal turns almost
 * see-through and its backdrop clears, so the change can be judged on the REAL
 * page rather than on a mock-up. Releasing the control brings the modal back.
 *
 * A bare flag in its own module because two places that do not know each other
 * need it: the control that is held (SettingsView/Components/RangeInput.vue)
 * and the modal shell that fades (components/modal.vue).
 */
export const peeking = ref(false)

/**
 * Hold peek mode for the duration of a drag or a key press on `el`.
 * The release is listened for on `window`: a drag routinely ends outside the
 * slider, and a pointerup that only the slider heard would leave the modal
 * invisible. Returns the cleanup.
 */
export function holdPeek(el: HTMLElement): () => void {
    const on = () => (peeking.value = true)
    const off = () => (peeking.value = false)
    const onKey = (e: KeyboardEvent) => {
        if (e.key.startsWith('Arrow') || e.key === 'Home' || e.key === 'End' || e.key.startsWith('Page')) on()
    }

    el.addEventListener('pointerdown', on)
    el.addEventListener('keydown', onKey)
    el.addEventListener('keyup', off)
    el.addEventListener('blur', off)
    window.addEventListener('pointerup', off)
    window.addEventListener('pointercancel', off)

    return () => {
        el.removeEventListener('pointerdown', on)
        el.removeEventListener('keydown', onKey)
        el.removeEventListener('keyup', off)
        el.removeEventListener('blur', off)
        window.removeEventListener('pointerup', off)
        window.removeEventListener('pointercancel', off)
        off()
    }
}
