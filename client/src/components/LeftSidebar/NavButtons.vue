<template>
  <div class="side-nav-container">
    <router-link
      v-for="(menu, index) in menus"
      :key="index"
      :to="{
        name: menu.route_name || '',
        params: menu?.params,
        query: menu.query && menu.query(),
      }"
      class="nav-item"
      :class="[
        menu.tint,
        {
          separator: menu.separator,
          'phone-hidden': menu.phoneHidden,
          active: $route.name === menu.route_name,
        },
      ]"
      @click="menu.action && menu.action()"
    >
      <div v-if="!menu.separator">
        <component :is="menu.icon" />
        <span>{{ menu.name }}</span>
      </div>
    </router-link>
  </div>
</template>

<script setup lang="ts">
import { menus } from "./navitems";
</script>

<style lang="scss">
.side-nav-container {
  text-transform: capitalize;
  display: flex;
  flex-direction: column;
  // A plate throws its offset 3px down-right, so the rows need more air than
  // the 0.25rem they had as flat rows — otherwise each shadow lands on the
  // next row's frame. This is where the +6% sidebar height comes from.
  gap: $small;
  // Not clipped any more (2026-10-04): the active entry reaches out of the
  // panel to the right. The nav left the sidebar's scroller for this.
  // `overflow: hidden` clips at the padding edge, so the plates' offset shadow
  // (3px at rest, 4px hovered) needs room reserved on BOTH sides it falls
  // towards. Only the right one was reserved, so the last row in the list —
  // Stats — was the one plate in the sidebar with no shadow under it.
  padding-right: $small;
  padding-bottom: $smaller;

  .nav-item {
    width: 100%;
    display: flex;
    align-items: center;
    // The frame is part of the plate now, but the padding still subtracts it:
    // the row height must not depend on how thick $candy-border-w happens to
    // be. Measured before this compensation existed: the nav rows grew
    // 44 -> 46px when the border went to 3px, while the library rows below —
    // which already compensated — stayed exactly where they were.
    // The ring IS the padding — the texture is only visible where there is
    // room for it, so the horizontal padding cannot be 0 any more. The 44px row
    // height is kept: 24px glyph + 2x7px padding + 2x3px border.
    // 5px, not 7: the label's own cover adds 2x2px of its own (mem-hatch-clear),
    // so 7 measured 48px against the library's 44 and the two lists were
    // visibly out of step. 24px glyph + 4 + 2x5 + 2x3 border = 44px.
    padding: 5px $small;
    font-size: $sidebar-row-font;
    // 700, one step above the library below. The navigation is a layer, not a
    // list of data — and next to 3px frames and this design's headings, 500
    // read lighter than everything around it.
    font-weight: 700;
    // The row IS a button and says so: fill, ink frame, offset shadow, hatch.
    @include mem-row-plate($sidebar-row-radius);

    // Glyph and label sit on the smooth fill; everything to their right stays
    // texture. Without this the label's box stretched to the end of the row and
    // covered the space next to a short word like "Home".
    & > div {
      display: flex;
      align-items: center;
      @include mem-hatch-clear;
    }

    // Every entry carries its own memphis fill (the class comes from
    // navitems.ts, not from an nth-child rule — the list has a separator in it).
    // Toned toward the paper ground (mem-pastel): six accents at full strength
    // in one narrow column read as shouting, while the same hues in the
    // reference art sit calmly behind the panels because they are large areas
    // rather than stacked marks.
    //
    // Blush is deliberately NOT in this list: it is the hover fill, and a row
    // that wears the pointer state at rest looks permanently hovered.
    @each $name, $colour in $mem-nav-tints {
      &.tint-#{$name} { @include mem-row-plate-tint(mem-pastel($colour)); }
    }

    // Selected keeps its colour and gains the ink zigzag on the leading edge.
    // With every row coloured, "active" cannot be a fill any more — see
    // mem-row-marker.
    &.active {
      @include mem-row-marker;
    }
  }

  // "Where am I", stated loud enough to stand in for a page title (user
  // decisions 2026-10-04): the active entry keeps the ink zigzag on its left,
  // grows to the right past the panel's frame, and the PLATE ITSELF ends in a
  // point aimed at the page — no separate black arrow (that was rejected:
  // "kein schwarzes Ende"). Growing is animated, so the entry visibly
  // reaches out when it becomes active.
  //
  // The point is a square turned 45° and centred on the plate's right edge:
  // its diagonal equals the plate's height, so its top and bottom corners land
  // exactly on the plate's top-right and bottom-right corners and its top and
  // right borders continue the plate's frame. It wears the same `--row-fill`
  // and hatch as the plate, and its own box-shadow carries the 3px offset —
  // 4.24px along the local x axis IS (3px, 3px) after the 45° turn. The
  // plate's own right border and corners step aside for it.
  //
  // This needs the nav to be unclipped, which is why it sits ABOVE the
  // sidebar's scroller (index.vue): a scroller with overflow-y: auto cannot
  // leave x visible.
  //
  // Desktop only: the phone bar is horizontal and has no "right" to reach to.
  @media only screen and (min-width: 901px) {
    .nav-item.active:not(.separator) {
      position: relative;
      z-index: 1;
      // +1.6rem plus the point's ~22px: past the nav padding, the panel
      // padding and the 3px frame, so the point lands on the gap to the page.
      width: calc(100% + 1.6rem);
      // No right border at all rather than a transparent one: a transparent
      // side still takes its share of the corner miter, which left a small
      // notch of fill where the top and bottom frame meet the point. The 3px
      // go to the padding so nothing moves.
      border-right-width: 0;
      padding-right: calc(#{$small} + #{$candy-border-w});
      border-top-right-radius: 0;
      border-bottom-right-radius: 0;
      animation: nav-reach $motion-move $motion-curve-settle;

      // Glyph and label above the point, which overlaps the plate's last
      // ~22px (only hatch lives there).
      & > div {
        position: relative;
        z-index: 1;
      }

      &::after {
        content: "";
        position: absolute;
        top: 50%;
        right: -$candy-border-w;
        box-sizing: border-box;
        // The padding box is the plate's height minus its two borders.
        height: calc((100% + #{2 * $candy-border-w}) / 1.4142);
        aspect-ratio: 1;
        background-color: var(--row-fill);
        background-image: var(--mem-hatch-accent);
        background-size: 38px 38px;
        border: $candy-border;
        border-bottom-color: transparent;
        border-left-color: transparent;
        box-shadow: 4.24px 0 0 var(--mem-shadow);
        // The tip is rounded like every other corner in this design.
        border-top-right-radius: 7px;
        // Only the OUTER half of the square shows: the triangle beyond the
        // plate's right edge (the diagonal from the square's top-left to its
        // bottom-right corner is vertical after the turn). The inner half used
        // to lie on top of the plate with its hatch at 45°, which read as a
        // second, crossed pattern and a seam (reported 2026-10-05). The
        // polygon reaches 12px past the box so the offset shadow survives.
        clip-path: polygon(0 0, calc(100% + 12px) 0, calc(100% + 12px) calc(100% + 12px));
        transform: translate(50%, -50%) rotate(45deg);
        animation: nav-reach-point $motion-move $motion-curve-settle;
      }

      // Hover flips the fill and the hatch (mem-row-plate-hover); the point
      // follows through `--row-fill`, and takes the hover hatch the same way.
      &:hover::after {
        background-image: var(--mem-hatch-hover);
      }
    }
  }

  .nav-item {

    // Hover swaps the row's colour for blush and deepens the offset. Deepening
    // the shadow alone was the first attempt and came back as "you can hardly
    // see the hover" — a 1px offset change is not a pointer signal. Blush can
    // do this now that "selected" is the zigzag band rather than a fill.
    &:hover {
      @include mem-row-plate-hover;
    }
  }

  // The separator is a `.nav-item` too, so it inherits the plate — and a plate
  // is exactly what a 1px spacer must not be. Everything the mixin paints is
  // taken back here; `background: none` also drops the hatch layer, which
  // `background-color` alone would leave behind.
  .nav-item.separator {
    height: 1px;
    padding: 0;
    border: none;
    background: none;
    box-shadow: none;
  }

  @include allPhones {
    justify-content: space-between;
    flex-direction: row;

    .nav-item {
      justify-content: center;
    }

    .nav-item span {
      display: none;
    }

    // The label is hidden here, so the clear-cover's 26px text buffer has
    // nothing to keep clear — it only widens each item to 92px, and five of
    // those force the whole page to 533px on a 390px phone: the layout
    // viewport zooms out and nothing is responsive any more. The glyph's own
    // margins already keep the smooth patch around it.
    .nav-item > div {
      padding: 2px 0;
    }

    // The glyph margins exist to space a label that is hidden here — but they
    // still count into the item's min-content, and min-content is what the
    // bar cannot shrink below: 62px an item, 383px the bar, wider than a
    // 360px phone (the most common Android width). The item centers its glyph
    // itself, so the margins have no job on phones.
    // The compound selector is deliberate: the plain `svg` margin rule sits
    // LATER in this file and would win an equal-specificity tie.
    .nav-item svg {
      margin: 0;
    }

    .separator {
      display: none;
    }
  }

  @include allPhones {
    .nav-item:last-child,
    .nav-item.phone-hidden {
      display: none;
    }
  }

  // In the landscape bar the navigation is one block among three, not the whole
  // width: `space-between` would push the five targets to the far edges of
  // whatever room is left. They hug instead, at the shared touch size.
  //
  // ⚠️ Nested under allPhones, and that is the whole fix (#458): a flat DESKTOP
  // window is also a short viewport. `shortViewport` is height-and-orientation
  // only, so at 1280x500 it matched while `allPhones` (<=900px wide) did not —
  // the sidebar stayed vertical with its labels showing, and every row was
  // squeezed to a 44px plate with the text spilling over its neighbours.
  //
  // The rule this belongs to: the bar in a short viewport is the PHONE bar
  // (.claude/rules/styling.md). Both halves of the condition have to be true.
  // Same shape as the top bar's pill, which got this treatment in #445.
  @include allPhones {
    @include shortViewport {
      justify-content: flex-end;
      gap: 0;

      .nav-item {
        width: $bar-control;
      }
    }
  }

  // These six glyphs used to come from three different icon sets and filled
  // their viewBox by wildly different amounts (measured ink height: bookmark
  // ~92% of the box, home/folder/search ~60-67%, chart ~79%), which is why each
  // one carried its own `--nav-k * (viewBoxSide / glyphInkHeight)` correction.
  // They are now one set, drawn on one 24x24 grid with the same 18px optical
  // glyph, so there is nothing left to correct: one size for all of them.
  // `--nav-k` survives only to bump the mobile bottom bar a touch.
  --nav-k: 1;

  @include allPhones {
    --nav-k: 1.1; // larger glyphs for the mobile bottom bar
  }

  svg {
    height: 1.5rem;
    width: 1.5rem;
    margin: 0 $small 0 $small;
    border-radius: $candy-radius-sm;
    // NOTE: no opacity here on purpose. The old set was filled SF-Symbols mass,
    // and 0.75 took the edge off it; on 2.4px strokes the same rule just made
    // every glyph a mid grey next to its own label, which reads as "weaker" and
    // was exactly the reported complaint. The active row already carries the
    // state (blush fill + ink frame) - the glyph does not have to whisper.
    // Measured: ink #17171A at .75 over white lands around #515154.
    transform: scale(var(--nav-k));
  }

  svg.radiosvg {
    transform: scale(0.7);
  }
}

@keyframes nav-reach {
  from {
    width: 100%;
  }
}

@keyframes nav-reach-point {
  from {
    transform: translate(50%, -50%) rotate(45deg) scale(0);
  }
}
</style>
