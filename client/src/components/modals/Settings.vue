<template>
    <div
        class="settingsmodal"
        :class="{
            isSmallPhone,
        }"
        v-auto-animate
    >
        <!--
            The way out. Until now the settings modal could only be left by
            clicking the backdrop or pressing Back — neither of which the modal
            shows, so it simply looked like it had no exit.

            It sits on the MODAL, not in the pane header: on a small phone the
            tab list renders without a header at all, and a close button that
            only exists next to a group title would be missing in exactly the
            view a phone opens on.
        -->
        <button class="close" type="button" title="Close settings" aria-label="Close settings" @click="emit('hideModal')">
            <CloseSvg />
        </button>
        <Sidebar
            :current-group="(currentGroup as SettingGroup)"
            @set-tab="tab => (currentTab = tab)"
            v-if="!(isSmallPhone && showContent)"
        />
        <div class="content" v-if="showContent">
            <div class="head" v-auto-animate>
                <div class="h2">
                    <button class="back" v-if="isSmallPhone" @click="handleGoBack">
                        <ArrowSvg />
                    </button>
                    {{ currentGroup?.title }}
                    <span v-if="currentGroup?.experimental" class="badge experimental circular">
                        {{ currentGroup?.experimental ? 'experimental' : '' }}
                    </span>
                </div>
            </div>
            <Content :settings="(currentGroup as SettingGroup)" />
        </div>
    </div>
</template>

<script setup lang="ts">
import settingGroups from '@/settings'

import ArrowSvg from '@/assets/icons/arrow.svg'
import CloseSvg from '@/assets/icons/close.svg'
import { SettingGroup } from '@/interfaces/settings'
import { isSmallPhone } from '@/stores/content-width'
import { computed, ref } from 'vue'
import Content from './settings/Content.vue'
import Sidebar from './settings/Sidebar.vue'

const emit = defineEmits<{
    (e: 'setTitle', title: string): void
    (e: 'hideModal'): void
}>()

const currentTab = ref<string>('')
const currentGroup = computed(() => {
    for (const group of settingGroups) {
        for (const settings of group.groups) {
            if (settings.title === currentTab.value) {
                return settings
            }
        }
    }

    if (isSmallPhone.value) {
        return null
    }

    // select default tab
    for (const group of settingGroups) {
        for (const settings of group.groups) {
            if (settings.title === 'Appearance') {
                return settings
            }
        }
    }

    return null
})

const showContent = computed(() => {
    return currentGroup.value !== null
})

function handleGoBack() {
    currentTab.value = ''
}
</script>

<style lang="scss">
// The modal's height is $settings-modal-h (_variables.scss), read by
// `.m-content.settings` in modal.vue. A local `$modalheight: 38rem` used to sit
// here without a single reference.
.settingsmodal {
    display: grid;
    grid-template-columns: 15rem 1fr;
    position: relative;
    // Fill the modal's height (it is a flex column, see .m-content.settings)
    // and let the single row collapse so the inner panes can scroll instead
    // of overflowing past the modal / viewport. `flex: 1` is what makes the
    // "fill" literal: the modal box now has a height of its own, so a
    // content-sized item would leave the sidebar's frame hanging in mid-air.
    flex: 1;
    grid-template-rows: minmax(0, 1fr);
    min-height: 0;

    // The same plate every secondary header action wears (styling.md: one
    // anatomy, 44px, ink frame, offset shadow, hatch). Absolutely positioned so
    // it survives both panes — see the note in the template.
    > .close {
        @include btn-action($glyph: 1.5rem);
        position: absolute;
        top: 0.625rem;
        right: 0.625rem;
        z-index: 2;
    }

    .content {
        display: grid;
        grid-template-rows: 4rem 1fr;
        min-height: 0;

        .head {
            // 3px ink, not a 1px hairline. It was the only line of that weight
            // in a panel built from 3px frames — the same mismatch #422 found
            // over the LIBRARY caption, and it read as if it came from another
            // kit.
            border-bottom: $candy-border-w solid $mem-line;
            padding: 0 2rem;
            display: flex;
            align-items: center;
            gap: $small;

            @include mediumPhones {
                padding: 0 1.25rem;
            }

            .h2 {
                margin: 0;
                font-size: 1.15rem;
                font-weight: bold;
                // Takes the leftover width so the close button lands in the
                // far corner without a margin rule of its own.
                flex: 1;
                min-width: 0;

                display: flex;
                align-items: center;
                gap: 1rem;
            }

            .back {
                @include btn-quiet($size: 2.25rem);
                margin-left: -1rem;
            }

            // Room for the absolutely positioned close button above, so a long
            // group title cannot run underneath it.
            .h2 {
                padding-right: 3.5rem;
            }

            .desc {
                opacity: 0.5;
                font-size: 0.8rem;
            }
        }
    }

    // Role badges used in Profile and Accounts tabs
    .roles {
        display: flex;
        gap: $small;

        .role {
            // margin: $smaller $small 0 0;
            padding: 2px $smaller;
            border-radius: $smaller;
            border: solid 1px $mem-line;
            color: $candy-text;
            font-size: 10px;
            font-weight: bold;
            text-transform: uppercase;

            display: flex;
            align-items: center;
            gap: $small;
        }
    }
}

.settingsmodal.isSmallPhone {
    grid-template-columns: 1fr;

    .settingssidebar {
        border-right: none;
    }
}
</style>
