<template>
    <div class="devices-modal">
        <p class="group-hint">{{ hint }}</p>

        <div v-if="ds.devices.length === 0" class="empty">
            No devices yet. Open AivinNet on another device — it shows up here automatically.
        </div>

        <div
            v-for="device in shownDevices"
            :key="device.device_id"
            class="device-row rounded-sm"
            :class="{ offline: !device.online, 'in-group': device.joined }"
        >
            <div class="info">
                <div class="name">
                    <span class="label">{{ device.name }}</span>
                    <span v-if="isSelf(device)" class="tag this-device">This device</span>
                </div>
                <div class="meta">
                    <span class="dot" :class="{ online: device.online }"></span>
                    {{ device.joined ? 'In group' : device.online ? 'Online' : 'Offline' }} ·
                    {{ device.type === 'mobile' ? 'Mobile' : 'Desktop' }}
                </div>
            </div>

            <div class="controls">
                <template v-if="device.joined">
                    <input
                        class="vol"
                        type="range"
                        min="0"
                        max="1"
                        step="0.01"
                        title="Volume of this device"
                        :value="volumeFor(device)"
                        @input="onVolumeChange(device, $event)"
                    />
                    <button
                        class="ghost"
                        :class="{ active: muteFor(device) }"
                        :title="muteFor(device) ? 'Unmute' : 'Mute'"
                        @click="toggleMute(device)"
                    >
                        {{ muteFor(device) ? 'Unmute' : 'Mute' }}
                    </button>
                    <button v-if="isSelf(device)" class="ghost" title="Leave group playback" @click="ds.leave()">
                        Leave
                    </button>
                    <button v-else class="ghost" title="Drop this device from the group" @click="remove(device)">
                        Remove
                    </button>
                </template>

                <template v-else-if="device.online">
                    <!-- Inviting also joins THIS device, so a group forms in one
                         tap instead of "join yourself first, then invite". -->
                    <button
                        v-if="!isSelf(device)"
                        class="primary"
                        title="Play in sync with this device"
                        @click="invite(device)"
                    >
                        Invite
                    </button>
                    <button v-else-if="groupExists" class="primary" title="Join the running group" @click="ds.join()">
                        Join group
                    </button>
                </template>
            </div>

            <!-- Output-latency trim for the device in your hand: clock sync cannot
                 see Bluetooth/TV delay, so it needs a manual nudge. -->
            <div v-if="isSelf(device) && device.joined" class="finetune">
                <label>
                    <span>Fine-tune sync</span>
                    <span class="value">{{ ds.audioOffsetMs > 0 ? '+' : '' }}{{ ds.audioOffsetMs }} ms</span>
                </label>
                <div class="slider-row">
                    <input
                        type="range"
                        :min="OFFSET_MIN_MS"
                        :max="OFFSET_MAX_MS"
                        :step="OFFSET_STEP_MS"
                        :value="ds.audioOffsetMs"
                        @input="onOffsetChange($event)"
                    />
                    <button class="ghost" title="Back to 0 ms" @click="ds.setAudioOffset(0)">Reset</button>
                </div>
                <p class="tip">Sounds late on this device? Drag right. Too early? Drag left.</p>
            </div>
        </div>

        <!-- Offline devices carry no control at all (see partitionDevices), so
             they are folded away behind their count rather than pushing the one
             device you can invite off the screen. -->
        <button v-if="offline.length" class="offline-toggle" @click="showOffline = !showOffline">
            {{ showOffline ? 'Hide' : 'Show' }} {{ offline.length }} offline
            {{ offline.length === 1 ? 'device' : 'devices' }}
        </button>

        <button v-if="ds.joined && joinedOthers.length > 0" class="play-here rounded-sm" @click="playHereOnly">
            Play here only
        </button>
    </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import type { DeviceSummary } from '@/requests/devicesync'
import useDeviceSync from '@/stores/devicesync'
import useSettings from '@/stores/settings'
import { OFFSET_MAX_MS, OFFSET_MIN_MS, OFFSET_STEP_MS } from '@/utils/deviceSync/audioOffset'
import { partitionDevices } from '@/utils/deviceSync/deviceList'

const emit = defineEmits<{
    (event: 'setTitle', title: string): void
}>()

const ds = useDeviceSync()
const settings = useSettings()

onMounted(() => emit('setTitle', 'Devices'))

const isSelf = (device: DeviceSummary) => device.device_id === ds.deviceId

const showOffline = ref(false)

// This device first, then group members, then anything else online. Offline
// devices are inert here and fold away behind a count — see partitionDevices.
const partitioned = computed(() => partitionDevices(ds.devices, ds.deviceId))
const offline = computed(() => partitioned.value.offline)
const shownDevices = computed(() =>
    showOffline.value ? [...partitioned.value.active, ...offline.value] : partitioned.value.active
)

const joinedOthers = computed(() => ds.devices.filter(d => d.joined && !isSelf(d)))
const groupExists = computed(() => ds.devices.some(d => d.joined))

const hint = computed(() => {
    if (ds.joined) return 'Group playback is on — every device below plays in sync and can control it.'
    if (groupExists.value) return 'A group is playing. Join it to listen in sync.'
    return 'Invite another device to play the same music in sync with this one.'
})

function volumeFor(device: DeviceSummary): number {
    return isSelf(device) ? settings.volume : (device.volume ?? 1)
}

