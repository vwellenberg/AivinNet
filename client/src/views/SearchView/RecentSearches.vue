<template>
  <!-- The ROOT is gated, not just its contents: as an always-rendered empty
    div it still took a row and the 2rem gap of the idle column, which is a
    blank strip above the letter band for anyone with no recent searches. -->
  <div v-if="recents.length" class="recent-searches">
      <!-- The head sits ON the plate's top edge: a caption sticker plus the
        clear button, both half over the frame. It is one flow row with the
        plate pulled up under it — not an absolutely positioned overlay — so a
        narrow window wraps the row and the plate simply follows. -->
      <div class="recent-head">
        <h3 class="recent-title">
          <SearchSvg class="title-search" />
          <!-- The label is its own box: `text-overflow` needs a block to
            work on, and on the flex sticker itself it clipped mid-word. -->
          <span class="ellip">Recent searches</span>
        </h3>
        <button type="button" class="recent-clear" @click="clearAll">Clear all</button>
      </div>
      <div class="recent-plate">
        <div class="recent-chips">
          <!-- Two buttons in a plain wrapper, not a button inside a button:
            the remove control has to be reachable by keyboard, and nesting
            interactive elements is neither valid HTML nor announced. The
            wrapper carries the pill so the pair still reads as one chip. -->
          <div v-for="term in recents" :key="term" class="recent-chip">
            <button type="button" class="chip-term" @click="apply(term)">
              <span class="chip-label">{{ term }}</span>
            </button>
            <button
              type="button"
              class="chip-remove"
              :title="`Remove ${term}`"
              :aria-label="`Remove ${term}`"
              @click="remove(term)"
            >
              <CancelSvg />
            </button>
          </div>
        </div>
      </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";

import useSearchStore from "@/stores/search";
import {
  clearRecentSearches,
  getRecentSearches,
  promoteRecentSearch,
  removeRecentSearch,
} from "@/utils/recentSearches";

import SearchSvg from "@/assets/icons/search.svg";
import CancelSvg from "@/assets/icons/a.svg";

const search = useSearchStore();
const recents = ref<string[]>(getRecentSearches());

function refresh() {
  recents.value = getRecentSearches();
}
function apply(term: string) {
  // BEFORE the query is set: the debounce watcher records whatever lands in
  // the field, and it cannot tell a term that came out of this list from one
  // that is being typed. Promoting first leaves the term at the head, so the
  // record that follows folds it against itself and changes nothing — without
  // this, clicking a chip could fold away the entry above it.
  promoteRecentSearch(term);
  search.query = term;
}
function remove(term: string) {
  removeRecentSearch(term);
  refresh();
}
function clearAll() {
  clearRecentSearches();
  refresh();
}
</script>

