import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// A THING YOU CLICK IS A CONTROL — NOT A DIV WITH A HANDLER (#137).
//
// A `<div @click>` does not exist for the keyboard: no tab stop, no Enter or
// Space, no name for a screen reader — and the app's focus ring hangs off the
// `button` selector (Global/basic.scss), so it cannot appear either.
//
// ⚠️ The census in the issue counted with a line-based grep and therefore MISSED
// the worst case: `Select.vue` writes its handler on its own line, so every
// segmented setting — the most common control in the settings panel — was
// invisible to that count. Parsed properly it was 26 places in 22 files, not 19
// in 15. This test parses the opening tag across lines.
//
// Three lists, and the difference between them is the point:
//
//   REGIONS   a box around real controls, or a backdrop whose job IS the click.
//             Legitimate; a <button> there would nest controls.
//   TODO      genuine controls that still need converting, each with the reason
//             it was not mechanical. Shrinks; may never grow.
//   (neither) fails the test.
// ---------------------------------------------------------------------------

const INTERACTIVE = new Set(["button", "a", "input", "select", "textarea", "label", "summary"]);

/** HTML elements. A component tag (`<Switch @click>`) binds to that component's
 *  own root, and whether THAT is a control is checked where the component lives. */
const HTML = new Set([
  "div", "span", "li", "ul", "ol", "p", "section", "article", "header", "footer", "nav", "aside", "main",
  "form", "table", "tr", "td", "th", "tbody", "thead", "img", "svg", "h1", "h2", "h3", "h4", "h5", "h6",
  "figure", "pre", "code", "small", "strong", "em", "b", "i", "dl", "dt", "dd", "canvas", "video", "audio",
  "details", "dialog", "blockquote",
]);

/** A box around controls, or a surface whose click is the whole point. */
const REGIONS: Record<string, string> = {
  "components/modal.vue": "the backdrop closes the modal; the dialog has its own close button",
  "components/DeviceSync/GestureOverlay.vue": "a full-surface gesture layer — the real button sits inside it",
  "components/modals/ChipInput.vue": "the field area focuses the input inside it",
  "components/SettingsView/Group.vue": "the settings row wraps the real control; clicking the label is a convenience",
  "components/RightSideBar/SearchInput.vue": "the box around the search input routes to the search page",
  "components/shared/AlbumCard.vue": "an event stopper inside the card, so the artist line does not open the album",
  "components/shared/ArtistName.vue": "an event stopper around router links",
  "components/shared/SongItem/TrackTitle.vue": "the track row itself is the control; these repeat its action",
};

/** Genuine controls still to convert — with why each was not mechanical. */
const TODO: Record<string, string> = {
  "components/Contextmenu/ContextItem.vue":
    "the submenu lives INSIDE the clickable item, so a <button> would nest controls — needs menu semantics",
};

/**
 * A COMPOSED control: an element that is not a <button> for a reason — a drag
 * source (a dragged <button> does not start a drag in Firefox), a menu item that
 * contains its submenu — and therefore spells out what a button gives for free.
 * All three, or it is not a control: a role without a tab stop cannot be
 * reached, and a tab stop without keys does nothing once reached.
 */
const WIDGET_ROLE =
  /\brole="(button|menuitem|menuitemcheckbox|menuitemradio|option|switch|tab|checkbox|radio|link|treeitem)"/;

function isComposedControl(attrs: string): boolean {
  return WIDGET_ROLE.test(attrs) && /\s:?tabindex=/.test(attrs) && /(?:^|\s)(@keydown|v-on:keydown)\b/.test(attrs);
}

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

