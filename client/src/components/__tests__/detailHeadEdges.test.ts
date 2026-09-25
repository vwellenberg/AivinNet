import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// The detail head (album, artist, playlist) ends on the same edges as the
// content under it (#239).
//
// It carried `margin: 0 1rem 1rem` — and everything below it (track list, card
// rows, section captions) runs edge to edge in the same column. Measured at
// 1440px on all three pages: head 319..1377, list 303..1393, 16px short on each
// side; 8px on each side at phone width, where the override said `$small`.
//
// The census reads EVERY margin the anatomy file gives the heads, breakpoints
// included — the phone override is exactly where a side margin came back once
// the base rule was fixed.
// ---------------------------------------------------------------------------

const SCSS = "src/assets/scss/Global/detail-head.scss";
const SELECTOR = "#{$detail-heads} {";

/** The bodies of every `#{$detail-heads} { … }` block, braces balanced. */
function headBlocks(css: string): string[] {
    const bodies: string[] = [];
    let at = css.indexOf(SELECTOR);
    while (at !== -1) {
        let depth = 0;
        let i = at + SELECTOR.length - 1;
        const start = i + 1;
        for (; i < css.length; i++) {
            if (css[i] === "{") depth++;
            else if (css[i] === "}" && --depth === 0) break;
        }
        bodies.push(css.slice(start, i));
        at = css.indexOf(SELECTOR, i);
    }
    return bodies;
}

/** Left and right of a `margin` shorthand, CSS rules for 1–4 values. */
function sides(value: string): [string, string] {
    const v = value.trim().split(/\s+/);
    if (v.length === 1) return [v[0], v[0]];
    if (v.length === 4) return [v[3], v[1]];
    return [v[1], v[1]];
}

describe("the detail head's side edges", () => {
    // Comments stripped: the prose explains the old value.
    const css = readFileSync(SCSS, "utf8").replace(/\/\/[^\n]*/g, "");
    const blocks = headBlocks(css);
    // Only the head's OWN declarations, not those of nested rules — innermost
    // first, repeated until no brace is left, so any depth is stripped.
    const stripNested = (body: string): string => {
        let prev = "";
        while (prev !== body) {
            prev = body;
            body = body.replace(/[^;{}]*\{[^{}]*\}/g, "");
        }
        return body;
    };
    const own = blocks.map(stripNested);

    it("finds the base rule and the phone override", () => {
        expect(blocks.length).toBeGreaterThanOrEqual(2);
        expect(own.join("\n")).toMatch(/margin\s*:/);
    });

    it("never insets the head from the content column", () => {
        for (const body of own) {
            for (const [, value] of body.matchAll(/(?:^|[;\s])margin\s*:\s*([^;]+);/g)) {
                expect(sides(value), `margin: ${value.trim()}`).toEqual(["0", "0"]);
            }
            expect(body).not.toMatch(/margin-(left|right|inline)[\w-]*\s*:\s*(?!0\b)/);
        }
    });
});
