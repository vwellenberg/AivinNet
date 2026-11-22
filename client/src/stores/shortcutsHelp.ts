import { ref } from 'vue'

/**
 * Open state of the keyboard shortcut overlay (`?`, components/ShortcutsHelp.vue).
 * A plain module like stores/quickPlay.ts: useKeyboard opens it without importing
 * the component, and the component is mounted once in App.vue.
 */
export const shortcutsHelpOpen = ref(false)

export function openShortcutsHelp() {
    shortcutsHelpOpen.value = true
}

export function closeShortcutsHelp() {
    shortcutsHelpOpen.value = false
}

export function toggleShortcutsHelp() {
    shortcutsHelpOpen.value = !shortcutsHelpOpen.value
}
