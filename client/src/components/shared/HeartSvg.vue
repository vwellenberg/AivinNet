<template>
    <button
        class="heart-button"
        :class="{ 'is-fav': state, 'role-bar': btn_role === 'bar', 'role-action': btn_role === 'action' }"
        @click="!no_emit && $emit('handleFav')"
    >
        <!-- A plain div, deliberately: this used to be a <Motion> fading the
             glyph in over `delay 0.25s + duration 0.5s`, so the icon only
             became fully visible 0.75s after mount — and re-ran on every
             mount, i.e. every page change. Once the header buttons gained a
             panel fill and a border, that read as an empty button that fills
             in late. <Motion> renders a div, so keeping a div here preserves
             the `div { ... }` rules below verbatim. -->
        <div>
            <HeartFillSvg v-if="state" class="heart-fill" />
            <HeartOutlineSvg v-else />
        </div>
    </button>
</template>

<script setup lang="ts">
// One sign, two fillings — hollow means "not saved", solid means "saved".
//
// The pair replaces plus + check-circle, and the plus is what made that pair
// awkward: a tick has no hollow reading, so the unset state had to borrow a
// different glyph entirely. Two shapes for one toggle is one shape too many.
import HeartFillSvg from '@/assets/icons/heart.fill.svg'
import HeartOutlineSvg from '@/assets/icons/heart.svg'

withDefaults(
    defineProps<{
        state: Boolean | undefined
        // Primitive `boolean`, not the `Boolean` wrapper the other prop still
        // uses: `withDefaults` treats an object type as one that needs a
        // FACTORY default, so `no_emit: false` against `Boolean` fails the
        // typecheck with "boolean is not assignable to (props) => Boolean".
        no_emit?: boolean
        // Which button role this toggle wears (see Global/_buttons.scss).
        // One value per FOOTPRINT it has to fit into, because that is what the
        // call sites were overriding it for:
        //
        //   compact  in-row affordance — track rows, the queue. $control-compact
        //   bar      chrome — the player bar, where it stands beside transport
        //            controls at $bar-control
        //   action   the plate-and-frame control of the four detail headers
        //
        // It used to be `quiet | action`, and `quiet` was the default — but no
        // call site rendered it: the track row wiped it with `all: unset`, the
        // player bar squared it with four `!important`, and the mobile bar
        // excluded it from its own sizing rule by name. A role that every
        // caller has to correct is not a role.
        //
        // Named `btn_role` rather than `role` on purpose: `role` is the ARIA
        // attribute, and a prop of that name would shadow it for anyone
        // reading the template.
        btn_role?: 'compact' | 'bar' | 'action'
    }>(),
    // `no_emit` was implicitly undefined before this component had a
    // `withDefaults` wrapper at all; stated now because the wrapper is what
    // makes a missing default a lint finding, and `undefined` and `false` mean
    // the same thing to the click handler either way.
    { btn_role: 'compact', no_emit: false }
)

defineEmits<{
    // eslint-disable-next-line no-unused-vars
    (event: 'handleFav'): void
}>()
</script>

