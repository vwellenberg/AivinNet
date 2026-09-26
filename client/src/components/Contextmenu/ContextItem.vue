<template>
    <!-- A menu item (#137). Not a <button>: the submenu lives INSIDE this
         element, and a button cannot contain controls. So it is the WAI-ARIA
         menu pattern spelled out — role, a tab stop the menu moves focus to
         (-1: arrows move between items, Tab leaves the menu), and the keys. -->
    <div
        ref="parentRef"
        class="context-item"
        role="menuitem"
        tabindex="-1"
        :aria-haspopup="opensSubmenu ? 'menu' : undefined"
        :aria-expanded="opensSubmenu ? childrenShown : undefined"
        @mouseenter="handleMouseEnter"
        @mouseleave="handleMouseLeave"
        @click="runAction"
        @keydown="onItemKey"
    >
        <div class="icon image" v-html="option.icon"></div>
        <div class="label ellip">{{ option.label }}</div>
        <div v-if="hasChildren && !option.singleChild" class="more" v-html="ExpandIcon"></div>
        <div
            v-if="children"
            ref="childRef"
            class="children rounded shadow-md"
            :class="{ 'is-open': childrenShown }"
            :style="{ visibility: childrenShown ? 'visible' : 'hidden', opacity: childrenShown ? '1' : '0' }"
            role="menu"
        >
            <div className="wrapper">
                <template v-for="(child, index) in children" :key="child.label ?? `separator-${index}`">
                    <div v-if="child.type === 'separator'" class="context-item separator" role="separator"></div>
                    <div
                        v-else
                        class="context-item"
                        :class="[{ critical: child.critical }, child.type]"
                        role="menuitem"
                        tabindex="-1"
                        @click="child.action && runChildAction(child.action)"
                        @keydown="onChildKey($event, child)"
                    >
                        <div class="label ellip">
                            {{ child.label }}
                        </div>
                    </div>
                </template>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { createPopper, Instance, Modifier, Placement, Rect } from '@popperjs/core'
import { computed, nextTick, ref } from 'vue'

import { ExpandIcon } from '@/icons'
import { Option } from '@/interfaces'
import { focusWhenVisible } from '@/utils/focusWhenVisible'

const props = defineProps<{
    option: Option
}>()

const emit = defineEmits<{
    // eslint-disable-next-line no-unused-vars
    (event: 'hideContextMenu'): void
}>()

const showChildrenDelay = 250
const stillWaitingForChildren = ref(false)
const children = ref<Option[] | false>(false)

const childrenShown = ref(false)
const childRef = ref<HTMLElement>()
const parentRef = ref<HTMLElement>()

// Submenus open on hover as well as on click. That used to be a setting
// ("click" only) — an upstream option nobody here needs; click still works.
const hasChildren = computed(() => !!props.option.children)

let popperInstance: Instance | null = null

async function handleMouseEnter() {
    if (!hasChildren.value) return

    stillWaitingForChildren.value = true
    await new Promise(resolve => setTimeout(resolve, showChildrenDelay))

    if (stillWaitingForChildren.value) {
        showChildren()
    }
}

function handleMouseLeave() {
    if (!hasChildren.value) return
    stillWaitingForChildren.value = false
    hideChildren()
}

async function getChildren() {
    if (!props.option.children) return
    const childs = await props.option.children()

    if (childs) {
        children.value = childs
    }
}

async function showChildren() {
    if (childrenShown.value) {
        childrenShown.value = false
        return
    }

    if (props.option.children) {
        await getChildren()
        // return;
    }

    const offsetModifier: Partial<
        Modifier<
            'offset',
            {
                offset:
                    | [number, number]
                    | ((args: { placement: Placement; reference: Rect; popper: Rect }) => [number, number])
            }
        >
    > = {
        name: 'offset',
        options: {
            offset: ({ placement }) => {
                // Correct type for placement automatically inferred
                if (placement.includes('right') || placement.includes('left')) {
                    return [-7, 0]
                }
                return [0, 0]
            },
        },
    }

    popperInstance = createPopper(parentRef.value as HTMLElement, childRef.value as HTMLElement, {
        placement: 'right-start',
        modifiers: [
            {
                name: 'preventOverflow',
                options: {
                    altAxis: true,
                    boundariesElement: 'viewport',
                },
            },
            {
                name: 'flip',
                options: {
                    fallbackPlacements: ['left-start', 'auto'],
                    boundariesElement: 'viewport',
                },
            },
            offsetModifier,
        ],
    })
    // Visibility, opacity and the open-state transition all follow
    // `childrenShown`, in ONE render (template). They used to be written here as
    // inline styles, a render BEFORE the `is-open` class existed — so the flip
    // ran under the closing transition, with its delay, and the submenu stayed
    // `hidden` for its first 250ms: the keyboard's focus() was refused (#137).
    childrenShown.value = true
}

function hideChildren() {
    popperInstance?.destroy()
    childrenShown.value = false
}

function hideContextMenu() {
    emit('hideContextMenu')
}

function runAction() {
    if (!props.option.singleChild && props.option.children) {
        if (childrenShown.value) {
            hideChildren()
            return
        }

        showChildren()
        return
    }

    props.option.action && props.option.action()
    hideContextMenu()
}

// ---------------------------------------------------------------------------
// The keyboard (#137). Up/Down/Home/End between items and Escape belong to the
// menu (ContextMenu.vue); an item answers what is about ITSELF: activate it, or
// open its submenu. Every key handled here stops, or the global shortcuts in
// helpers/useKeyboard.ts would see it too — arrows seek and change volume there.
// ---------------------------------------------------------------------------

/** Whether this item opens a submenu rather than doing something. */
const opensSubmenu = computed(() => !!props.option.children && !props.option.singleChild)

function childItems(): HTMLElement[] {
    return Array.from(childRef.value?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])
}

