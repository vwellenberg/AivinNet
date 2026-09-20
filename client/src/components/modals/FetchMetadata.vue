<template>
    <div class="fetch-metadata-modal">
        <!-- STEP 1 — where should the proposal come from? -->
        <template v-if="step === 'source'">
            <p class="lead">
                Repair the track titles and numbers of <strong>{{ albumTitle }}</strong
                >.
            </p>

            <div class="sources">
                <button type="button" class="source rounded-sm" :disabled="busy" @click="loadCandidates">
                    <span class="name">Look it up online</span>
                    <span class="hint">Matches this album against a MusicBrainz release.</span>
                </button>
                <button type="button" class="source rounded-sm" :disabled="busy" @click="previewFilenames">
                    <span class="name">Read the file names</span>
                    <span class="hint">
                        For rips the internet has never heard of — game soundtracks, bootlegs, your own recordings.
                    </span>
                </button>
            </div>
        </template>

        <!-- STEP 2 — which release? -->
        <template v-else-if="step === 'candidates'">
            <p class="lead">
                <!-- The track count is the discriminator that matters: it is how
                     a deluxe edition gives itself away next to the plain one. -->
                Pick the release this album actually is. The track count is the giveaway.
            </p>

            <div v-if="!candidates.length" class="state-box">
                MusicBrainz has nothing under this name. Try reading the file names instead.
            </div>

            <ul v-else class="candidates">
                <li v-for="candidate in candidates" :key="candidate.mbid">
                    <button type="button" class="candidate rounded-sm" :disabled="busy" @click="preview(candidate)">
                        <span class="name ellip">{{ candidate.title }}</span>
                        <span class="hint ellip">
                            {{ [candidate.artist, candidate.date, candidate.country, candidate.format]
                                .filter(Boolean)
                                .join(' · ') }}
                        </span>
                        <span class="count">{{ candidate.track_count }} tracks</span>
                    </button>
                </li>
            </ul>

            <div class="buttons">
                <button type="button" class="rounded-sm btn-pill" @click="step = 'source'">Back</button>
            </div>
        </template>

        <!-- STEP 3 — what would change? -->
        <template v-else-if="step === 'preview'">
            <p v-if="summary?.ordered_by_filepath" class="warning">
                ⚠️ Every file in this album carries the same track number, so the order below comes from the file
                names. Check it before you apply.
            </p>

            <p class="lead">
                {{ checkedCount }} of {{ changeableRows.length }} rows selected.
                <span v-if="summary && summary.unmatched_remote">
                    {{ summary.unmatched_remote }} track(s) of the release have no counterpart here.
                </span>
            </p>

            <div class="table rounded-sm">
                <div v-for="(row, index) in rows" :key="index" class="row" :class="{ skip: !isWritable(row) }">
                    <input
                        v-if="isWritable(row)"
                        :id="`meta-row-${index}`"
                        v-model="checked[index]"
                        type="checkbox"
                    />
                    <span v-else class="nobox" aria-hidden="true"></span>

                    <!-- ⚠️ A `for=` on a row that renders no checkbox points at
                         nothing, while the cell keeps its pointer cursor: it
                         looks clickable and does nothing. Only a writable row
                         gets labels. -->
                    <component
                        :is="isWritable(row) ? 'label' : 'span'"
                        class="cell now"
                        :for="labelFor(row, index)"
                    >
                        <span class="num">{{ row.current?.track ?? '–' }}</span>
                        <span class="title ellip">{{ row.current?.title ?? '— not in the library —' }}</span>
                    </component>

                    <span class="arrow" aria-hidden="true">→</span>

                    <component
                        :is="isWritable(row) ? 'label' : 'span'"
                        class="cell next"
                        :for="labelFor(row, index)"
                    >
                        <span class="num">{{ row.proposed?.track ?? row.current?.track ?? '–' }}</span>
                        <span class="title ellip">{{ row.proposed?.title ?? '— no proposal —' }}</span>
                    </component>

                    <span v-if="row.delta !== null" class="delta" :class="{ off: !row.confident }">
                        {{ row.confident ? '✓' : `${Math.round(row.delta)}s off` }}
                    </span>
                </div>
            </div>

            <div class="buttons">
                <button type="button" class="rounded-sm btn-pill" :disabled="busy" @click="back">Back</button>
                <button
                    type="button"
                    class="apply rounded-sm btn-pill"
                    :disabled="busy || !checkedCount"
                    @click="apply"
                >
                    {{ busy ? 'Writing…' : `Write ${checkedCount} file(s)` }}
                </button>
            </div>
        </template>

        <div v-if="busy" class="state-box">
            <Spinner />
        </div>

        <p v-if="error" class="error">{{ error }}</p>
    </div>
</template>

<script setup lang="ts">
import { computed, onUnmounted, ref } from 'vue'