<style lang="scss">
// The favourite toggle takes a ROLE, like every other button in the app (#90).
//
// It used to hand-write its own anatomy — `height: 2.25rem` plus
// `aspect-ratio: 1.5` for the box, a global `.circular` utility class for the
// radius — and that cost twice over. The height was silently load-bearing (a
// ratio needs one dimension to resolve, and the button base stopped supplying
// one at #244; this button measured 54x36 -> 28x28 the day it did). And the
// radius came from a utility class sitting at the SAME specificity as this
// rule, so which of the two won was decided by bundle order rather than by
// anyone's intention.
//
// Stating them through the role fixed the ordering luck — but it stated the
// WRONG box, and nothing said so, because every call site was already busy
// correcting it: 54x36 with a 1.75rem glyph is a header-sized control, and the
// three places that take the bare variant are a track row, a queue row and a
// player bar. Measured, the component's declared box rendered in exactly zero
// of them.
//
// So the bare variant is the compact scale now — square, `$control-compact`,
// the same footprint the ⋯ button beside it in a track row has had all along
// (2rem, it was just never named). Square also retires the pill radius: a pill
// on a 54-wide box was a shape, on a 32px square it would be a circle, and this
// design rounds its controls at `$candy-radius-sm`.
.heart-button {
    @include btn-quiet($size: $control-compact, $glyph: $control-compact-glyph);

    div {
        height: max-content;
        transform: scale(1);

        svg {
            // Size comes from the role; this only stops the inline baseline gap
            // from making the wrapper taller than the glyph.
            display: block;
        }

        // No per-state scaling here, deliberately. Both glyphs are now drawn on
        // the chrome grid (24 box, ink 3..21), so one CSS size renders them at
        // one optical size — which is the whole point of the grid (#311).
        //
        // What stood here was `transform: scale(0.75)` on the check, because
        // the old asset was a solid r=14 disc in a 28 box: 100% of its viewBox
        // against the plus's ~52%, so the glyph JUMPED from ~13px to ~25px the
        // moment a track was favourited. The compensation and the mismatch it
        // compensated for are gone together; the ring's outer edge lands at the
        // same 21px the scale factor used to produce.
    }

    // Favorited state: teal fills the heart (the asset's `currentColor`); its
    // edge is fixed ink in the asset itself.
    //
    // Teal alone does NOT carry this on every host — it measures 1.24:1 on the
    // yellow playing row, under the 3:1 WCAG 1.4.11 wants of a graphic. The ink
    // edge is what makes the marker legible there (9.64:1), which is why this
    // rule only owns the fill and the asset owns the outline. That split came
    // with the check-circle (#370) and survives the change of sign unchanged —
    // the reason for it was never the shape.
    &.is-fav {
        color: $mem-teal;

        // The marker is a plate stuck onto the row, not a print in it — it gets
        // the design's one shadow: no blur, down-right, hard edge.
        //
        // `drop-shadow` and not `candy-shadow`: this button is `btn-quiet`, so
        // its own box is transparent, and a `box-shadow` there would be the
        // offset-under-nothing the shadow rules warn about. The filter follows
        // the GLYPH's silhouette instead, which is a closed, filled disc — the
        // same technique `Logo.vue` uses for its ink contour.
        //
        // Ink, not the theme-aware `--mem-shadow`, for the reason the asset's
        // outline is fixed too: two of the three row surfaces this sits on are
        // statically light (hover = white, playing = yellow), so a paper-toned
        // shadow would smear milk across the yellow row in the dark theme. On
        // the dark resting ground it drops out, exactly as the outline does.
        //
        // 2px against the ~21px glyph — the 3px the plates use reads as a
        // second disc at this size.
        svg {
            filter: drop-shadow(2px 2px 0 $mem-ink);
        }
    }
}

// The chrome variant. In the player bar this toggle stands beside the transport
// controls, which read `$bar-control` from one owner precisely so the two halves
// of that bar cannot drift apart — and it was the one control in the row that
// did not. It was corrected from the outside instead, twice over: four
// `!important` squaring the box to 1.6rem in `BottomBar/Left.vue`, and a
// `:not(.heart-button)` carve-out in `BottomBar/Right.vue` excluding it from the
// row's own sizing rule by name. Both of those are this rule now.
.heart-button.role-bar {
    @include btn-action($size: $bar-control);

    // Teal, like every other favourited heart in the app.
    //
    // This role used to state `$mem-content-text` instead, on the argument that
    // the fill of the glyph carries the state here and teal belongs to the play
    // button alone. Measured on the bar that did not hold: the marker sits on a
    // paper plate, and a filled ink heart there reads as a dark blob rather
    // than as "saved" — the state was legible only by comparing it against a
    // hollow heart nobody has side by side. One sign, one state colour,
    // wherever it stands.
    //
    // Stated rather than left to the role, and that is load-bearing: every
    // `btn-*` mixin sets `color`, matches `.heart-button.is-fav` at the same
    // specificity (0,2,0) and sits later in the file. Without this block the
    // marker would take whatever the role happens to hand it, and nobody could
    // tell the intent from the accident — which is exactly how the bar lost its
    // teal unnoticed for a release (#396). `favouriteState.test.ts` therefore
    // asks every role to state its state colour, not to state a particular one.
    // Both halves spelled out, because `btn-action` colours its glyph twice:
    // the panel-safe tone at rest, static ink on the blush hover fill.
    &.is-fav,
    &.is-fav:hover {
        color: $mem-teal;
    }

    // No drop-shadow on the glyph here. It exists so the marker reads as a
    // plate stuck onto a ROW; on a button that already carries the design's
    // offset shadow it would be a second shadow inside the first.
    &.is-fav svg {
        filter: none;
    }
}

// The header variant. Four detail headers stand this toggle in a row of
// plate-and-frame controls, and two of them used to patch it from the OUTSIDE
// with a verbatim copy of the same two rules — `@include btn-action`, then a
// re-assert of the teal to survive the hover colour the mixin brings with it.
// Two copies of one correction is precisely the drift #90 exists to remove, so
// the correction lives with the button that needs it.
.heart-button.role-action {
    @include btn-action;

    // btn-action sets `color` on hover so ITS glyphs stay readable on the blush
    // fill, and that rule outranks a bare `.is-fav` — a favourited album turned
    // ink the moment the pointer touched it. The favourite owns its colour, so
    // re-assert with the compound that wins.
    &.is-fav,
    &.is-fav:hover {
        color: $mem-teal;
    }
}
</style>
