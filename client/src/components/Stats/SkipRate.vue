<template>
    <!-- How often the period's tracks were skipped (#537). A lower bound: the
         fastest skips are under 5 s and never logged, so the note says so. -->
    <section v-if="skips && skips.plays" class="skip-rate">
        <h3 class="section-title">Skips</h3>
        <div class="skip-plate">
            <div class="skip-overall">
                <span class="skip-value">{{ percent(skips.rate) }}</span>
                <span class="skip-caption">of plays skipped {{ phrase }} (at least)</span>
            </div>
            <p class="skip-note">
                A skip is under {{ percent(rules.skip_below) }} of the track, finished {{ percent(rules.finished_from) }} or more.
                Only tracks with at least {{ rules.min_plays }} plays are ranked. Plays under 5 s are never logged, so this
                is a lower bound.
            </p>

            <div class="skip-lists">
                <div v-if="skips.most_skipped.length" class="skip-list">
                    <h4 class="skip-heading">Most skipped</h4>
                    <ol>
                        <li v-for="row in skips.most_skipped" :key="row.trackhash" class="skip-row">
                            <span class="skip-title">{{ row.track.title }}</span>
                            <span class="skip-artists">{{ artistNames(row) }}</span>
                            <span class="skip-share">{{ percent(row.share) }} · {{ countOf(row, 'skipped') }}</span>
                        </li>
                    </ol>
                </div>
                <div v-if="skips.to_the_end.length" class="skip-list">
                    <h4 class="skip-heading">Always to the end</h4>
                    <ol>
                        <li v-for="row in skips.to_the_end" :key="row.trackhash" class="skip-row">
                            <span class="skip-title">{{ row.track.title }}</span>
                            <span class="skip-artists">{{ artistNames(row) }}</span>
                            <span class="skip-share">{{ percent(row.share) }} · {{ countOf(row, 'finished') }}</span>
                        </li>
                    </ol>
                </div>
            </div>
        </div>
    </section>
</template>

<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'

import { getSkipRate, SkipRatePayload } from '@/requests/stats'
import { statsPeriodPhrase } from '@/utils/statsPeriod'
import { artistNames, countOf, percent } from '@/utils/skipRate'

const props = defineProps<{ period: string }>()

const skips = ref<SkipRatePayload | null>(null)
const phrase = computed(() => statsPeriodPhrase(props.period))
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
        gap: 0.9rem;
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
        align-items: baseline;
        flex-wrap: wrap;
        gap: 0.5rem;
    }

    .skip-value {
        font-size: 2rem;
        font-weight: 700;
        font-variant-numeric: tabular-nums;
    }

    .skip-note {
        margin: 0;
        font-size: 0.85rem;
        opacity: 0.8;
    }

    .skip-lists {
        display: flex;
        flex-wrap: wrap;
        gap: 1.5rem;
    }

    .skip-list {
        flex: 1 1 16rem;
        min-width: 0;
    }

    .skip-heading {
        margin: 0 0 0.4rem 0;
        font-size: 1rem;
    }

    ol {
        margin: 0;
        padding-left: 1.2rem;
    }

    .skip-row {
        display: flex;
        flex-direction: column;
        padding: 0.2rem 0;
    }

    .skip-artists,
    .skip-share {
        font-size: 0.85rem;
        opacity: 0.8;
    }
}
</style>
