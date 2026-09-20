import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// A THING YOU CLICK IS A BUTTON — NOT A DIV WITH A HANDLER (#137).
//
// A `<div @click>` does not exist for the keyboard: no tab stop, no Enter or
// Space, no name for a screen reader — and the app's focus ring hangs off the
// `button` selector (Global/basic.scss), so it cannot appear either.
//
// ⚠️ The census in the issue used a line-based grep and therefore MISSED the
// worst case: `Select.vue` writes its handler on its own line, so the whole
// settings panel — every toggle and every segmented choice — was invisible to
// that count and to the eye. This test parses the opening tag across lines.
//
// The rule is the FEATURE ("a non-interactive element carries @click"), never a
// list of known files — a list is what lets the 20th case in unnoticed.
// ---------------------------------------------------------------------------

const INTERACTIVE = new Set(["button", "a", "input", "select", "textarea", "label", "summary"]);

/**
 * Elements that may keep a click handler, with the reason.
 *
 * Each one is a REGION that wraps real controls (a button inside a button is
 * invalid) or a backdrop whose job is the click itself — never a control that
 * a user is meant to find and operate.
 */
const ALLOWED: Record<string, string> = {
  "components/SettingsView/Group.vue": "the settings row wraps real controls; clicking the label is a convenience",
  "components/modal.vue": "the backdrop closes the modal; the dialog has its own close button",
  "components/modals/AuthLogin.vue": "wrapper around the submit button",
  "components/modals/ChipInput.vue": "the field area focuses the input inside it",
  "components/modals/RootDirsPrompt.vue": "row wraps a real control",
  "components/modals/SetRootDirs.vue": "row wraps a real control",
  "components/modals/settings/custom/Accounts.vue": "row wraps real controls",
  "components/modals/updatePlaylist.vue": "the image area opens the file picker below it",
  "components/shared/AlbumCard.vue": "the card is a RouterLink region; the play disc inside is a button",
  "components/shared/SongItem/TrackTitle.vue": "the row itself is the control; these open its menus",
  "components/DeviceSync/GestureOverlay.vue": "a full-surface gesture layer, not a control",
};

function vueFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (name !== "__tests__") out.push(...vueFiles(path));
    } else if (name.endsWith(".vue")) out.push(path);
  }
  return out;
}

/** `<tag …>` openings whose attributes contain a click handler, tag name kept. */
function clickableTags(source: string): string[] {
  const template = source.slice(0, source.indexOf("\n<script") === -1 ? source.length : source.indexOf("\n<script"));
  const out: string[] = [];
  // The opening tag may span lines, so match up to the first ">" that is not
  // inside an attribute value.
  for (const match of template.matchAll(/<([a-zA-Z][\w-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g)) {
    const [, tag, attrs] = match;
    if (/(?:^|\s)(@click|v-on:click)\b/.test(attrs)) out.push(tag.toLowerCase());
  }
  return out;
}

describe("clickable elements", () => {
  it("are real controls, or a listed region with a reason", () => {
    const offenders: string[] = [];
    for (const file of vueFiles("src")) {
      const rel = file.replace(/\\/g, "/").replace(/^src\//, "");
      // A component tag (<Switch @click>) binds to that component's own root;
      // whether THAT is a control is the component's own business, checked
      // where it lives.
      const bad = clickableTags(readFileSync(file, "utf-8")).filter(
        (tag) => /^[a-z]/.test(tag) && !INTERACTIVE.has(tag)
      );
      if (bad.length && !(rel in ALLOWED)) offenders.push(`${rel}: <${bad.join(">, <")}> with @click`);
    }
    expect(offenders).toEqual([]);
  });

  it("keeps the allowlist honest — no entry for a file that no longer needs it", () => {
    const stale = Object.keys(ALLOWED).filter((rel) => {
      const bad = clickableTags(readFileSync(join("src", rel), "utf-8")).filter(
        (tag) => /^[a-z]/.test(tag) && !INTERACTIVE.has(tag)
      );
      return bad.length === 0;
    });
    expect(stale).toEqual([]);
  });

  it("gives the settings controls a role and a state", () => {
    const sw = readFileSync("src/components/SettingsView/Components/Switch.vue", "utf-8");
    expect(sw).toMatch(/<button[^>]*role="switch"/s);
    expect(sw).toMatch(/:aria-checked="!!state"/);

    const select = readFileSync("src/components/SettingsView/Components/Select.vue", "utf-8");
    expect(select).toMatch(/<button[\s\S]*?:aria-pressed="option\.active"/);
  });

  it("names the icon-only controls it converted", () => {
    const list = readFileSync("src/components/SettingsView/Components/List.vue", "utf-8");
    expect(list).toMatch(/<button[^>]*:aria-label=/s);
  });

  it("shows a hover-only control when the keyboard focuses it", () => {
    // `opacity: 0` until hover plus a tab stop is a trap: focus lands on
    // something nobody can see.
    const disc = readFileSync("src/components/AlbumView/AlbumDiscBar.vue", "utf-8");
    expect(disc).toMatch(/\.play:focus-visible\s*\{\s*opacity: 1;/);
  });
});