import {
    applyChanges,
    fetchPreview,
    fetchReleaseCandidates,
    MetadataSource,
    PreviewRow,
    PreviewSummary,
    ReleaseCandidate,
    TrackChange,
} from '@/requests/metadata'
import useAlbumStore from '@/stores/pages/album'
import useModal from '@/stores/modal'
import { Notification, NotifType } from '@/stores/notification'

import Spinner from '@/components/shared/Spinner.vue'

const props = defineProps<{
    albumhash: string
    albumTitle: string
}>()

const emit = defineEmits<{
    (e: 'setTitle', title: string): void
    (e: 'hideModal'): void
}>()

emit('setTitle', 'Fetch titles & numbers')

// ---------------------------------------------------------------------------
// ⚠️ Three steps, and the middle one is not a formality.
//
// Applying rewrites the audio files, and the trackhash is derived from the
// title — so a wrong release does not fail loudly, it produces a tidy,
// plausible, wrong track list that nobody ever goes back to check. The person
// sees old and new side by side and ticks what they want, and the tick boxes
// are what `apply` sends: no value is written that was not on screen.
// ---------------------------------------------------------------------------

type Step = 'source' | 'candidates' | 'preview'

const albumStore = useAlbumStore()
const modal = useModal()

const step = ref<Step>('source')
const busy = ref(false)
const error = ref('')

const candidates = ref<ReleaseCandidate[]>([])
const rows = ref<PreviewRow[]>([])
const summary = ref<PreviewSummary | null>(null)
const checked = ref<boolean[]>([])
const cameFrom = ref<MetadataSource>('musicbrainz')

/** A row is writable when it has both a file to write to and something to write. */
const isWritable = (row: PreviewRow) => !!row.current && !!row.proposed
const labelFor = (row: PreviewRow, index: number) => (isWritable(row) ? `meta-row-${index}` : undefined)

const changeableRows = computed(() => rows.value.filter(isWritable))
const checkedCount = computed(() => checked.value.filter(Boolean).length)

/**
 * Run one step, with the dialog in its busy state.
 *
 * ⚠️ `isWrite` locks the modal. The host dismisses on a backdrop click, on
 * Escape and on Back, and during a LOOKUP that is harmless — nothing has
 * changed and the job is forgotten. During a write it is not: the worker keeps
 * rewriting the files, but the component that would report how many succeeded
 * and refresh the page showing the old titles is gone, so the outcome reaches
 * nobody. The lock is released in the `finally`, including when the poll gives
 * up.
 */
async function guard<T>(work: () => Promise<{ result: T | null; error: string | null }>, isWrite = false) {
    busy.value = true
    error.value = ''
    if (isWrite) modal.setLocked(true)

    try {
        const { result, error: failure } = await work()
        if (failure) error.value = failure
        return result
    } finally {
        busy.value = false
        if (isWrite) modal.setLocked(false)
    }
}

// A component can be torn down by something other than its own code path
// (a route change, a reload of the modal host). Leaving the lock set would
// make every later modal in this session undismissable.
onUnmounted(() => modal.setLocked(false))

async function loadCandidates() {
    const result = await guard(() => fetchReleaseCandidates(props.albumhash))
    if (!result) return

    candidates.value = result.candidates
    step.value = 'candidates'
}

function intoPreview(result: { rows: PreviewRow[]; summary?: PreviewSummary; error?: string }, source: MetadataSource) {
    if (result.error) {
        error.value = result.error
        return
    }

    rows.value = result.rows
    summary.value = result.summary ?? null
    cameFrom.value = source
    // Pre-tick only what the server is sure about. A row that is 40 seconds off
    // is exactly the one a person should have to look at and decide on.
    checked.value = result.rows.map(row => isWritable(row) && row.confident)
    step.value = 'preview'
}

async function preview(candidate: ReleaseCandidate) {
    const result = await guard(() => fetchPreview(props.albumhash, 'musicbrainz', candidate.mbid))
    if (result) intoPreview(result, 'musicbrainz')
}

async function previewFilenames() {
    const result = await guard(() => fetchPreview(props.albumhash, 'filenames'))
    if (!result) return

    intoPreview(result, 'filenames')
    // The file names make no claim about identity, so nothing is pre-ticked by
    // confidence. Tick every row that has a proposal instead — the person is
    // looking at their own file names, which is evidence enough to start from.
    checked.value = result.rows.map(isWritable)
}

function back() {
    step.value = cameFrom.value === 'filenames' ? 'source' : 'candidates'
}

