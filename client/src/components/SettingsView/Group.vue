<template>
    <div v-if="group && (group.show_if ? group.show_if() : true)" class="settingsgroup">
        <div class="setting pad-lg">
            <div
                v-for="(setting, index) in group.settings.filter(s => (s.show_if ? s.show_if() : true))"
                :key="index"
                class="setting-item"
                :class="{
                    inactive: setting.inactive && setting.inactive(),
                    'is-list': setting.type === SettingType.root_dirs,
                    panel: PANEL_TYPES.includes(setting.type),
                }"
            >
                <div class="text" @click="setting.defaultAction ? setting.defaultAction() : setting.action()">
                    <div class="title">
                        <span class="ellip">
                            {{ setting.title }}
                            <span v-if="setting.experimental" class="badge experimental circular">
                                {{ setting.experimental ? 'experimental' : '' }}
                            </span>
                            <span v-if="setting.new" class="badge new circular">
                                {{ setting.new ? 'new' : '' }}
                            </span>
                        </span>
                        <button v-if="setting.type == SettingType.root_dirs" @click="setting.action">
                            <ReloadSvg height="1.5rem" /> <span>Rescan</span>
                        </button>
                    </div>
                    <div v-if="setting.desc" class="desc">
                        {{ setting.desc }}
                    </div>
                </div>
                <div class="options">
                    <Switch
                        v-if="setting.type == SettingType.binary"
                        :state="setting.state && setting.state()"
                        @click="setting.action()"
                    />
                    <Select
                        v-if="setting.type === SettingType.select"
                        :options="setting.options"
                        :source="setting.state !== null ? setting.state : () => ''"
                        :setter-fn="setting.action"
                    />
                    <NumberInput
                        v-if="setting.type === SettingType.free_number_input"
                        :value="setting.state && setting.state()"
                        :callback="setting.action"
                    />
                    <button v-if="setting.type === SettingType.button" @click="setting.action">
                        {{ setting.button_text && setting.button_text() }}
                    </button>
                    <LockedNumberInput
                        v-if="setting.type == SettingType.locked_number_input"
                        :value="setting.state !== null ? setting.state() : 0"
                        :min="0"
                        :max="10"
                        :step="1"
                        :unit="'s'"
                        :on-change="setting.action"
                    />
                </div>

                <!-- Custom components -->
                <List
                    v-if="setting.type === SettingType.root_dirs"
                    icon="folder"
                    :items="setting.state !== null ? setting.state() : []"
                />
                <SeparatorsInput
                    v-if="setting.type === SettingType.separators_input && setting.action"
                    :submit="setting.action"
                    :default="setting.state ? setting.state() : []"
                />
                <Profile v-if="setting.type === SettingType.profile" />
                <Accounts v-if="setting.type === SettingType.accounts" />
                <About v-if="setting.type === SettingType.about" />
                <Pairing v-if="setting.type === SettingType.pairing" />
                <DropDown
                    v-if="setting.type === SettingType.streaming_quality"
                    :items="(setting.options ?? [] as any)"
                    :current="(setting.state && setting.state() as any)"
                    @item-clicked="setting.action"
                    :reverse="'hide'"
                    component_key="streaming_quality"
                />
                <BackupRestore v-if="setting.type === SettingType.backup" />
                <SecretInput
                    v-if="setting.type === SettingType.secretinput"
                    :text="setting.state ? setting.state() : ''"
                    @submit="setting.action"
                />
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { SettingGroup } from '@/interfaces/settings'
import { SettingType } from '@/settings/enums'

import ReloadSvg from '@/assets/icons/reload.svg'
import List from './Components/List.vue'
import LockedNumberInput from './Components/LockedNumberInput.vue'
import NumberInput from './Components/NumberInput.vue'
import Select from './Components/Select.vue'
import SeparatorsInput from './Components/SeparatorsInput.vue'
import Switch from './Components/Switch.vue'

import Profile from '../modals/settings/Profile.vue'
import Accounts from '../modals/settings/custom/Accounts.vue'
import Pairing from '../modals/settings/custom/Pairing.vue'
import DropDown from '../shared/DropDown.vue'
import About from './About.vue'
import BackupRestore from './Components/BackupRestore.vue'
import SecretInput from './Components/SecretInput.vue'

defineProps<{
    group: SettingGroup
}>()

/**
 * Types whose "row" is really a whole sub-panel (a form, a list, an about
 * text). They get no plate: the plate says "press this row to flip it", and
 * these rows flip nothing — their controls sit inside. Hovering one would also
 * invert a panel full of components that pin their own colours (the Accounts
 * user cards, the Profile validation message), which is how the exception was
 * found.
 */
const PANEL_TYPES = [
    SettingType.profile,
    SettingType.accounts,
    SettingType.about,
    SettingType.pairing,
    SettingType.backup,
    SettingType.root_dirs,
    SettingType.separators_input,
    SettingType.secretinput,
]
</script>

