<template>
    <div class="shortcut-list">
        <section v-for="group in groups" :key="group.name" class="sl-group">
            <h3 class="sl-heading">{{ group.name }}</h3>
            <dl class="sl-rows">
                <template v-for="s in group.items" :key="s.id">
                    <dt class="sl-keys">
                        <template v-for="(chord, i) in s.chords" :key="i">
                            <span v-if="i > 0" class="sl-or">/</span>
                            <span class="sl-chord">
                                <template v-for="(token, j) in chordTokens(chord)" :key="j">
                                    <span v-if="j > 0" class="sl-plus">+</span>
                                    <kbd class="shortcut-kbd">{{ token }}</kbd>
                                </template>
                            </span>
                        </template>
                    </dt>
                    <dd class="sl-desc">
                        {{ s.description }}
                        <span v-if="s.where" class="sl-where">{{ s.where }}</span>
                    </dd>
                </template>
            </dl>
        </section>
    </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import { chordTokens as tokensFor, currentPlatform, GROUP_ORDER, SHORTCUTS, type Chord, type Shortcut } from '@/utils/shortcuts'

// One list for every place that shows the shortcuts: the overlay (?) and the
// settings page. The platform is read once per mount, so every chord agrees.
const groups = computed(() =>
    GROUP_ORDER.map(name => ({
        name,
        items: SHORTCUTS.filter((s: Shortcut) => s.group === name),
    })).filter(g => g.items.length > 0)
)

const platform = currentPlatform()

function chordTokens(chord: Chord): string[] {
    return tokensFor(chord, platform)
}
</script>

<style lang="scss">
// The key chip, in one place: the list and the "Press ? …" note in Settings
// both draw it. A label, not a control: no shadow, no hatch.
.shortcut-kbd {
    display: inline-block;
    font-family: inherit;
    font-size: 0.85rem;
    font-weight: 600;
    line-height: 1.4;
    min-width: 1.75rem;
    padding: 0.1rem 0.45rem;
    text-align: center;
    color: $candy-text;
    background-color: $candy-pink-soft;
    border: $candy-border;
    border-radius: $candy-radius-sm;
}

.shortcut-list {
    display: grid;
    gap: 1.25rem;
    color: $candy-text;

    .sl-heading {
        margin: 0 0 0.5rem;
        font-size: 13px;
        font-weight: 700;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: $candy-text-muted;
    }

    .sl-rows {
        display: grid;
        // A fixed key column, not `auto`: every group is its own grid, and an
        // `auto` column sized itself per group, so the descriptions started at
        // four different edges (449 to 485 px). 8.25rem holds the widest chord,
        // "Shift + Enter" (126 px measured).
        grid-template-columns: 8.25rem minmax(0, 1fr);
        gap: 0.5rem 1rem;
        margin: 0;
        align-items: baseline;
    }

    .sl-keys {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 0.25rem;
        margin: 0;
        font-weight: 400;
    }

    .sl-chord {
        display: inline-flex;
        align-items: center;
        gap: 0.15rem;
    }

    .sl-plus,
    .sl-or {
        color: $candy-text-muted;
        font-size: 0.85rem;
        padding: 0 0.15rem;
    }

    .sl-desc {
        margin: 0;
        font-size: 15px;
        line-height: 1.4;
        color: $candy-text;
    }

    .sl-where {
        display: block;
        font-size: 13px;
        color: $candy-text-muted;
    }
}
</style>