/** Non-interactive HTML elements carrying a click handler, per file. */
function offenders(file: string): string[] {
  const source = readFileSync(file, "utf-8");
  const scriptAt = source.indexOf("\n<script");
  const template = scriptAt === -1 ? source : source.slice(0, scriptAt);
  const found: string[] = [];
  for (const [, tag, attrs] of template.matchAll(/<([a-zA-Z][\w-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g)) {
    const name = tag.toLowerCase();
    if (!HTML.has(name) || INTERACTIVE.has(name)) continue;
    if (/(?:^|\s)(@click|v-on:click)\b/.test(attrs) && !isComposedControl(attrs)) found.push(name);
  }
  return found;
}

const FILES = vueFiles("src").map((f) => ({ file: f, rel: f.replace(/\\/g, "/").replace(/^src\//, "") }));

describe("clickable elements", () => {
  it("are real controls, unless listed as a region or as a tracked gap", () => {
    const unlisted = FILES.filter(({ file, rel }) => offenders(file).length && !(rel in REGIONS) && !(rel in TODO)).map(
      ({ rel, file }) => `${rel}: <${offenders(file).join(">, <")}> with @click`
    );
    expect(unlisted).toEqual([]);
  });

  it("keeps both lists honest — an entry whose file is clean must go", () => {
    const stale = [...Object.keys(REGIONS), ...Object.keys(TODO)].filter(
      (rel) => offenders(join("src", rel)).length === 0
    );
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
    for (const [file, pattern] of [
      ["src/components/SettingsView/Components/List.vue", /<button[^>]*:aria-label=/s],
      ["src/components/shared/Input.vue", /:aria-label="showingPassword \? 'Hide password' : 'Show password'"/],
      ["src/components/nav/Titles/Folder.vue", /aria-label="Go to the top folder"/],
      ["src/components/modals/settings/Profile.vue", /aria-label="Change profile picture"/],
    ] as const) {
      expect(readFileSync(file, "utf-8")).toMatch(pattern);
    }
  });

  it("shows a control that hides until hover when the keyboard focuses it", () => {
    // `opacity: 0` plus a tab stop is a trap: focus lands on something nobody
    // can see. Both converted cases answer `:focus-visible`.
    expect(readFileSync("src/components/AlbumView/AlbumDiscBar.vue", "utf-8")).toMatch(
      /\.play:focus-visible\s*\{\s*opacity: 1;/
    );
    expect(readFileSync("src/components/shared/Input.vue", "utf-8")).toMatch(/\.showpass:focus-visible/);
  });

  it("recognises a composed control only with all three parts", () => {
    // The census would go silently green if this predicate broke, so it is
    // checked on its own (testing.md: a source-scanning test guards its input).
    expect(isComposedControl(' role="button" tabindex="0" @keydown.enter="x"')).toBe(true);
    expect(isComposedControl(' role="button" @keydown.enter="x"')).toBe(false);
    expect(isComposedControl(' tabindex="0" @keydown.enter="x"')).toBe(false);
    expect(isComposedControl(' role="button" tabindex="0"')).toBe(false);
    expect(isComposedControl(' role="presentation" tabindex="0" @keydown="x"')).toBe(false);
  });

  it("keeps the folder picker inside the picker (#137)", () => {
    // Inside the router-link, Enter reached the <a> instead of the row's click
    // handler: the keyboard LEFT the dialog for the folder page. And the tick
    // was a hover-only <div>. Picker rows are two real buttons now, and no link.
    const item = readFileSync("src/components/FolderView/FolderItem.vue", "utf-8");
    const picker = item.slice(item.indexOf('class="f-item is-picker"'));
    expect(picker).toMatch(/<button type="button" class="f-open"/);
    expect(picker).toMatch(/class="check"\s+:aria-pressed="is_checked"/);
    expect(picker.slice(0, picker.indexOf("</template>"))).not.toMatch(/router-link/);
    // The tick shows on focus, not just on hover — or it is an invisible tab stop.
    expect(picker).toMatch(/mouse_over \|\| check_focus/);
    // A declaration, not the word: the comment above `.check` explains why the
    // declaration went, and must not fail its own rule.
    expect(item).not.toMatch(/^\s*outline:\s*none/m);
  });

  it("does not put a control inside a control", () => {
    // HeartSvg IS a button; the row used to wrap it in a click-catching div.
    const duration = readFileSync("src/components/shared/SongItem/TrackDuration.vue", "utf-8");
    expect(duration).toMatch(/<HeartSvg :state="is_fav" @handle-fav=/);
    // The PROP, not the word — the comment above the markup explains it and
    // would otherwise fail its own rule.
    expect(duration).not.toMatch(/:no_emit=/);
    expect(duration).not.toMatch(/class="heart-icon"[^>]*@click/s);
  });
});