<style lang="scss">
.settingsgroup {
    display: grid;
    gap: $small;
    margin-top: 2rem;
    padding-bottom: 2rem;

    &:first-child {
        margin-top: 0;
    }

    .info {
        margin-left: $smaller;
        margin-bottom: $small;
    }

    h4 {
        margin: $small auto;
    }

    .desc {
        // A muted TOKEN, not `opacity: 0.5`. Half-strength ink measured #8b8b8d
        // on the panel — the description was the palest text in the app while
        // sitting right under a bold title, which is what "die Schrift ist
        // nicht richtig schwarz" was about. `$mem-content-muted` is the same
        // grey every other caption uses and answers the dark theme too.
        color: $mem-content-muted;
        font-size: 0.8rem;
        font-weight: 500;
    }

    .setting {
        // The plates need room: `overflow: hidden` on the scrolling pane would
        // otherwise crop the 3px offset shadow of the last row flush (#397).
        display: grid;
        gap: $small;
        // Longhands on purpose: the shorthand would outrank the `.pad-lg` class
        // this element also carries and zero its top/left padding, which puts
        // the first plate's 3px frame flush against the head's 3px rule as one
        // 6px line.
        padding-right: $smaller;
        padding-bottom: $smaller;

        .inactive {
            opacity: 0.5;
            pointer-events: none;
        }
    }

    .setting > * {
        display: grid;
        grid-template-columns: 1fr max-content;
        gap: $small;

        @include smallPhones {
            display: flex;
            flex-wrap: wrap;
        }
    }

    // A settings row IS a button — clicking its text flips the setting — so it
    // wears the plate the sidebar rows wear (#378): panel fill, ink frame,
    // offset shadow, hatch. What it replaces was a 1px grey hairline between
    // flat rows: the only stroke of that weight in a panel made of 3px frames,
    // and nothing on the row said it could be pressed.
    // No hatch, by the #468 reading: this is a ~490px content list in which
    // EVERY row is a control and each carries two lines of type, so the texture
    // separates nothing and only costs legibility — the chart-row case exactly.
    // It also keeps the plate honest around the rows that wrap a whole
    // sub-panel (About, Profile, Accounts, Pair device, Backup, root dirs),
    // whose own text would otherwise sit on terrazzo.
    // `:not(.panel)` — see PANEL_TYPES in the script block: a row that contains
    // a whole form or list is not a button and must not be inverted on hover.
    .setting-item:not(.panel) {
        user-select: none;
        padding: 0.85rem 1rem;
        @include mem-row-plate($hatch: false);

        // The press belongs to the CONTROL, not to the row around it: `:active`
        // matches ancestors, so a held stepper or a dragged text field would
        // shove the whole plate 3px under the cursor. Same trap the cards took
        // `$press: false` for.
        &:active {
            transform: none;
            box-shadow: 3px 3px 0 var(--mem-shadow);
        }

        // Pointer-gated at the source (#457): on touch `:hover` latches after a
        // tap, and a latched plate would leave one row inverted until the next
        // tap somewhere else.
        @media (hover: hover) {
            &:hover {
                @include mem-row-plate-hover($hatch: false);

                // The muted caption is explicit, so it cannot inherit the
                // flipped row colour — the hovered row reads at full strength.
                .desc {
                    color: var(--mem-hover-text);
                }
            }
        }

        // Control buttons (e.g. the cover-fetch button) sit in the max-content
        // column; let long labels wrap and cap the width so they don't overflow
        // and get clipped by the panel's overflow-x: hidden.
        // A settings control button that may wrap: some labels are long
        // ("All covers present"). The wrapping pill role owns the anatomy;
        // only the width cap stays local, because it is about this column.
        > button {
            @include btn-pill($h: auto);
            min-height: 2.75rem;
            white-space: normal;
            max-width: 16rem;
            text-align: center;
            line-height: 1.3;
            padding: 0.45rem 0.85rem;
        }

        .options {
            margin: auto 0;
        }

        .text {
            cursor: pointer;
            display: flex;
            flex-direction: column;
            align-items: self-start;
            width: 100%;

            .title {
                // 700, like every other row label in this design. 500 read as a
                // caption next to 3px frames and the bold headings around it.
                font-weight: 700;
                margin: auto 0;
                display: flex;
                align-items: center;
                justify-content: space-between;
                flex-wrap: wrap;
                gap: $small;
                width: 100%;

                button {
                    padding-right: $medium;
                }

                button > svg {
                    transform: scale(0.65);
                }
            }

            .desc {
                margin-top: $smaller;
            }
        }
    }

    // (Removed here: the `:first-child`/`:last-child` padding corrections and
    // the `border-bottom: none` reset. They existed to tidy the ends of a run
    // of hairline-separated rows — with every row a self-contained plate there
    // are no ends to tidy.)

    @include smallerPhones {
        .info ~ .setting > .setting-item {
            display: flex;
            justify-content: space-between;
            flex-wrap: wrap;
            gap: $small;
        }
    }
}
</style>