<style lang="scss">
.recent-searches {
  // Neither the page indent nor the full height belong here any more: this
  // block is the first of three in the idle column (TopResults), the host
  // already states the indent, and a block that claims 100% height pushes the
  // letter band and the numbers off the first screen.

  .recent-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    // NOT `wrap`: the plate below is lifted by exactly half of this row's
    // height, so a second line would leave the caption floating above the edge
    // it is supposed to sit on. The caption ellipses instead (it is the only
    // element here that can afford to).
    flex-wrap: nowrap;
    gap: $small;
    // Above the plate, which is pulled up underneath it.
    position: relative;
    z-index: 1;
    // The plate's padding PLUS its frame: the plate carries a 3px border and
    // the head does not, so equal padding would have stood the caption 3px
    // left of the first chip below it.
    padding: 0 calc(#{$medium} + #{$candy-border-w});
  }

  // The caption is a STICKER, like every other section head on the ground
  // (styling.md: text on the ground needs a plate). Blush rather than the
  // role's panel fill: it is the label colour of this design, and this
  // caption sits half on a plate that is itself panel-coloured — on panel the
  // sticker would have dissolved into the surface it is supposed to sit on.
  .recent-title {
    @include mem-sticker($radius: $candy-radius-pill, $pad: 0.3rem 0.85rem);
    display: inline-flex;
    align-items: center;
    gap: $smaller;
    // The one flexible item in the head, so a narrow window shortens the
    // caption instead of wrapping the row (see .recent-head).
    min-width: 0;
    margin: 0;
    background-color: $candy-pink;
    // Static blush fill -> static ink, in both themes.
    color: $mem-ink;
    font-size: 0.95rem;
    font-weight: 700;

    .title-search {
      width: 1rem;
      height: 1rem;
      flex-shrink: 0;
    }
  }

  // Was a plain underlined text link — the only one in an app where every
  // control carries an ink frame, and parked at the far right edge where the
  // screenshot that started this round did not even include it. No `$h`: the
  // role IS the 44px touch target, and this is the head's only control.
  .recent-clear {
    @include btn-pill($radius: $candy-radius-pill, $fill: $mem-panel);
    color: $mem-content-text;
    // The head does not wrap, so this button must not be the thing that gives:
    // a squeezed "Clear all" is how header rows ended up at 16x36 (styling.md).
    flex-shrink: 0;
  }

  // The plate the chips sit on. Content on the ground reads on `--mem-veil`
  // (styling.md), never on the bare doodle tile; the negative margin lifts it
  // under the head so the sticker sits ON its edge. Half the head's height,
  // which is the pill role's 2.75rem — the two numbers move together.
  .recent-plate {
    margin-top: -1.375rem;
    padding: 2.375rem $medium $medium;
    background-color: var(--mem-veil);
    border: $candy-border;
    border-radius: $candy-radius;
    @include candy-shadow;
  }

  .recent-chips {
    display: flex;
    flex-wrap: wrap;
    gap: $small;
  }

  // The pill role, so these chips carry the same frame, the same hard offset
  // AND the same footprint as the filter chips right above them. Hand-built,
  // they had a 1px border (while the app is on $candy-border-w) and no shadow
  // at all — the one row of chips on the page that sat flat. The `$h: 2.25rem`
  // that followed made the comment above half true: same frame, 4px shorter,
  // and both rows are on screen together in the empty state.
  .recent-chip {
    @include btn-pill($radius: $candy-radius-pill, $fill: $candy-pink-soft);
    // The soft fill is theme-aware (dark in the dark theme), so the label has
    // to be too — the role's static ink is only legal on a static accent.
    color: $candy-text;
    // The two buttons meet edge to edge and their own padding does the
    // spacing: the whole pill lights up on hover, so every pixel of it has to
    // belong to one of them. A gap here would be a dead strip in the middle of
    // a control that says it is pressable.
    gap: 0;
    max-width: 16rem;
    // Lighter than the role, and that is the one difference worth keeping:
    // a filter chip is a label, this one carries back a phrase the user typed.
    font-weight: 500;
    // No hover of its own: the role reads the shared token (#422). The
    // override this replaces predates that and existed to dodge the role's
    // then-yellow hover — yellow means "active", and a recent search is not
    // a state.
    //
    // The magnifier glyph these chips used to carry is gone: eight copies of
    // the same icon on the SEARCH page say nothing, and they were what made
    // the row read as a strip of controls instead of a row of words.
    //
    // The role's own padding moves to the two buttons inside: a chip whose
    // padding belonged to the wrapper had a dead strip on either end of the
    // term, which on a control this small is most of the gap between "search
    // this again" and "nothing happened".
    padding: 0;

    .chip-term,
    .chip-remove {
      // The two buttons cover the pill's BORDER as well. `height: 100%`
      // resolves against the content box, which is 2.75rem minus the ink frame
      // on both sides = 38px — so the role's 44px target would have been a
      // 38px one with a 3px dead ring around it, and the chip used to be the
      // button itself. Neither of them paints a background at rest, so nothing
      // is drawn over the frame.
      height: calc(100% + #{$candy-border-w * 2});
      margin: -$candy-border-w 0;
      background: transparent;
      border: none;
      color: inherit;
      font: inherit;
      cursor: pointer;
    }

    // The label ellipses in a box of its OWN, and both halves of that are
    // measured, not assumed:
    //
    //   · not the shared `.ellip`, which clamps by LINE (`-webkit-box` +
    //     `-webkit-line-clamp: 1`). Its clamp height loses to the `height:
    //     100%` this button needs to fill the pill, and a long term then
    //     painted its ellipsed first line PLUS a second one past the frame;
    //   · not on the button itself either. A <button> centres its content
    //     through the UA stylesheet, `text-align` does not reach it, and
    //     `text-overflow` on centred text clips BOTH ends with no ellipsis at
    //     all: measured 212px box against a 318px label, cut open at the front.
    .chip-term {
      display: flex;
      align-items: center;
      min-width: 0;
      // Reaches over the frame on the leading edge too, and pays it back as
      // padding so the label does not move.
      margin-left: -$candy-border-w;
      padding: 0 $smaller 0 calc(#{$medium} + #{$candy-border-w});
    }

    .chip-label {
      min-width: 0;
      overflow: hidden;
      // Stated rather than inherited: a <button> centres its text through the
      // UA stylesheet, and centred text is what clipped the term at BOTH ends
      // before it had a box of its own.
      text-align: left;
      white-space: nowrap;
      text-overflow: ellipsis;
    }

    .chip-remove {
      display: grid;
      place-items: center;
      width: calc(1.85rem + #{$candy-border-w});
      flex-shrink: 0;
      margin-right: -$candy-border-w;
      padding: $candy-border-w calc(#{$smaller} + #{$candy-border-w}) $candy-border-w 0;
      border-radius: $candy-radius-pill;
      // Reserved on both sides of the pointer state, so revealing it can never
      // resize the chip under the pointer.
      transition: opacity 0.15s ease;

      svg {
        width: 0.7rem;
        height: 0.7rem;
      }

      // A state of its OWN, because the chip's hover paints identically over
      // "search this again" and over "delete this", and only one of those is
      // irreversible. It takes the contrast surface the hover already
      // established, inverted once more — no new colour, and no borrowing of
      // teal (play) or yellow (playing), which mean something else here.
      //
      // `content-box` so the plate keeps the padding as a margin to the pill's
      // own edge and its frame: the whole button stays clickable (no dead
      // strip), only the paint stops short. The rule itself lives in the
      // pointer block below — declared here it would tie on specificity with
      // the gate's `&:hover .chip-remove` and lose on source order, which is
      // the trap styling.md documents: the dedicated state would have painted
      // permanently washed out.
    }

    // Pointer-gated, and the gate has a touch answer (styling.md): `:hover`
    // latches after the first tap, so hiding a control behind it would leave
    // the phone with a remove button that is either invisible or stuck open.
    //
    // `pointer-events` travels WITH the opacity, and not as a nicety: this
    // query also matches a touch-capable mouse-primary device (a 2-in-1), and
    // there an invisible-but-live hit area at the chip's trailing edge deletes
    // the entry the finger meant to search for. `:focus-within` is the same
    // question asked for the keyboard — a control that is only reachable by
    // pointer is not reachable.
    @media (hover: hover) {
      .chip-remove {
        opacity: 0;
        pointer-events: none;
      }

      &:hover .chip-remove,
      &:focus-within .chip-remove {
        opacity: 0.75;
        pointer-events: auto;
      }

      // A state of its OWN, because the chip's hover paints identically over
      // "search this again" and over "delete this", and only one of those is
      // irreversible. It takes the contrast surface the hover already
      // established, inverted once more — no new colour, and no borrowing of
      // teal (play) or yellow (playing), which mean something else here.
      // AFTER the two rules above, which it ties with on specificity.
      .chip-remove:hover {
        background-color: var(--mem-hover-text);
        background-clip: content-box;
        color: var(--mem-hover);
        opacity: 1;
      }
    }

    // On touch the button is permanently visible, so it is permanently
    // tappable — and then it answers to the 44px target like every other
    // control (styling.md). It is full pill height already; this is the
    // width. On a pointer it stays narrow: it appears only under the cursor,
    // which is aimed, and a third of the pill standing by to delete is not
    // what a row of search terms should offer.
    @media (hover: none) {
      .chip-remove {
        width: 2.75rem;
        opacity: 0.6;
      }
    }
  }

}
</style>