function muteFor(device: DeviceSummary): boolean {
    return isSelf(device) ? settings.mute : !!device.mute
}

function onVolumeChange(device: DeviceSummary, e: Event) {
    const volume = parseFloat((e.target as HTMLInputElement).value)
    if (isSelf(device)) {
        settings.setVolume(volume)
        return
    }
    void ds.sendCmd('set_volume', { volume }, device.device_id)
}

function toggleMute(device: DeviceSummary) {
    if (isSelf(device)) {
        settings.toggleMute()
        return
    }
    void ds.sendCmd('set_mute', { mute: !device.mute }, device.device_id)
}

function onOffsetChange(e: Event) {
    ds.setAudioOffset(parseInt((e.target as HTMLInputElement).value, 10))
}

/**
 * Invite a device: this one joins first (seeding the group with whatever is
 * playing here), then the target is asked to join.
 */
async function invite(device: DeviceSummary) {
    if (!ds.joined) await ds.join()
    void ds.sendCmd('join_invite', {}, device.device_id)
}

/** Drop a single device out of the group (it stops playing). */
function remove(device: DeviceSummary) {
    void ds.sendCmd('play_here', {}, device.device_id)
}

/** Keep playback on this device only — every other member bows out. */
function playHereOnly() {
    for (const device of joinedOthers.value) {
        void ds.sendCmd('play_here', {}, device.device_id)
    }
}
</script>

<style lang="scss">
.devices-modal {
    display: grid;
    // minmax(0, 1fr): without it a wide row stretches the whole grid track and
    // every row visibly overhangs the modal (measured 43px on desktop).
    grid-template-columns: minmax(0, 1fr);
    gap: $small;

    .group-hint {
        font-size: 0.85rem;
        opacity: 0.85;
        margin: 0;
    }

    .empty {
        opacity: 0.75;
        font-size: 0.9rem;
        padding: 1rem 0;
    }

    .device-row {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: $small;
        padding: $small 1rem;
        background-color: rgba(125, 125, 125, 0.12);

        &.offline {
            opacity: 0.55;
        }

        &.in-group {
            box-shadow: inset 0.2rem 0 0 $brand-green;
        }

        .info {
            // Flex children default to min-width:auto, which lets a long name
            // widen the row instead of ellipsizing.
            min-width: 0;
            flex: 1 1 9rem;
        }

        .name {
            display: flex;
            align-items: baseline;
            gap: 0.35rem;
            min-width: 0;
            font-weight: 600;

            .label {
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            }

            .tag.this-device {
                flex-shrink: 0;
                white-space: nowrap;
                font-size: 0.7rem;
                font-weight: 700;
                text-transform: uppercase;
                color: $brand-green;
            }
        }

        .meta {
            display: flex;
            align-items: center;
            gap: 0.35rem;
            font-size: 0.8rem;
            opacity: 0.8;

            .dot {
                flex-shrink: 0;
                width: 0.5rem;
                height: 0.5rem;
                border-radius: 50%;
                background-color: grey;

                &.online {
                    background-color: $brand-green;
                }
            }
        }

        .controls {
            display: flex;
            flex-wrap: wrap;
            align-items: center;
            justify-content: flex-end;
            gap: 0.4rem;
            min-width: 0;

            .vol {
                flex: 0 1 5rem;
                min-width: 3.5rem;
                accent-color: $brand-green;
            }

            button {
                flex-shrink: 0;
                border: none;
                cursor: pointer;
                padding: 0.4rem 0.7rem;
                border-radius: 0.5rem;
                white-space: nowrap;
                font-size: 0.85rem;

                &.primary {
                    background-color: $brand-green;
                    color: white;
                }

                &.ghost {
                    background-color: rgba(125, 125, 125, 0.2);
                    color: inherit;

                    &.active {
                        background-color: $brand-red;
                        color: white;
                    }
                }
            }
        }

        .finetune {
            flex: 1 1 100%;
            min-width: 0;
            padding-top: $small;
            border-top: 1px solid rgba(125, 125, 125, 0.25);

            label {
                display: flex;
                justify-content: space-between;
                gap: 0.5rem;
                font-size: 0.8rem;
                opacity: 0.85;

                .value {
                    font-variant-numeric: tabular-nums;
                    font-weight: 700;
                }
            }

            .slider-row {
                display: flex;
                align-items: center;
                gap: 0.5rem;

                input[type='range'] {
                    flex: 1 1 auto;
                    min-width: 0;
                    accent-color: $brand-green;
                }
            }

            .tip {
                margin: 0.2rem 0 0;
                font-size: 0.72rem;
                opacity: 0.6;
            }
        }
    }

    // A quiet disclosure line, not a call to action: it reveals rows you
    // usually do not want to see.
    .offline-toggle {
        justify-self: start;
        border: none;
        cursor: pointer;
        padding: 0.4rem 0;
        font-size: 0.85rem;
        font-weight: 500;
        opacity: 0.7;
        text-decoration: underline;

        &:hover {
            opacity: 1;
        }
    }

    .play-here {
        justify-self: start;
        border: none;
        cursor: pointer;
        padding: 0.6rem 1rem;
        background-color: rgba(125, 125, 125, 0.2);

        &:hover {
            background-color: $brand-green;
            color: white;
        }
    }
}
</style>
