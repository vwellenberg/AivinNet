<template>
    <!-- How often the period's tracks were skipped (#537). A lower bound: the
         fastest skips are under 5 s and never logged, so the note says so. -->
    <section v-if="skips && skips.plays" class="skip-rate">
        <h3 class="section-title">Skips</h3>
        <div class="skip-plate">
            <div class="skip-overall">
                <div class="skip-headline">
                    <span class="skip-value">{{ percent(skips.rate) }}</span>
                    <span class="skip-caption">of plays skipped {{ phrase }} (at least)</span>
                </div>
                <div class="skip-meter" aria-hidden="true">
                    <span :style="{ width: barWidth(skips.rate ?? 0) }"></span>
                </div>
                <span class="skip-total">{{ skips.skipped }} of {{ skips.plays }} plays</span>
            </div>

            <div class="skip-lists">
                <div
                    v-for="list in lists"
                    :key="list.kind"
                    class="skip-list"
                    :class="`is-${list.kind}`"
                >
                    <h4 class="skip-heading">{{ list.heading }}</h4>
                    <ol>
                        <li v-for="(row, i) in list.rows" :key="row.trackhash" class="skip-row">
                            <span class="skip-rank">{{ i + 1 }}</span>
                            <img
                                v-if="row.track.image"
                                class="skip-thumb"
                                :src="paths.images.thumb.small + row.track.image"
                                alt=""
                                loading="lazy"
                            />
                            <span v-else class="skip-thumb" aria-hidden="true"></span>
                            <div class="skip-text">
                                <span class="skip-title" :title="row.track.title">{{ row.track.title }}</span>
                                <span class="skip-artists">{{ artistNames(row) }}</span>
                                <div class="skip-bar" aria-hidden="true">
                                    <span :style="{ width: barWidth(row.share) }"></span>
                                </div>
                            </div>
                            <div class="skip-share">
                                <span class="skip-percent">{{ percent(row.share) }}</span>
                                <span class="skip-count">{{ countOf(row, list.count) }}</span>
                            </div>
                        </li>
                    </ol>
                </div>
            </div>

            <p class="skip-note">
                A skip is under {{ percent(rules.skip_below) }} of the track, finished {{ percent(rules.finished_from) }} or more.
                Only tracks with at least {{ rules.min_plays }} plays are ranked. Plays under 5 s are never logged, so this
                is a lower bound.
            </p>
        </div>
    </section>
</template>

<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'

import { paths } from '@/config'
import { getSkipRate, SkipRatePayload, SkipRow } from '@/requests/stats'
import { barWidth } from '@/utils/listeningDevices'
import { statsPeriodPhrase } from '@/utils/statsPeriod'
import { artistNames, countOf, percent } from '@/utils/skipRate'

const props = defineProps<{ period: string }>()

const skips = ref<SkipRatePayload | null>(null)
const phrase = computed(() => statsPeriodPhrase(props.period))
// Both rankings drawn alike; an empty one is left out.
const lists = computed(() => {
    const all: { kind: 'skipped' | 'finished'; heading: string; count: 'skipped' | 'finished'; rows: SkipRow[] }[] = [
        { kind: 'skipped', heading: 'Most skipped', count: 'skipped', rows: skips.value?.most_skipped ?? [] },
        { kind: 'finished', heading: 'Always to the end', count: 'finished', rows: skips.value?.to_the_end ?? [] },
    ]
    return all.filter(list => list.rows.length)
})
const rules = computed(() => skips.value?.rules ?? { skip_below: 0.3, finished_from: 0.9, min_plays: 5, always: 0.9 })

// As the clock does: a period clicked through quickly must not paint the
// answer to an earlier one, and a page left must not be painted into at all.
let asked = 0
onUnmounted(() => (asked = -1))

watch(
    () => props.period,
    async period => {
        const ask = ++asked
        const res = await getSkipRate(period)
        if (ask !== asked) return
        skips.value = res.status === 200 ? res.data : null
    },
    { immediate: true }
)
</script>

