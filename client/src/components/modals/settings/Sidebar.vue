<template>
    <div class="settingssidebar">
        <div class="groups">
            <div
                class="group"
                v-for="group in settingGroups.filter(g => {
                    // return true
                    return g.show_if ? g.show_if() : true
                })"
                :key="group.title"
            >
                <div class="gtitle" v-if="group.title">
                    {{ group.title }}
                </div>
                <div class="gitems">
                    <!--
                        A real <button>, not a div with a @click: these twelve
                        rows are the only way into the panes, so as divs the
                        whole settings window was keyboard-unreachable — Tab
                        landed on the close button and nowhere else. Same rule
                        `controlScale.test.ts` already holds the app's other
                        row controls to.
                    -->
                    <button
                        type="button"
                        class="gitem rounded-sm"
                        v-for="item in group.groups"
                        :key="item.title"
                        :class="{
                            active: currentGroup && item.title === currentGroup.title,
                            about: item.title === 'About',
                        }"
                        @click="() => $emit('setTab', item.title || '')"
                    >
                        <Avatar :size="24" :name="auth.user.username || ''" v-if="item.title === 'Profile'" />
                        <span class="icon" v-html="item.icon" v-else></span>
                        <span>
                            {{ item.title }}
                        </span>
                    </button>
                </div>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { SettingGroup } from '@/interfaces/settings'
import settingGroups from '@/settings'
import useAuth from '@/stores/auth'

import Avatar from '@/components/shared/Avatar.vue'

const auth = useAuth()

defineProps<{
    currentGroup: SettingGroup
}>()

defineEmits<{
    (e: 'setTab', title: string): void
}>()
</script>

<style lang="scss">
.settingssidebar {
    border-right: $candy-border;
    background-color: $candy-pink-soft;
    padding: 1.5rem;

    display: grid;
    grid-template-rows: 1fr max-content;
    user-select: none;

    overflow: auto;
    overflow-x: hidden;
    -webkit-overflow-scrolling: touch;
    // Height comes from the modal's flex/grid box; min-height:0 lets this
    // pane shrink below its content so it scrolls within the modal.
    min-height: 0;

    @include largePhones {
        padding: 1rem;
    }

    .groups {
        display: flex;
        flex-direction: column;

        .group {
            &:first-child {
                .gitems {
                    .gitem {
                        margin-top: 0;
                    }
                }
            }
        }
    }

    .appversion {
        pointer-events: none;
        font-size: 12px;
        padding: 0 $small;
        color: $gray1;
    }

    .gtitle {
        font-weight: bold;
        font-size: 14px;
        margin: 1.25rem 0 $smaller $small;
    }

    .gitems {
        display: flex;
        flex-direction: column;
    }

    // These rows navigate the modal, so they are buttons and wear the plate the
    // app's own sidebar wears (#378). They were flat, hovered on a yellow accent
    // (`$candy-pink-deep` — "playing" in this palette, see #422) and marked the
    // active tab with a white fill and no frame; next to the plated sidebar two
    // panels away that read as a different kit.
    .gitem {
        // On a phone this list IS the modal's first screen, and the whole row
        // is the tap target. It measured 36px there (5px of padding around a
        // 20px glyph) — under the 44px this app gives its chrome everywhere
        // else, see styling.md "Touch-Ziele". The row reads the chrome tier
        // now: `$bar-control` box, `$bar-glyph` glyph, one size on every width.
        min-height: $bar-control;
        padding: $smaller $small;
        cursor: pointer;
        display: flex;
        align-items: center;
        // The global <button> reset centres its content and reserves no width;
        // a row reads from its leading edge and fills the pane.
        justify-content: flex-start;
        text-align: left;
        width: 100%;
        gap: $medium;
        font-weight: 700;
        font-size: 15px;
        margin-top: $smaller;
        // Parentheses on purpose: the hatch census reads the argument list, so
        // an argument-less include would read as "states no answer" (#468).
        @include mem-row-plate($hatch: true);

        // Glyph and label ride on the smooth fill; the texture stays in the
        // ring. Only the spans: the Profile row renders an <Avatar> whose root
        // is the bare image/svg, and a cover with padding would shrink it
        // inside its fixed 24px box — and only for users who uploaded a picture,
        // because the two avatar variants render different elements.
        > span {
            @include mem-hatch-clear(4px);
        }

        svg {
            width: $bar-glyph;
        }

        .icon {
            height: $bar-glyph;
        }

        // Pointer-gated at the source (#457) — a latched tap would leave one
        // entry inverted on touch.
        @media (hover: hover) {
            &:hover {
                @include mem-row-plate-hover($hatch: true);
            }
        }

        &.active {
            @include mem-row-plate-active;
        }

        // About closes the list, and the gap the group captions already carry
        // is the whole separation. The ink rule that used to sit here was the
        // only horizontal cut in the pane: on a phone, where this list fills
        // the screen, it read as the panel being sliced in two rather than as
        // one trailing entry set apart.
        &.about {
            margin-top: 1.25rem;
        }
    }
}
</style>