async function openSubmenuAndFocus() {
    if (!childrenShown.value) await showChildren()
    await nextTick()
    await focusWhenVisible(childItems()[0])
}

function onItemKey(e: KeyboardEvent) {
    // Keys pressed inside the submenu bubble up to here; they are onChildKey's.
    if (e.target !== parentRef.value) return

    if (e.key === 'Enter' || e.key === ' ') {
        opensSubmenu.value ? openSubmenuAndFocus() : runAction()
    } else if (e.key === 'ArrowRight' && opensSubmenu.value) {
        openSubmenuAndFocus()
    } else {
        return
    }

    e.preventDefault()
    e.stopPropagation()
}

function onChildKey(e: KeyboardEvent, child: Option) {
    const items = childItems()
    const at = items.indexOf(e.target as HTMLElement)

    switch (e.key) {
        case 'Enter':
        case ' ':
            if (child.action) runChildAction(child.action)
            break
        case 'ArrowDown':
            items[(at + 1) % items.length]?.focus()
            break
        case 'ArrowUp':
            items[(at - 1 + items.length) % items.length]?.focus()
            break
        case 'Home':
            items[0]?.focus()
            break
        case 'End':
            items[items.length - 1]?.focus()
            break
        // Back to the item that opened it — Escape closes ONE level, not the
        // whole menu, which is what a nested menu is expected to do.
        case 'ArrowLeft':
        case 'Escape':
            hideChildren()
            parentRef.value?.focus()
            break
        default:
            return
    }

    e.preventDefault()
    e.stopPropagation()
}

function runChildAction(action: () => void) {
    action()
    emit('hideContextMenu')
}
</script>

<style lang="scss">
.context-item {
    cursor: pointer;
    width: 100%;
    display: flex;
    align-items: center;
    padding: 0.4rem;
    position: relative;
    border-radius: $candy-radius-sm;
    transition: background-color $motion-move ease-out;

    .more {
        height: 1.5rem;
        width: 1.5rem;
        position: absolute;
        right: 2px;
        bottom: 6px;
        transform: scale(0.65);
    }

    .children {
        position: absolute;
        width: 12rem;
        z-index: 10;
        transform: scale(0);
        @include candy-box($candy-white, $candy-radius);
        color: $candy-text;
        padding: $small $smaller;
        opacity: 0;
        visibility: hidden;
        // Same as the menu itself: visible at once on open (or the first child
        // cannot take focus), hidden only after the fade on close.
        transition: opacity $motion-settle ease-out, visibility 0s linear $motion-settle;

        &.is-open {
            transition: opacity $motion-settle ease-out, visibility 0s;
        }

        ::-webkit-scrollbar-thumb {
            background-color: transparent;
        }

        &:hover ::-webkit-scrollbar-thumb {
            background-color: $gray2;
        }

        &:hover ::-webkit-scrollbar-thumb:hover {
            background-color: $gray1;
        }

        .wrapper {
            padding: 0 $smaller;
            overflow: auto;
            overflow-x: hidden;
            max-height: calc(100vh / 2 - 2rem);
            -webkit-overflow-scrolling: touch;
        }

        .context-item {
            line-height: 1.2;
            padding: $small 1rem;
            padding: 0.4rem 0.6rem;
        }

        .separator {
            padding: 0;
        }
    }

    // The keyboard's position in the menu reads the way the pointer's does.
    &:hover,
    &:focus-visible {
        // A look token (#241): Memphis keeps its soft pink, Desktop 98 the
        // navy menu highlight of its era.
        background: var(--look-menu-hover, #{$candy-pink-soft});
        color: var(--look-menu-hover-text, inherit);
    }

    &:focus-visible {
        outline: $focus-ring-w solid $mem-line;
        outline-offset: -$focus-ring-w;
    }

    .icon {
        height: 1.25rem;
        width: 1.25rem;
        margin-right: $small;

        svg {
            height: 100%;
            width: 100%;
        }

        // Option icons are injected as raw SVG (v-html) and many hardcode a
        // light fill (#F2F2F2 / white) in their asset — nearly invisible on the
        // light panel. Redirect every glyph to the inherited menu text colour
        // (currentColor) so they read in BOTH themes and still flip to ink on
        // the yellow critical-hover fill.
        //
        // Paths that carry a `stroke` are skipped: those come from the shared
        // 24x24 icon set (shuffle, repeat, ...) and are OPEN shapes — filling
        // them turns the glyph into a solid blob. They are currentColor
        // already, so the inherited colour reaches them anyway.
        svg path:not([stroke]) {
            fill: currentColor;
        }
    }

    // add to queue icon
    &:nth-child(2) .icon > svg {
        transform: scale(0.85);
    }

    // Takes the row's leftover width instead of a fixed 9rem. The old number
    // left 7px of the 13rem menu unused and cut "Add playlist to queue" (148px
    // of text into a 144px box) — a label that names its subject is exactly the
    // kind that runs long, so the column has to follow the menu, not a guess.
    // `min-width: 0` is what lets it shrink below its text and ellipsize at all.
    .label {
        flex: 1;
        min-width: 0;
    }

    // The chevron of a submenu row is absolutely positioned ON TOP of the label
    // (see `.more` above), so a full-width label would run underneath it.
    &:has(> .more) > .label {
        padding-right: 1.5rem;
    }
}

/* Removes the cursor pointer on the empty area within children dropdown of context-items */
.context-item:has(.children) > .children {
    cursor: initial !important;
}
</style>
