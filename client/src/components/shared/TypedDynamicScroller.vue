<script setup lang="ts">
// ---------------------------------------------------------------------------
// The app's `DynamicScroller`: vue-virtual-scroller 3.x's own DynamicScroller,
// rebuilt on the library's `useDynamicScroller` composable, with ONE change —
// every row carries `type: viewType(item)` into `RecycleScroller`, so each
// component keeps its own view pool.
//
// Why it exists: the detail pages render a mixed list (album head, disc bar,
// track rows, card rows, stats). Without a per-component pool a recycled view
// turns a card row into a head, Vue rebuilds it with `<component :is>`, and the
// new node replays its arrival. See utils/typedScroller.ts for the history.
//
// v3's DynamicScroller builds rows `{ item, id, size }` and passes no type, so
// `RecycleScroller` falls back to one pool. This component is the same
// composition with the type added; the props, slots, emits and exposed methods
// mirror the library's `DynamicScroller` (MIT, vue-virtual-scroller authors), so
// pages need no change. Registered as `DynamicScroller` in main.ts.
// ---------------------------------------------------------------------------
import { computed, ref, toRef } from 'vue'
import { RecycleScroller, useDynamicScroller } from 'vue-virtual-scroller'
import type { CacheSnapshot, UseDynamicScrollerOptions } from 'vue-virtual-scroller'

import { typeRows } from '@/utils/typedScroller'

defineOptions({ inheritAttrs: false })

const props = withDefaults(
    defineProps<{
        items?: unknown[]
        keyField?: string
        direction?: 'vertical' | 'horizontal'
        listTag?: string
        itemTag?: string
        minItemSize?: number | string
        shift?: boolean
        cache?: CacheSnapshot
        disableTransform?: boolean
        flowMode?: boolean
        hiddenPosition?: number
        enabled?: boolean
        pageMode?: boolean
        scrollParent?: HTMLElement | Window
    }>(),
    {
        items: () => [],
        keyField: 'id',
        direction: 'vertical',
        listTag: 'div',
        itemTag: 'div',
        shift: false,
        disableTransform: false,
        flowMode: false,
        enabled: true,
        pageMode: false,
        minItemSize: undefined,
        cache: undefined,
        hiddenPosition: undefined,
        scrollParent: undefined,
    }
)

const emit = defineEmits<{ resize: []; visible: [] }>()

// Hoisted like the library does it: one ref for the component's life, not a new one per recompute.
const items = toRef(props, 'items')

const scroller = ref<unknown>()

/** The RecycleScroller's root element, read the way the library's own component reads it. */
const el = computed<HTMLElement | undefined>(() => {
    const instance = scroller.value as { el?: unknown } | undefined
    const node = instance?.el
    return node && typeof node === 'object' && 'value' in node
        ? ((node as { value: unknown }).value as HTMLElement | undefined)
        : (node as HTMLElement | undefined)
})

const options = computed(() => ({
    items,
    keyField: props.keyField,
    direction: props.direction,
    minItemSize: props.minItemSize,
    shift: props.shift,
    cache: props.cache,
    flowMode: props.flowMode,
    hiddenPosition: props.hiddenPosition,
    enabled: props.enabled,
    pageMode: props.pageMode,
    scrollParent: props.scrollParent,
    el: el.value,
    onResize: () => emit('resize'),
    onVisible: () => emit('visible'),
}) as UseDynamicScrollerOptions<any>)

const {
    itemsWithSize,
    forceUpdate,
    startSpacerSize,
    endSpacerSize,
    scrollToItem,
    scrollToPosition,
    findItemIndex,
    getItemOffset,
    getItemSize,
    cacheSnapshot,
    restoreCache,
    scrollToBottom,
    onScrollerResize,
    onScrollerVisible,
} = useDynamicScroller(options)


defineExpose({
    startSpacerSize,
    endSpacerSize,
    scrollToItem,
    scrollToPosition,
    findItemIndex,
    getItemOffset,
    scrollToBottom,
    getItemSize,
    cacheSnapshot,
    restoreCache,
    forceUpdate,
})
</script>

<template>
    <RecycleScroller
        ref="scroller"
        v-bind="$attrs"
        :items="typeRows(itemsWithSize)"
        :min-item-size="minItemSize"
        :direction="direction"
        :cache="cache"
        :disable-transform="disableTransform"
        :flow-mode="flowMode"
        :hidden-position="hiddenPosition"
        :enabled="enabled"
        :page-mode="pageMode"
        :scroll-parent="scrollParent"
        key-field="id"
        type-field="type"
        :list-tag="listTag"
        :item-tag="itemTag"
        @resize="onScrollerResize"
        @visible="onScrollerVisible"
    >
        <template #default="{ item: row, index, active }">
            <slot :item="row.item" :index="index" :active="active" :item-with-size="row" />
        </template>
        <template #empty>
            <slot name="empty" />
        </template>
        <template v-if="$slots.before" #before>
            <slot name="before" />
        </template>
        <template v-if="$slots.after" #after>
            <slot name="after" />
        </template>
    </RecycleScroller>
</template>
