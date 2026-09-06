<template>
    <img
        v-if="image && !failed"
        class="avatar-image"
        :src="src"
        :width="size || 80"
        :height="size || 80"
        alt=""
        @error="failed = true"
    />
    <Avatar
        v-else
        :size="size || 80"
        :name="name"
        :square="false"
    />
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import Avatar from 'vue-boring-avatars'

import { paths } from '@/config'

const props = defineProps<{
    name: string
    size?: number
    image?: string
}>()

// When a real profile image exists we render it; if it 404s (e.g. the file is
// missing on disk) we fall back to the generated avatar via @error.
const failed = ref(false)
const src = computed(() => paths.images.user + props.image)

// Reset the fallback whenever the image changes (e.g. right after an upload),
// otherwise a previous load error would keep the generated avatar showing.
watch(
    () => props.image,
    () => {
        failed.value = false
    }
)
</script>

<style lang="scss">
.avatar-image {
    border-radius: 50%;
    object-fit: cover;
    display: block;
}
</style>
