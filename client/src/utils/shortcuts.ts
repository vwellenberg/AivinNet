/**
 * Every keyboard shortcut the app answers to. The overlay (`?`), the settings
 * page, the transport tooltips and the Quick play hint are all built from this
 * list, so none of them can disagree with the others.
 *
 * It must not drift from the handlers: `src/helpers/__tests__/shortcutsCensus.test.ts`
 * reads each handler's source and fails when a key is added or removed on one
 * side only. `handledIn` names the file that answers the key.
 */

export type ShortcutGroup = 'Playback' | 'Navigation' | 'Lists' | 'Quick play'

export type Platform = 'mac' | 'other'

/**
 * Keys pressed together, as display tokens. `Mod` is the platform's command key:
 * ⌘ on macOS, Ctrl elsewhere. Every other token is shown as written.
 */
export type Chord = readonly string[]

export interface Shortcut {
    id: string
    group: ShortcutGroup
    /** The file whose handler answers this key. */
    handledIn: 'useKeyboard' | 'pageFind' | 'quickPlay' | 'QuickPlay.vue' | 'App.vue'
    /** The `KeyboardEvent.key` values (lowercased) that handler matches. Empty when the entry is not a key match. */
    handlerKeys: readonly string[]
    /** Any one of these alternatives triggers the shortcut. */
    chords: readonly Chord[]
    description: string
    /** Where it works, when that is not everywhere. */
    where?: string
    /** Short wording for the Quick play hint line. */
    hint?: string
}

// macOS takes Ctrl + arrows for switching desktops (Mission Control) before the
// page sees them. Cmd + arrows is no way out: the browser goes back and forward.
const MAC_SPACES_NOTE = 'On macOS only with the Mission Control shortcuts turned off'

export const SHORTCUTS: readonly Shortcut[] = [
    {
        id: 'playPause',
        group: 'Playback',
        handledIn: 'useKeyboard',
        handlerKeys: [' '],
        chords: [['Space']],
        description: 'Play or pause',
    },
    {
        id: 'prev',
        group: 'Playback',
        handledIn: 'useKeyboard',
        handlerKeys: ['arrowleft'],
        chords: [['←']],
        description: 'Previous track',
        where: 'Not while text is selected on the page',
    },
    {
        id: 'next',
        group: 'Playback',
        handledIn: 'useKeyboard',
        handlerKeys: ['arrowright'],
        chords: [['→']],
        description: 'Next track',
        where: 'Not while text is selected on the page',
    },
    {
        id: 'seekBack',
        group: 'Playback',
        handledIn: 'useKeyboard',
        handlerKeys: ['arrowleft'],
        chords: [['Ctrl', '←']],
        description: 'Seek 10 seconds back',
        where: MAC_SPACES_NOTE,
    },
    {
        id: 'seekForward',
        group: 'Playback',
        handledIn: 'useKeyboard',
        handlerKeys: ['arrowright'],
        chords: [['Ctrl', '→']],
        description: 'Seek 10 seconds forward',
        where: MAC_SPACES_NOTE,
    },
    {
        id: 'sidebar',
        group: 'Navigation',
        handledIn: 'useKeyboard',
        handlerKeys: ['b'],
        chords: [['Ctrl', 'B']],
        description: 'Show or hide the right sidebar',
    },
    {
        id: 'escape',
        group: 'Navigation',
        handledIn: 'useKeyboard',
        handlerKeys: ['escape'],
        chords: [['Esc']],
        description: 'Close the open dialog or menu',
    },
    {
        id: 'help',
        group: 'Navigation',
        handledIn: 'useKeyboard',
        handlerKeys: ['?'],
        chords: [['?']],
        description: 'Show this list',
    },
    {
        id: 'startTyping',
        group: 'Navigation',
        handledIn: 'App.vue',
        handlerKeys: [],
        chords: [['A–Z'], ['0–9']],
        description: 'Jump to the search field and start typing',
        where: 'Not while a text field already has focus',
    },
    {
        id: 'find',
        group: 'Lists',
        handledIn: 'pageFind',
        handlerKeys: ['f'],
        chords: [['Mod', 'F']],
        description: 'Find in the list',
        where: 'Playlist, album, artist tracks, folder and favourites',
    },
    {
        id: 'quickPlay',
        group: 'Quick play',
        handledIn: 'quickPlay',
        handlerKeys: ['p'],
        chords: [['Mod', 'P']],
        description: 'Quick play: type part of a song title and play it',
    },
    {
        id: 'qpPlay',
        group: 'Quick play',
        handledIn: 'QuickPlay.vue',
        handlerKeys: ['enter'],
        chords: [['Enter']],
        description: 'Play the selected match, or the best one',
        hint: 'play',
    },
    {
        id: 'qpPlayNext',
        group: 'Quick play',
        handledIn: 'QuickPlay.vue',
        handlerKeys: ['enter'],
        chords: [['Shift', 'Enter']],
        description: 'Play the match next, after the current track',
        hint: 'play next',
    },
    {
        id: 'qpSelect',
        group: 'Quick play',
        handledIn: 'QuickPlay.vue',
        handlerKeys: ['arrowup', 'arrowdown'],
        chords: [['↑'], ['↓']],
        description: 'Select the match above or below',
    },
    {
        id: 'qpClose',
        group: 'Quick play',
        handledIn: 'QuickPlay.vue',
        handlerKeys: ['escape'],
        chords: [['Esc']],
        description: 'Close quick play',
        hint: 'close',
    },
]

