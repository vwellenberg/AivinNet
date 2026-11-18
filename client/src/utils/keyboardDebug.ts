/**
 * TEMPORARY on-device diagnosis: why does the phone keyboard not come back
 * when the search field is tapped again? (Galaxy S22, Vivaldi, 2026-11-18.)
 *
 * Headless Chromium has no soft keyboard and no real finger, and three fixes
 * that looked right there (#848, #850, #851) did nothing on the device. A plain
 * <input> on a test page DOES bring the keyboard back on that same phone, so
 * something in this app differs. This logs, on the screen of the real device,
 * what each tap actually does: which element the finger's events land on,
 * whether anything cancels them, where the focus goes, and what the viewport
 * does when the keyboard opens and closes.
 *
 * Off unless the address contains `kbdebug` (then on for the tab's session).
 * ⚠️ AFTER the `#`: `…/#/search/top?kbdebug`. The hash router rewrites the
 * address on start and drops everything between the path and the `#`, before
 * this code runs — `…/?kbdebug#/…` arrives here without the flag.
 * It only listens; it changes no behaviour. Remove once the cause is known.
 */

const FLAG = 'kbdebug'
const EVENTS = ['touchstart', 'touchend', 'pointerdown', 'mousedown', 'click', 'focusin', 'focusout', 'keydown'] as const
const MAX_LINES = 80

export function keyboardDebugWanted(href: string, stored: string | null): boolean {
    return href.includes(FLAG) || stored === '1'
}

/** A short, readable name for an event target. */
export function describe(target: EventTarget | null): string {
    if (!(target instanceof Element)) return target === window ? 'window' : target === document ? 'document' : String(target)
    if (target.id) return `#${target.id}`
    const cls = typeof target.className === 'string' ? target.className.trim().split(/\s+/)[0] : ''
    return target.tagName.toLowerCase() + (cls ? `.${cls}` : '')
}

export function installKeyboardDebug(): void {
    let stored: string | null = null
    try {
        stored = sessionStorage.getItem(FLAG)
    } catch {
        /* storage blocked: the URL flag still works for this page load */
    }
    if (!keyboardDebugWanted(location.href, stored)) return
    try {
        sessionStorage.setItem(FLAG, '1')
    } catch {
        /* see above */
    }

    const t0 = performance.now()
    const lines: string[] = []

    const panel = document.createElement('div')
    panel.setAttribute('data-kbdebug', '')
    Object.assign(panel.style, {
        position: 'fixed',
        left: '0',
        right: '0',
        bottom: '0',
        maxHeight: '38vh',
        overflow: 'auto',
        zIndex: '2147483647',
        background: 'rgba(0,0,0,0.82)',
        color: '#e8ffe8',
        font: '11px/1.35 ui-monospace, monospace',
        padding: '6px 8px calc(6px + env(safe-area-inset-bottom, 0px))',
        pointerEvents: 'none',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
    })
    const bar = document.createElement('div')
    Object.assign(bar.style, { display: 'flex', gap: '8px', marginBottom: '4px', pointerEvents: 'auto' })
    const button = (label: string, onClick: () => void) => {
        const b = document.createElement('button')
        b.type = 'button'
        b.textContent = label
        Object.assign(b.style, {
            font: '12px sans-serif',
            padding: '6px 10px',
            borderRadius: '6px',
            border: '0',
            background: '#ffffff',
            color: '#000000',
        })
        b.addEventListener('click', onClick)
        bar.appendChild(b)
        return b
    }
    const body = document.createElement('div')
    const copy = button('Copy log', () => {
        navigator.clipboard?.writeText(lines.join('\n')).then(
            () => (copy.textContent = 'Copied'),
            () => (copy.textContent = 'Copy failed: screenshot')
        )
    })
    button('Clear', () => {
        lines.length = 0
        body.textContent = ''
    })
    button('Off', () => {
        try {
            sessionStorage.removeItem(FLAG)
        } catch {
            /* nothing to clear */
        }
        panel.remove()
    })
    panel.append(bar, body)

    const log = (text: string) => {
        const line = `${((performance.now() - t0) / 1000).toFixed(2)} ${text}`
        lines.push(line)
        if (lines.length > MAX_LINES) lines.shift()
        body.textContent = lines.slice().reverse().join('\n')
    }

    const vv = window.visualViewport
    const sizes = () =>
        `vv ${vv ? `${Math.round(vv.width)}x${Math.round(vv.height)}` : 'none'} win ${innerWidth}x${innerHeight}`

    for (const type of EVENTS) {
        // Bubble phase on window runs after every handler in the page, so
        // `defaultPrevented` here says whether anything cancelled the event.
        window.addEventListener(
            type,
            (e: Event) => {
                if (e.target instanceof Element && e.target.closest('[data-kbdebug]')) return
                let extra = ''
                if (e instanceof PointerEvent) extra = ` ${e.pointerType}`
                if (e instanceof FocusEvent) extra = ` -> ${describe(e.relatedTarget)}`
                if (e instanceof KeyboardEvent) extra = ` key=${e.key}`
                const prevented = e.defaultPrevented ? ' PREVENTED' : ''
                log(`${type} ${describe(e.target)}${extra}${prevented} | active ${describe(document.activeElement)}`)
            },
            { passive: true }
        )
    }
    vv?.addEventListener('resize', () => log(`resize ${sizes()}`))
    window.addEventListener('resize', () => log(`win-resize ${sizes()}`))

    const mount = () => {
        document.body.appendChild(panel)
        log(`start ${sizes()} ${navigator.userAgent}`)
    }
    if (document.body) mount()
    else document.addEventListener('DOMContentLoaded', mount, { once: true })
}
