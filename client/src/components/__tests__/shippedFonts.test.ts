import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// EVERY SHIPPED TYPEFACE IS ONE WE MAY SHIP (#201).
//
// The client carried five Apple woff2 files — "SF Compact Display" in four
// weights and "SF Mono". Apple's licence covers mock-ups of software for Apple
// platforms, not redistribution as a webfont from a public repo, and SF Compact
// was not even referenced by a single rule: a font file in the folder is no
// proof that anything uses it (`vite-svg-loader`'s sibling problem — an unused
// asset is silently absent from the bundle and fails nothing).
//
// So two halves, and both are needed:
//   · every font FILE under assets/fonts is on the allowlist, with its licence
//   · no rule NAMES a family that is only installable, never shippable, as its
//     own `@font-face`
//
// Naming a local family inside a font STACK is fine and is what replaced them:
// `$mono-font` starts with `ui-monospace, SFMono-Regular, …`, which asks the
// machine for a font it already has and downloads nothing.
// ---------------------------------------------------------------------------

/** Font files we ship, and the licence that lets us. */
const ALLOWED_FONTS: Record<string, string> = {
  "Figtree-Variable-latin.woff2": "SIL OFL 1.1 (Figtree-OFL.txt)",
  "Figtree-Variable-latin-ext.woff2": "SIL OFL 1.1 (Figtree-OFL.txt)",
  "SpaceGrotesk-Variable-latin.woff2": "SIL OFL 1.1",
  "SpaceGrotesk-Variable-latin-ext.woff2": "SIL OFL 1.1",
  "PixelifySans-Variable-latin.woff2": "SIL OFL 1.1 (PixelifySans-OFL.txt)",
  "PixelifySans-Variable-latin-ext.woff2": "SIL OFL 1.1 (PixelifySans-OFL.txt)",
  "VT323-Regular-latin.woff2": "SIL OFL 1.1 (VT323-OFL.txt)",
  "VT323-Regular-latin-ext.woff2": "SIL OFL 1.1 (VT323-OFL.txt)",
  "IBMPlexSans-Variable-latin.woff2": "SIL OFL 1.1 (IBMPlexSans-OFL.txt)",
  "IBMPlexSans-Variable-latin-ext.woff2": "SIL OFL 1.1 (IBMPlexSans-OFL.txt)",
};

/** Families that may be NAMED in a stack but never shipped as a file. */
const LOCAL_ONLY = ["SF Compact Display", "SF Mono", "Segoe UI Emoji"];

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (name !== "__tests__") out.push(...sources(path));
    } else if (/\.(vue|scss|css|ts|html)$/.test(name)) out.push(path);
  }
  return out;
}

describe("shipped fonts", () => {
  it("are only the ones whose licence allows it", () => {
    const shipped = readdirSync("src/assets/fonts").filter((f) => /\.(woff2?|ttf|otf|eot)$/i.test(f));
    const offenders = shipped.filter((f) => !(f in ALLOWED_FONTS));
    expect(offenders).toEqual([]);
    // And the allowlist has no stale entries: a name here that is not on disk
    // would quietly widen the check the next time someone adds a file.
    expect(Object.keys(ALLOWED_FONTS).filter((f) => !shipped.includes(f))).toEqual([]);
  });

  it("carry no @font-face for a family we may only name, never serve", () => {
    const offenders: string[] = [];
    for (const file of sources("src")) {
      const source = readFileSync(file, "utf-8");
      for (const [, body] of source.matchAll(/@font-face\s*\{([^}]*)\}/g)) {
        for (const family of LOCAL_ONLY) {
          if (body.includes(family)) offenders.push(`${file}: @font-face for ${family}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("leave monospace text to the machine's own fonts", () => {
    const variables = readFileSync("src/assets/scss/_variables.scss", "utf-8");
    expect(variables).toMatch(/^\$mono-font:\s*ui-monospace,/m);

    // Nobody writes the stack a second time: one source, like every other token.
    const offenders = sources("src")
      .filter((f) => !f.endsWith("_variables.scss"))
      .filter((f) => /font-family:[^;]*(SF Mono|ui-monospace)/.test(readFileSync(f, "utf-8")));
    expect(offenders).toEqual([]);
  });
});
