<template>
  <form class="playlist-modal" @submit="submit">
    <label for="name">Folder name</label>
    <br />
    <input
      id="modal-folder-name-input"
      type="search"
      class="rounded-sm"
      name="name"
      placeholder="Type a name..."
      spellcheck="false"
    />
    <br /><br />
    <button type="submit" class="btn-pill">{{ folder ? "Rename" : "Create" }}</button>
  </form>
</template>

<script setup lang="ts">
import { onMounted } from "vue";

import { NotifType, Notification } from "@/stores/notification";
import usePlaylistFolders from "@/stores/playlistFolders";
import { PlaylistFolder } from "@/requests/playlistFolders";

const props = defineProps<{
  // when set, the modal renames this folder instead of creating a new one
  folder?: PlaylistFolder;
  // when set (create mode), this playlist is moved into the new folder
  movePlaylistId?: number;
}>();

const folderStore = usePlaylistFolders();

const emit = defineEmits<{
  (e: "setTitle", title: string): void;
  (e: "hideModal"): void;
}>();

emit("setTitle", props.folder ? "Rename folder" : "New folder");

onMounted(() => {
  const input = document.getElementById("modal-folder-name-input") as HTMLInputElement;
  input.focus();
  input.value = props.folder?.name || "";
});

async function submit(e: Event) {
  e.preventDefault();
  const name = (e.target as any).elements["name"].value.trim();

  if (!name) {
    new Notification("Folder name can't be empty", NotifType.Error);
    return;
  }

  if (props.folder) {
    await folderStore.rename(props.folder.id, name);
  } else {
    const created = await folderStore.create(name);
    if (created && props.movePlaylistId != null) {
      await folderStore.move(props.movePlaylistId, created.id);
    }
  }

  emit("hideModal");
}
</script>