export const GROUP_ORDER: readonly ShortcutGroup[] = ['Playback', 'Navigation', 'Lists', 'Quick play']

/**
 * Mac or not, from the browser's platform strings. iPhone and iPad count as
 * Mac: an iPad with a keyboard uses the command key. Takes its input as a
 * parameter so the test can say which platform it is.
 */
export function platformOf(nav?: { platform?: string; userAgent?: string } | null): Platform {
    const s = `${nav?.platform ?? ''} ${nav?.userAgent ?? ''}`
    return /mac|iphone|ipad|ipod/i.test(s) ? 'mac' : 'other'
}

export function currentPlatform(): Platform {
    return typeof navigator === 'undefined' ? 'other' : platformOf(navigator)
}

/** One chord as display tokens: `['Mod', 'P']` is `['⌘', 'P']` on macOS and `['Ctrl', 'P']` elsewhere. */
export function chordTokens(chord: Chord, platform: Platform = currentPlatform()): string[] {
    return chord.map(token => (token === 'Mod' ? (platform === 'mac' ? '⌘' : 'Ctrl') : token))
}

/**
 * One chord as text. Mac puts the command glyph straight against the key
 * (`⌘P`), everything else joins with `+` (`Ctrl+P`, `Shift+Enter`).
 */
export function chordText(chord: Chord, platform: Platform = currentPlatform()): string {
    const tokens = chordTokens(chord, platform)
    return tokens.join(platform === 'mac' && tokens[0] === '⌘' ? '' : '+')
}

export function shortcutById(id: string): Shortcut {
    const found = SHORTCUTS.find(s => s.id === id)
    if (!found) throw new Error(`Unknown shortcut "${id}"`)
    return found
}

/** The first way to press a shortcut, as text: `Ctrl+B`, `⌘P`, `Space`. */
export function shortcutText(id: string, platform: Platform = currentPlatform()): string {
    return chordText(shortcutById(id).chords[0], platform)
}

/** A label with its key in brackets, for tooltips: `Previous (←)`. */
export function withKey(label: string, id: string, platform: Platform = currentPlatform()): string {
    return `${label} (${shortcutText(id, platform)})`
}

/** The footer line of quick play: every box key that has a hint, in list order. */
export function quickPlayHint(platform: Platform = currentPlatform()): string {
    return SHORTCUTS.filter(s => s.group === 'Quick play' && s.hint)
        .map(s => `${chordText(s.chords[0], platform)} ${s.hint}`)
        .join(' · ')
}
