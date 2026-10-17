// ---------------------------------------------------------------------------
// A tap shows its press on iOS only if somebody listens for the touch.
//
// The button roles answer a tap with `:active` (Global/_buttons.scss); their
// `:hover` is pointer-gated, because on touch it latches after the tap. Safari
// on iOS, however, does not apply `:active` to anything but a link unless the
// element or <body> has a `touchstart` handler (MDN browser-compat-data,
// css/selectors/active → non_a_elements). Until the hover was gated, the
// latched hover was the only feedback an iPhone ever showed; without this
// listener a tap there would show nothing at all.
//
// Empty and passive: it exists to be registered, not to run, and passive so it
// can never hold up a scroll. On <body>, because that is the element the
// browser looks at; one listener covers every button, including the next one.
// ---------------------------------------------------------------------------

function noop() {}

export function installTouchActive(body: HTMLElement = document.body): () => void {
    body.addEventListener('touchstart', noop, { passive: true })
    return () => body.removeEventListener('touchstart', noop)
}