async function apply() {
    const changes: TrackChange[] = []

    rows.value.forEach((row, index) => {
        if (!checked.value[index] || !row.current?.filepath || !row.proposed) return

        const change: TrackChange = { filepath: row.current.filepath }
        // Only fields the source actually named, and only where they differ.
        // Writing a value back unchanged would still rewrite the file.
        if (row.proposed.title && row.proposed.title !== row.current.title) change.title = row.proposed.title
        if (row.proposed.track !== null && row.proposed.track !== row.current.track) change.track = row.proposed.track
        if (row.proposed.disc !== null && row.proposed.disc !== row.current.disc) change.disc = row.proposed.disc

        if (Object.keys(change).length > 1) changes.push(change)
    })

    if (!changes.length) {
        error.value = 'Nothing selected differs from what is already there.'
        return
    }

    const result = await guard(() => applyChanges(changes), true)
    if (!result) return

    if (result.failed.length) {
        new Notification(`${result.applied.length} written, ${result.failed.length} failed`, NotifType.Error)
    } else {
        new Notification(`${result.applied.length} track(s) updated`, NotifType.Success)
    }

    // The titles just changed, so the page is showing the old ones.
    await albumStore.fetchTracksAndArtists(props.albumhash)
    emit('hideModal')
}
</script>

<style lang="scss">
.fetch-metadata-modal {
    display: grid;
    gap: $small;
    max-width: 40rem;

    .lead {
        margin: 0;
        color: $candy-text-muted;
        font-size: $medium;
    }

    .warning {
        margin: 0;
        padding: $small;
        @include candy-box($mem-yellow, $candy-radius-sm);
        font-size: $medium;
        font-weight: 600;
    }

    .error {
        margin: 0;
        color: $red;
        font-weight: 600;
    }

    .sources {
        display: grid;
        gap: $small;
    }

    .source,
    .candidate {
        display: grid;
        // ⚠️ An explicit track, not `width: 100%`. A <button> is a grid
        // CONTAINER here, and the UA centres its tracks: with an auto column
        // the track is only as wide as its own widest line and then sits in
        // the middle of the plate. Measured before this: two plates both
        // 640px wide, their labels 199px and 364px, each centred — so the
        // short one read as centred and the long one as left-aligned, which
        // is exactly how it was reported. A `1fr` track absorbs the free
        // space and the question of where the container justifies it never
        // arises.
        grid-template-columns: 1fr;
        gap: 2px;
        padding: $small $medium;
        text-align: left;
        @include candy-box($mem-panel, $candy-radius-sm);
        @include candy-shadow(3px, 3px);

        .name {
            font-weight: 700;
        }

        .hint {
            color: $candy-text-muted;
            // ⚠️ NOT `$small`. That is a SPACING token (0.5rem), and as a font
            // size it rendered this line at 8px — half the body text, below
            // anything else in the app. Spacing tokens and type sizes are two
            // scales that happen to share a vocabulary.
            font-size: 0.8rem;
            line-height: 1.35;
        }
    }

    .candidates {
        display: grid;
        gap: $smaller;
        margin: 0;
        padding: 0;
        list-style: none;
        max-height: 18rem;
        overflow-y: auto;
    }

    .candidate {
        // Overrides the single track above: label and hint on the left, the
        // track count pinned right. The `1fr` still does the absorbing.
        grid-template-columns: 1fr max-content;
        grid-template-areas: 'name count' 'hint count';
        align-items: center;

        .name {
            grid-area: name;
        }
        .hint {
            grid-area: hint;
        }
        .count {
            grid-area: count;
            font-variant-numeric: tabular-nums;
            font-weight: 700;
            padding-left: $small;
        }
    }

    .table {
        max-height: 22rem;
        overflow-y: auto;
        @include candy-box($mem-panel, $candy-radius-sm);

        .row {
            display: grid;
            grid-template-columns: max-content 1fr max-content 1fr max-content;
            gap: $smaller;
            align-items: center;
            padding: $smaller $small;

            &:not(:last-child) {
                border-bottom: 1px solid $mem-line;
            }

            &.skip {
                opacity: 0.55;
            }

            .nobox {
                width: 1rem;
            }

            .cell {
                display: grid;
                grid-template-columns: 2.2rem 1fr;
                gap: $smaller;
                align-items: center;
                min-width: 0;
                cursor: pointer;

                .num {
                    font-variant-numeric: tabular-nums;
                    color: $candy-text-muted;
                    text-align: right;
                }
            }

            .next .title {
                font-weight: 600;
            }

            .delta {
                font-size: 0.8rem;
                font-variant-numeric: tabular-nums;

                &.off {
                    color: $red;
                    font-weight: 700;
                }
            }
        }
    }

    .state-box {
        display: grid;
        place-items: center;
        padding: $medium;
        @include candy-box($candy-pink-soft, $candy-radius-sm);
        color: $candy-text-muted;
        text-align: center;
    }

    .buttons {
        display: flex;
        gap: $small;
        justify-content: flex-end;

        .apply {
            font-weight: 700;
        }
    }
}
</style>