<style lang="scss">
.skip-rate {
    margin-top: 2rem;

    .section-title {
        @include mem-sticker;
        margin: 0 0 1rem 0;
        font-size: 1.15rem;
        font-weight: 700;
    }

    .skip-plate {
        display: flex;
        flex-direction: column;
        gap: 1.25rem;
        max-width: 100%;
        padding: 1rem;
        background-color: var(--mem-veil);
        border: $candy-border;
        border-radius: $candy-radius;
        @include candy-shadow;
        color: $mem-content-text;
    }

    .skip-overall {
        display: flex;
        flex-direction: column;
        gap: 0.4rem;
        max-width: 32rem;
    }

    .skip-headline {
        display: flex;
        align-items: baseline;
        flex-wrap: wrap;
        gap: 0.5rem;
    }

    .skip-value {
        font-size: 2.4rem;
        font-weight: 800;
        line-height: 1;
        font-variant-numeric: tabular-nums;
    }

    .skip-meter,
    .skip-bar {
        border-radius: 999px;
        background-color: rgba(127, 127, 127, 0.25);
        overflow: hidden;

        span {
            display: block;
            height: 100%;
            border-radius: inherit;
        }
    }

    .skip-meter {
        height: 0.6rem;
        border: $candy-border;

        span {
            background-color: var(--look-stat-bar, #{$mem-coral});
        }
    }

    .skip-total,
    .skip-note,
    .skip-artists,
    .skip-count {
        font-size: 0.85rem;
        opacity: 0.8;
    }

    .skip-note {
        margin: 0;
        padding-top: 0.75rem;
        border-top: $mem-hairline-w dashed $mem-line;
        font-size: 0.8rem;
        opacity: 0.7;
    }

    .skip-lists {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(min(100%, 20rem), 1fr));
        gap: 1rem;
    }

    .skip-list {
        min-width: 0;
        padding: 0.75rem;
        background-color: $mem-panel;
        border: $candy-border;
        border-radius: $candy-radius-sm;
        color: $mem-text;
        // The rows narrow with the card, not the window: the sidebar takes its share.
        container-type: inline-size;
        --skip-accent: #{$mem-coral};

        &.is-finished {
            --skip-accent: #{$mem-teal};
        }
    }

    .skip-heading {
        @include mem-sticker($fill: var(--look-stat-label-fill, var(--skip-accent)));
        margin: 0 0 0.6rem 0;
        font-size: 0.95rem;
        // A look without accent labels (Boring) keeps the word, in its grey.
        color: var(--look-stat-label-text, #{$mem-ink});
    }

    ol {
        display: flex;
        flex-direction: column;
        gap: 0.35rem;
        margin: 0;
        padding: 0;
        list-style: none;
    }

    .skip-row {
        display: grid;
        grid-template-columns: 1.4rem 2.75rem minmax(0, 1fr) auto;
        align-items: center;
        gap: 0.65rem;
        padding: 0.35rem;
        border-radius: $candy-radius-sm;

        &:hover {
            background-color: rgba(127, 127, 127, 0.12);
        }
    }

    .skip-rank {
        font-weight: 800;
        text-align: center;
        opacity: 0.55;
        font-variant-numeric: tabular-nums;
    }

    .skip-thumb {
        display: block;
        width: 2.75rem;
        height: 2.75rem;
        object-fit: cover;
        border: $candy-border;
        border-radius: $candy-radius-sm;
        background-color: rgba(127, 127, 127, 0.25);
    }

    .skip-text {
        display: flex;
        flex-direction: column;
        gap: 0.1rem;
        min-width: 0;
    }

    .skip-title,
    .skip-artists {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .skip-title {
        font-weight: 600;
    }

    .skip-bar {
        height: 0.3rem;
        margin-top: 0.25rem;

        span {
            background-color: var(--look-stat-bar, var(--skip-accent));
        }
    }

    .skip-share {
        display: flex;
        flex-direction: column;
        align-items: flex-end;
        text-align: right;
    }

    .skip-percent {
        font-size: 1.1rem;
        font-weight: 800;
        font-variant-numeric: tabular-nums;
    }

    .skip-count {
        white-space: nowrap;
    }

    // A phone: the rank goes and the cover shrinks, so the title keeps its room.
    @container (max-width: 22rem) {
        .skip-row {
            grid-template-columns: 2.25rem minmax(0, 1fr) auto;
            gap: 0.5rem;
            padding: 0.3rem 0;
        }

        .skip-rank {
            display: none;
        }

        .skip-thumb {
            width: 2.25rem;
            height: 2.25rem;
        }
    }
}
</style>
