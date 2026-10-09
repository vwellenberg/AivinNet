<template>
    <!-- A stamp on the corner of a tile's artwork: one loud number or word and an
         optional caption under it ("7×" / "usual"). Stuck ON the cover, slightly
         crooked, like the covers of the song-list inlay — it says "look at this
         tile" without taking a line of the name plate.

         Generic on purpose: "On repeat" uses it for the factor, anything else
         that wants to flag a tile (new, rare, …) hands it a different value.

         It lives INSIDE `.card-art` and needs `.has-stamp` on it (cards.scss):
         the art clips its children, and the stamp hangs over the corner.
         `pointer-events: none` — the whole tile is one link. -->
    <div class="card-stamp" :class="`tone-${tone}`" :data-long="value.length > 3 || undefined">
        <b class="stamp-value">{{ value }}</b>
        <small v-if="caption" class="stamp-caption">{{ caption }}</small>
    </div>
</template>

<script setup lang="ts">
withDefaults(
    defineProps<{
        value: string
        caption?: string
        tone?: 'yellow' | 'teal' | 'coral'
    }>(),
    { caption: undefined, tone: 'yellow' }
)
</script>

<style lang="scss">
.card-stamp {
    position: absolute;
    z-index: 2;
    top: -0.8rem;
    right: -0.4rem;
    // A disc for one or two digits, a pill when the value is wider ("100×").
    min-width: 3.4rem;
    height: 3.4rem;
    padding: 0 0.35rem;
    border-radius: 99px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    line-height: 1;
    text-align: center;
    pointer-events: none;
    transform: rotate(10deg);

    // Static fill, static ink: the stamp is the same on the light and the dark
    // plate (a theme-aware ink on yellow would turn paper on yellow).
    color: $mem-ink;
    border: $mem-ring-w solid $mem-ink;
    box-shadow: mem-shadow(3px, 3px);

    &.tone-yellow {
        background-color: $mem-yellow;
    }

    &.tone-teal {
        background-color: $mem-teal;
    }

    &.tone-coral {
        background-color: $mem-coral;
    }

    .stamp-value {
        font-size: 1.15rem;
        font-weight: 800;
    }

    &[data-long] .stamp-value {
        font-size: 0.95rem;
    }

    .stamp-caption {
        margin-top: 0.15rem;
        font-size: 0.5rem;
        font-weight: 700;
        letter-spacing: 0.06em;
        text-transform: uppercase;
    }
}
</style>
