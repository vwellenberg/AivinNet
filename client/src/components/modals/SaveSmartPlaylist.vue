<template>
  <!-- Freezes what the rules hold now into a normal playlist. The name is the
       only input: the tracks come from the server, at the moment of saving. -->
  <form class="save-smart" novalidate @submit.prevent="save">
    <label class="se-label" for="save-smart-name">Playlist name</label>
    <input
      id="save-smart-name"
      v-model="name"
      name="name"
      type="text"
      class="se-input"
      placeholder="Type a name..."
      spellcheck="false"
    />
    <p class="save-smart-note">The tracks it holds now become a playlist of their own. It can then be edited like any other.</p>
    <p v-if="error" class="se-error" role="alert">{{ error }}</p>
    <div class="save-smart-submit">
      <button type="submit" class="btn-pill" :disabled="busy">Save as playlist</button>
    </div>
  </form>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'

import { saveSmartPlaylistAsPlaylist } from '@/requests/smartPlaylists'
import usePlaylistListPageStore from '@/stores/pages/playlists'

const props = defineProps<{
  smartid: number
  name?: string
}>()

const emit = defineEmits<{
  (e: 'setTitle', title: string): void
  (e: 'hideModal'): void
}>()

const router = useRouter()

emit('setTitle', 'Save as playlist')

const name = ref(props.name ?? '')
const error = ref('')
const busy = ref(false)

async function save() {
  error.value = ''
  const typed = name.value.trim()
  if (!typed) {
    error.value = 'Playlist name can\'t be empty'
    return
  }

  busy.value = true
  const saved = await saveSmartPlaylistAsPlaylist(props.smartid, typed)
  busy.value = false

  if (!saved.ok) {
    error.value = saved.error
    return
  }

  // The new playlist belongs in the list the playlists page shows.
  await usePlaylistListPageStore().fetchAll()
  emit('hideModal')
  router.push({ name: 'PlaylistView', params: { pid: saved.value.id } })
}
</script>

<style lang="scss">
.save-smart {
  display: grid;
  gap: 0.75rem;
  margin-top: 0.75rem;

  .se-label {
    font-size: 0.9rem;
    font-weight: 500;
    color: $gray1;
  }

  .se-input {
    min-height: $bar-control;
    width: 100%;
    min-width: 0;
  }

  .save-smart-note {
    margin: 0;
    font-size: 0.9rem;
    color: $gray1;
  }

  // Alarm text is the theme's ink (paper in the dark), weight carries the emphasis.
  .se-error {
    margin: 0;
    font-size: 0.9rem;
    font-weight: 700;
    color: $candy-text;
  }

  .save-smart-submit {
    display: flex;
    justify-content: flex-end;

    button {
      min-height: $bar-control;
      padding-left: $medium;
      padding-right: $medium;
    }
  }
}
</style>
