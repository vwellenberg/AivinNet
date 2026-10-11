import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// A button's texture runs AROUND its label and glyph, never behind them (#237).
//
// `btn-primary` lays a sprinkle over its fill (the hatch on hover), `btn-action`
// a hatch. The label was only lifted above the texture with z-index — which does
// nothing about a texture showing THROUGH a transparent box: "Play" on every
// detail head read with strokes crossing the letters, and the pin, download and
// overflow glyphs next to it the same.
//
// The cover is `background-color: inherit`, deliberately not a colour: it is
// whatever fill the button has at that moment — resting, hovered, or one a call
// site sets itself (the lyrics finder's coral error plate, the yellow open-menu
// state) — so no caller has anything to keep in step. A first cut used a custom
// property instead, and needed a census of every caller to stay correct.
// ---------------------------------------------------------------------------

// Read off disk: `.scss` through Vite comes back empty under test.
const BUTTONS = readFileSync("src/assets/scss/Global/_buttons.scss", "utf8").replace(/\/\/[^\n]*/g, "");

function mixin(name: string): string {
    const start = BUTTONS.indexOf(`@mixin ${name}(`);
    const next = BUTTONS.indexOf("\n@mixin ", start + 1);
    return start === -1 ? "" : BUTTONS.slice(start, next === -1 ? undefined : next);
}

/** Bodies of every rule in `css` whose comma-separated selector list contains `selector`. */
function rulesFor(css: string, selector: string): string[] {
    const out: string[] = [];
    for (const match of css.matchAll(/([^{};]+)\{/g)) {
        const names = match[1].split(",").map((part) => part.trim());
        if (!names.includes(selector)) continue;
        // The body of THIS rule, from its own brace — not the next rule that
        // happens to start with the same selector.
        const open = (match.index ?? 0) + match[0].length - 1;
        let depth = 0;
        let i = open;
        for (; i < css.length; i++) {
            if (css[i] === "{") depth++;
            else if (css[i] === "}" && --depth === 0) break;
        }
        out.push(css.slice(open + 1, i));
    }
    return out;
}

describe.each([
    ["btn-primary", ["> svg", "> .text"]],
    ["btn-action", ["> svg"]],
])("%s", (name, covered) => {
    const body = mixin(name);

    it("is found", () => {
        expect(body).not.toBe("");
    });

    it.each(covered)("covers %s with the button's own fill", (selector) => {
        // Every rule whose selector LIST names it — a shared `> svg, > .text`
        // block counts for both, a second `> svg { border-radius }` is fine.
        const rules = rulesFor(body, selector);
        expect(rules.length, `no ${selector} rule in ${name}`).toBeGreaterThan(0);
        expect(rules.some((rule) => /background-color:\s*inherit/.test(rule))).toBe(true);
    });
});
