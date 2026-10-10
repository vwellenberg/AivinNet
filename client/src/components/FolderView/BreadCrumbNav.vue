<template>
    <div class="breadcrumb-nav">
        <!-- A crumb navigates, so it is a button (#137). The inner <a> has no
             href and is a style hook only, so it stays out of the tab order. -->
        <button
            v-for="path in props.subPaths ? props.subPaths : localSubPaths"
            :key="path.path"
            type="button"
            class="path"
            :class="{ inthisfolder: path.active }"
            :aria-current="path.active ? 'location' : undefined"
            @click.prevent="$emit('navigate', path.path)"
        >
            <a class="text">{{ path.name }}</a>
            <!-- 👆 the a tag was misused to avoid rewriting css after moving this code to a component -->
        </button>
    </div>
</template>

<script setup lang="ts">
import { Ref, onMounted, ref, watch } from 'vue'

import { subPath } from '@/interfaces'
import { createSubPaths } from '@/utils'

import useSettings from '@/stores/settings'
import useFolder from '@/stores/pages/folder'

const props = defineProps<{
    subPaths?: subPath[]
}>()

const folder = useFolder()
const settings = useSettings()

const localSubPaths: Ref<subPath[]> = ref([])

let oldpath = ''

const getSubPaths = (newPath: string) => {
    ;[oldpath, localSubPaths.value] = createSubPaths(newPath, oldpath, settings.root_dirs)
}

// INFO: if there are no subPaths, watch the folder path
if (!(props.subPaths && props.subPaths.length)) {
    watch(
        () => folder.path,
        newPath => {
            newPath = newPath as string
            if (newPath == undefined) return

            getSubPaths(newPath)
        }
    )
}

defineEmits<{
    (e: 'navigate', path: string): void
}>()

onMounted(() => {
    if (props.subPaths != undefined) {
        return
    }

    getSubPaths(folder.path)
})
</script>

<style lang="scss">
.designatedOS .breadcrumb-nav {
    &::-webkit-scrollbar {
        display: none;
    }
}

.breadcrumb-nav {
    display: flex;
    gap: $smaller;

    .path {
        // Restated for the <button> (#137).
        background-color: transparent;
        border: none;
        color: inherit;
        font: inherit;
        white-space: nowrap;
        margin: auto 0;
        cursor: pointer;
        display: flex;
        align-items: center;

        .text {
            font-size: 1rem;
            font-weight: 500;
            padding: $smaller $small;
            border-radius: $candy-radius-xs;
            transition: background-color $motion-move ease-out;
        }

        &::before {
            content: '∕';
            margin-right: $smaller;
            color: $gray2;
            font-size: 1rem;
        }

        // &:first-child {
        //   display: none;
        // }

        &:last-child {
            padding-right: $smaller;
        }

        // The shared pointer token (#418), not a tint: the plate around the
        // crumbs is the only fill here, and a second pink inside it read as two
        // colours side by side.
        &:hover {
            .text {
                background-color: var(--mem-hover);
                color: var(--mem-hover-text);
            }
        }
    }

    // The current folder is marked by weight, not by a fill of its own — the
    // plate already is the one container in this row.
    .inthisfolder > .text {
        font-weight: 700;
    }
}
</style>
