<template>
    <div class="sync-calibration">
        <!-- ─── by ear ─────────────────────────────────────────────────── -->
        <template v-if="mode === 'ear'">
            <template v-if="cal.phase === 'ear'">
                <p class="lead">Every device ticks once a second. Move a slider until you hear a single tick.</p>
                <p v-if="!ds.playing" class="tip">{{ START_MUSIC }}</p>
                <div v-for="row in cal.rows" :key="row.id" class="ear-row">
                    <div class="row-head">
                        <span class="name">{{ row.name }}</span>
                        <span class="value">{{ signed(cal.earTrims[row.id] ?? 0) }} ms</span>
                    </div>
                    <div class="slider-row">
                        <button class="step btn-pill" title="5 ms later" @click="nudge(row.id, -EAR_STEP_MS)">−</button>
                        <input
                            type="range"
                            :min="EAR_MIN_MS"
                            :max="EAR_MAX_MS"
                            :step="EAR_STEP_MS"
                            :value="cal.earTrims[row.id] ?? 0"
                            :aria-label="`Start of ${row.name}`"
                            @input="onEarInput(row.id, $event)"
                        />
                        <button class="step btn-pill" title="5 ms earlier" @click="nudge(row.id, EAR_STEP_MS)">+</button>
                    </div>
                    <div class="ends"><span>later</span><span>earlier</span></div>
                </div>
                <p class="tip">A device ticks after the others? Move it towards “earlier”.</p>
                <button class="btn-primary wide" @click="finish"><span class="text">Done</span></button>
            </template>
            <template v-else-if="cal.phase === 'error'">
                <p class="lead">{{ cal.error }}</p>
                <button class="btn-primary wide" @click="emit('done')"><span class="text">Back</span></button>
            </template>
            <template v-else>
                <p class="lead">The ticking has stopped.</p>
                <button class="btn-primary wide" @click="cal.startEar()"><span class="text">Tick again</span></button>
                <button class="link" @click="emit('done')">Done</button>
            </template>
        </template>

        <!-- ─── with the microphone ────────────────────────────────────── -->
        <template v-else>
            <template v-if="cal.phase === 'idle'">
                <p class="lead">
                    This device listens while every speaker in the group plays a short click. Slower speakers then
                    start that much earlier.
                </p>
                <ol class="steps">
                    <li>Put this device where you listen.</li>
                    <li>Keep the room quiet for about {{ seconds }} seconds.</li>
                    <li v-if="ds.playing">The music keeps playing, turned down.</li>
                </ol>
                <p v-if="!ds.playing" class="tip">{{ START_MUSIC }}</p>
                <button class="btn-primary wide" @click="cal.start()"><span class="text">Allow microphone and start</span></button>
                <p class="note">The recording stays on this device and is gone right after.</p>
                <button class="link" @click="emit('switch', 'ear')">Align by ear instead</button>
            </template>

            <template v-else-if="cal.phase === 'insecure'">
                <p class="lead">
                    Browsers only share the microphone on secure pages, and this address is plain http. You can
                    allow it once, on this device, in Chrome or Edge:
                </p>
                <ol class="steps">
                    <li>
                        Open
                        <span class="copy-line">
                            <code>{{ FLAG_URL }}</code>
                            <button class="copy btn-pill" @click="copy(FLAG_URL)">
                                {{ copied === FLAG_URL ? 'Copied' : 'Copy' }}
                            </button>
                        </span>
                        <span class="aside">(in Edge: edge:// instead of chrome://)</span>
                    </li>
                    <li>
                        Enter this address and set it to Enabled:
                        <span class="copy-line">
                            <code>{{ origin }}</code>
                            <button class="copy btn-pill" @click="copy(origin)">
                                {{ copied === origin ? 'Copied' : 'Copy' }}
                            </button>
                        </span>
                    </li>
                    <li>Relaunch the browser and come back here.</li>
                </ol>
                <p class="note">Only the listening device needs this — the others just click.</p>
                <button class="btn-primary wide" @click="emit('switch', 'ear')"><span class="text">Align by ear instead</span></button>
            </template>

            <template v-else-if="cal.phase === 'starting'">
                <p class="lead">Waiting for the microphone…</p>
            </template>

            <template v-else-if="cal.phase === 'listening'">
                <p class="lead">Listening — keep quiet. Each speaker clicks {{ ROUNDS }} times.</p>
                <div class="meter" aria-hidden="true">
                    <span v-for="(level, i) in bars" :key="i" :style="{ height: `${Math.max(8, level * 100)}%` }" />
                </div>
                <div v-for="row in cal.rows" :key="row.id" class="result-row">
                    <span class="name">{{ row.name }}</span>
                    <span class="state">{{ row.status === 'clicking' ? 'clicking…' : 'waiting' }}</span>
                </div>
                <button class="link" @click="stop">Cancel</button>
            </template>

            <template v-else-if="cal.phase === 'result' || cal.phase === 'applied'">
                <p class="lead">{{ resultLead }}</p>
                <div v-for="row in cal.rows" :key="row.id" class="result-row">
                    <span class="name">{{ row.name }}</span>
                    <span v-if="row.reference" class="state">reference</span>
                    <span v-else-if="row.suggestedTrim !== null" class="trim">
                        <span class="badge">{{ signed(row.suggestedTrim) }} ms</span>
                        <span v-if="cal.phase === 'result' && trimChanges(row)" class="was"
                            >now {{ signed(row.currentTrim) }}</span
                        >
                    </span>
                    <span v-else class="state problem">{{ STATUS_TEXT[row.status] }}</span>
                </div>
                <template v-if="cal.phase === 'result'">
                    <button v-if="cal.changes.length" class="btn-primary wide" @click="cal.apply()"><span class="text">Apply</span></button>
                    <button class="btn-pill wide" @click="cal.start()">Measure again</button>
                </template>
                <template v-else>
                    <button class="btn-primary wide" @click="emit('done')"><span class="text">Done</span></button>
                    <button class="btn-pill wide" @click="cal.start()">Measure again to check</button>
                </template>
                <button v-if="cal.phase === 'result'" class="link" @click="emit('done')">Done</button>
            </template>

            <template v-else-if="cal.phase === 'error'">
                <p class="lead">{{ cal.error }}</p>
                <button class="btn-primary wide" @click="cal.start()"><span class="text">Try again</span></button>
                <button class="link" @click="emit('switch', 'ear')">Align by ear instead</button>
            </template>
        </template>
    </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

import useDeviceSync from '@/stores/devicesync'
import useSyncCalibration, { trimChanges, type RowStatus } from '@/stores/syncCalibration'
import { calibrationSeconds, ROUNDS } from '@/utils/deviceSync/calibration'

const props = defineProps<{ mode: 'mic' | 'ear' }>()
const emit = defineEmits<{
    (event: 'done'): void
    (event: 'switch', mode: 'mic' | 'ear'): void
}>()

const cal = useSyncCalibration()
const ds = useDeviceSync()

/** How long the room has to stay quiet, for the devices in the group now. */
const seconds = computed(() => calibrationSeconds(ds.devices.filter(d => d.joined && d.online).length))

/** The flag that lets one http address use the microphone (Chrome and Edge, desktop and Android). */
const FLAG_URL = 'chrome://flags/#unsafely-treat-insecure-origin-as-secure'
const origin = typeof location !== 'undefined' ? location.origin : ''

/** By-ear slider: the usual range of a hidden output delay, in 5 ms steps. */
const EAR_MIN_MS = -250
const EAR_MAX_MS = 750
const EAR_STEP_MS = 5

/**
 * A Bluetooth path measured right after a pause comes out ~150 ms short of the
 * delay it has under music (Windows, 2026-09-27) — see stores/syncCalibration.ts.
 */
const START_MUSIC = 'Start the music first: a Bluetooth speaker only settles on its real delay while music plays.'

const STATUS_TEXT: Record<RowStatus, string> = {
    waiting: 'waiting',
    clicking: 'clicking…',
    heard: 'heard',
    unclear: 'not heard clearly — louder, or closer',
    settling: 'still settling',
    'no-answer': 'no answer — reload the app there',
    muted: 'muted there',
    late: 'too late to start — try again',
    blocked: 'sound blocked — tap play there once',
    failed: 'could not play the click',
}

const bars = computed(() => {
    const levels = cal.levels
    return Array.from({ length: 12 }, (_, i) => levels[levels.length - 12 + i] ?? 0)
})

const resultLead = computed(() => {
    if (cal.phase === 'applied') return 'Applied. Every speaker now starts in step.'
    if (cal.rows.some(r => r.status === 'settling'))
        return 'A speaker’s delay was still changing, as Bluetooth does after a pause. Let the music play for a minute, then measure again.'
    if (cal.heardCount < 2) return 'Fewer than two speakers came through clearly — there is nothing to compare.'
    if (!cal.changes.length) return 'Everything is in step already.'
    return 'Slower speakers start that much earlier.'
})

function signed(ms: number): string {
    return `${ms > 0 ? '+' : ''}${Math.round(ms)}`
}

function onEarInput(id: string, event: Event) {
    cal.setEarTrim(id, parseInt((event.target as HTMLInputElement).value, 10))
}

function nudge(id: string, deltaMs: number) {
    cal.setEarTrim(id, (cal.earTrims[id] ?? 0) + deltaMs)
}

function finish() {
    cal.stopEar()
    emit('done')
}

function stop() {
    cal.cancel()
    cal.prepare()
}

// The clipboard API is itself secure-page only — exactly the page this is shown on.
const copied = ref('')
function copy(text: string) {
    const area = document.createElement('textarea')
    area.value = text
    area.setAttribute('readonly', '')
    area.style.position = 'fixed'
    area.style.opacity = '0'
    document.body.appendChild(area)
    area.select()
    try {
        document.execCommand('copy')
        copied.value = text
    } finally {
        document.body.removeChild(area)
    }
}

onMounted(() => {
    if (props.mode === 'ear') cal.startEar()
    else cal.prepare()
})

// Closing the panel mid-run stops the clicks or ticks, and the music comes back up.
onBeforeUnmount(() => cal.cancel())
</script>

<style lang="scss">
.sync-calibration {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: $small;

    .lead {
        margin: 0;
        font-size: 0.9rem;
    }

    .note,
    .tip {
        margin: 0;
        font-size: 0.78rem;
        opacity: 0.7;
    }

    .steps {
        margin: 0;
        padding-left: 1.25rem;
        display: grid;
        gap: 0.35rem;
        font-size: 0.85rem;
    }

    .copy-line {
        display: flex;
        align-items: center;
        gap: 0.4rem;
        margin: 0.25rem 0;
        min-width: 0;

        code {
            flex: 1 1 auto;
            min-width: 0;
            overflow-wrap: anywhere;
            font-size: 0.78rem;
            padding: 0.3rem 0.45rem;
            border-radius: $candy-radius-xs;
            background-color: rgba(125, 125, 125, 0.15);
        }

        .copy {
            flex-shrink: 0;
        }
    }

    .aside {
        font-size: 0.75rem;
        opacity: 0.7;
    }

    .wide {
        width: 100%;
    }

    // A quiet way out, not a call to action (the device list's offline toggle).
    .link {
        justify-self: center;
        padding: 0.5rem;
        min-height: 2.75rem;
        font-size: 0.85rem;
        font-weight: 500;
        opacity: 0.75;
        text-decoration: underline;

        &:hover {
            opacity: 1;
        }
    }

    .meter {
        display: flex;
        align-items: flex-end;
        gap: 3px;
        height: 1.75rem;

        span {
            flex: 1 1 0;
            background-color: $brand-green;
        }
    }

    .result-row,
    .row-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: $small;
        min-width: 0;
        font-size: 0.88rem;

        .name {
            min-width: 0;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            font-weight: 600;
        }

        .state {
            flex-shrink: 0;
            font-size: 0.8rem;
            opacity: 0.75;

            &.problem {
                flex-shrink: 1;
                text-align: right;
                opacity: 0.9;
            }
        }

        .value {
            flex-shrink: 0;
            font-variant-numeric: tabular-nums;
            font-weight: 700;
        }
    }

    .result-row {
        padding: 0.45rem 0.75rem;
        border-radius: $candy-radius-sm;
        background-color: rgba(125, 125, 125, 0.12);
    }

    .trim {
        display: flex;
        align-items: baseline;
        gap: 0.4rem;
        flex-shrink: 0;

        .badge {
            font-variant-numeric: tabular-nums;
            font-weight: 700;
        }

        .was {
            font-size: 0.75rem;
            opacity: 0.65;
        }
    }

    .ear-row {
        display: grid;
        gap: 0.2rem;
        padding: 0.5rem 0.75rem;
        border-radius: $candy-radius-sm;
        background-color: rgba(125, 125, 125, 0.12);

        .slider-row {
            display: flex;
            align-items: center;
            gap: 0.5rem;

            input[type='range'] {
                flex: 1 1 auto;
                min-width: 0;
                accent-color: $brand-green;
            }

            .step {
                width: 2.75rem;
                padding: 0;
                flex-shrink: 0;
            }
        }

        .ends {
            display: flex;
            justify-content: space-between;
            font-size: 0.72rem;
            opacity: 0.6;
            padding: 0 3.25rem;
        }
    }
}
</style>
