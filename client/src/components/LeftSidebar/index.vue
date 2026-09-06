<template>
  <div class="l-sidebar" :style="{ width: displayWidth + 'px' }">
    <div class="scrollable">
      <Navigation />
      <div class="sidebar-library">
        <div class="sidebar-library-title">
          <span>Library</span>
          <button class="sidebar-newfolder" title="New folder" @click="onNewFolder">
            <PlusSvg />
          </button>
        </div>
        <!-- Manually-ordered zone: folders, pinned albums and pinned
             playlists, freely interleaved (shared position space). -->
        <div class="sidebar-toplevel" @dragover.prevent @drop="onDropToTopZone($event)">
          <template v-for="entry in topZone" :key="entry.kind + '-' + entry.id">
            <!-- Folder -->
            <div
              v-if="entry.kind === 'folder'"
              class="sidebar-folder"
              :class="{ 'drag-over': dragOverFolder === entry.id }"
              @dragover.prevent
              @drop="onDropToFolder(entry.id, $event)"
            >
              <div
                class="sidebar-folder-header"
                :class="markerClass('folder', entry.id)"
                draggable="true"
                @dragstart="onFolderDragStart(entry.id, $event)"
                @dragend="clearDrag"
                @click="folderStore.toggleCollapse(entry.id)"
                @contextmenu.prevent="onFolderContextMenu($event, entry.folder)"
                @dragover.prevent="onFolderHeaderDragOver(entry.folder, $event)"
                @drop.stop="onFolderHeaderDrop(entry.folder, $event)"
              >
                <div class="folder-icon-slot">
                  <FolderSvg class="folder-icon" />
                </div>
                <span class="ellip">{{ entry.folder.name }}</span>
                <span class="folder-count">{{ entry.folder.playlists.length }}</span>
                <RightArrowSvg class="folder-chevron" :class="{ open: !folderStore.isCollapsed(entry.id) }" />
              </div>
              <div v-if="!folderStore.isCollapsed(entry.id)" class="sidebar-folder-items">
                <SidebarPlaylistItem
                  v-for="pl in entry.folder.playlists"
                  :key="pl.id"
                  :pl="pl"
                  :class="markerClass('pl', pl.id)"
                  @dragstart="onPlDragStart(pl.id)"
                  @dragend="clearDrag"
                  @dragover.prevent="onItemDragOver(pl.id, $event)"
                  @drop.stop="onDropInFolderAt(entry.folder, pl, $event)"
                />
                <div v-if="!entry.folder.playlists.length" class="sidebar-folder-empty">Drop playlists here</div>
              </div>
            </div>

            <!-- Pinned album -->
            <RouterLink
              v-else-if="entry.kind === 'album'"
              :to="{ name: Routes.album, params: { albumhash: entry.al.albumhash } }"
              class="sidebar-playlist-item"
              :class="[{ active: $route.params.albumhash == entry.al.albumhash }, markerClass('album', entry.id)]"
              draggable="true"
              @dragstart="onAlbumDragStart(entry.al.albumhash, $event)"
              @dragend="clearDrag"
              @dragover.prevent="onAlbumDragOver(entry.al.albumhash, $event)"
              @drop.stop="onAlbumDrop(entry.al, $event)"
              @contextmenu.prevent="onAlbumContextMenu($event, entry.al)"
            >
              <div class="sidebar-pl-img rounded-sm">
                <img :src="thumbBase + entry.al.image" />
                <button
                  class="pl-play-overlay"
                  :class="{ playing: isCurrentAlbum(entry.al.albumhash) }"
                  :title="isPlayingAlbum(entry.al.albumhash) ? 'Pause' : 'Play'"
                  @click.prevent.stop="togglePlayAlbum(entry.al)"
                >
                  <PauseSvg v-if="isPlayingAlbum(entry.al.albumhash)" />
                  <PlaySvg v-else />
                </button>
              </div>
              <span class="ellip">{{ entry.al.title }}</span>
              <PushPinSvg class="pl-pin" title="Pinned" />
            </RouterLink>

            <!-- Pinned playlist -->
            <SidebarPlaylistItem
              v-else
              :pl="entry.pl"
              :class="markerClass('pl', entry.id)"
              @dragstart="onPlDragStart(entry.id)"
              @dragend="clearDrag"
              @dragover.prevent="onItemDragOver(entry.id, $event)"
              @drop.stop="onTopItemDrop(entry.pl, $event)"
            />
          </template>
        </div>

        <!-- Remaining (un-pinned, un-grouped) playlists, alphabetical. -->
        <div class="sidebar-bottom-zone" @dragover.prevent @drop="onDropToTop($event)">
          <SidebarPlaylistItem
            v-for="pl in bottomZone"
            :key="pl.id"
            :pl="pl"
            @dragstart="onPlDragStart(pl.id)"
            @dragend="clearDrag"
          />
        </div>
      </div>
    </div>

    <div
      class="sidebar-resize-handle"
      :class="{ active: isResizing }"
      @mousedown="startResize"
    ></div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import useSettingsStore from "@/stores/settings";
import usePStore from "@/stores/pages/playlists";
import usePinnedAlbums from "@/stores/pages/pinnedAlbums";
import { Routes } from '@/router'
import { paths } from '@/config'
import { Album, Playlist, Track } from "@/interfaces";

import Navigation from "@/components/LeftSidebar/NavButtons.vue";
import SidebarPlaylistItem from "./SidebarPlaylistItem.vue";
import PlaySvg from "@/assets/icons/play.svg";
import PauseSvg from "@/assets/icons/pause.svg";
import PushPinSvg from "@/assets/icons/push-pin.svg";
import FolderSvg from "@/assets/icons/folder.fill.svg";
import RightArrowSvg from "@/assets/icons/right-arrow.svg";
import PlusSvg from "@/assets/icons/plus.svg";

import useQueue from "@/stores/queue";
import useTracklist from "@/stores/queue/tracklist";
import useContextStore from "@/stores/context";
import useModalStore from "@/stores/modal";
import usePlaylistFolders from "@/stores/playlistFolders";
import { PlaylistFolder } from "@/requests/playlistFolders";
import { FromOptions, ContextSrc } from "@/enums";
import { playFromAlbumCard } from "@/helpers/usePlayFrom";
import { showAlbumContextMenu } from "@/helpers/contextMenuHandler";
import { AddToQueueIcon, DeleteIcon, PlayIcon, PlayNextIcon } from "@/icons";
import { getPlaylist } from "@/requests/playlists";
import { NotifType, useToast } from "@/stores/notification";

const ctxFlag = ref(false);

const settings = useSettingsStore();
const playlists = usePStore();
const pinnedAlbums = usePinnedAlbums();
const queue = useQueue();
const tracklist = useTracklist();
// Album cover thumbnail base (pinned albums in the library list).
const thumbBase = paths.images.thumb.small;

const folderStore = usePlaylistFolders();
const contextStore = useContextStore();
const modal = useModalStore();

const playlistMap = computed(() => {
  const m = new Map<number, Playlist>();
  for (const p of playlists.playlists) m.set(p.id, p);
  return m;
});

// Folders (ordered) each with their resolved playlists; unknown/deleted ids are
// dropped so stale references never render.
const foldersWithPlaylists = computed(() =>
  folderStore.sortedFolders.map(f => ({
    ...f,
    playlists: f.items.map(id => playlistMap.value.get(id)).filter((p): p is Playlist => !!p),
  }))
);

// Playlists not in any folder.
const ungroupedPlaylists = computed(() =>
  playlists.sortedPlaylists.filter(p => !folderStore.folderOf.has(p.id))
);

type TopEntry =
  | {
      kind: "folder";
      id: number;
      position: number;
      folder: PlaylistFolder & { playlists: Playlist[] };
    }
  | { kind: "playlist"; id: number; position: number; pl: Playlist }
  | { kind: "album"; id: string; position: number; al: Album };

// Tie-break for entries that share a position (e.g. all MAX before the first
// reorder): albums first, then folders, then playlists — preserving the
// historical layout where pinned albums sat above the folder/playlist zone.
const kindRank = { album: 0, folder: 1, playlist: 2 } as const;

// The manually-ordered zone: folders + pinned albums + pinned playlists
// interleaved by a shared position.
const topZone = computed<TopEntry[]>(() => {
  const entries: TopEntry[] = [];
  for (const f of foldersWithPlaylists.value) {
    entries.push({ kind: "folder", id: f.id, position: f.position ?? Number.MAX_SAFE_INTEGER, folder: f });
  }
  for (const al of pinnedAlbums.sortedAlbums) {
    entries.push({ kind: "album", id: al.albumhash, position: al.position ?? Number.MAX_SAFE_INTEGER, al });
  }
  for (const p of ungroupedPlaylists.value) {
    if (p.pinned) {
      entries.push({ kind: "playlist", id: p.id, position: p.settings?.position ?? Number.MAX_SAFE_INTEGER, pl: p });
    }
  }
  return entries.sort((a, b) => a.position - b.position || kindRank[a.kind] - kindRank[b.kind]);
});
// Everything else (un-pinned, un-grouped) stays alphabetical below.
const bottomZone = computed(() => ungroupedPlaylists.value.filter(p => !p.pinned));

const dragOverFolder = ref<number | null>(null);
// What is being dragged (set on dragstart — dataTransfer can't be read during
// dragover) and where the drop line currently sits.
const dragging = ref<{ type: "playlist" | "folder"; id: number } | { type: "album"; id: string } | null>(null);
const dropMarker = ref<{ kind: "pl" | "folder" | "album"; id: number | string; edge: "before" | "after" } | null>(
  null
);

function readDragPid(e: DragEvent): number | null {
  const raw = e.dataTransfer?.getData("playlistid");
  return raw ? parseInt(raw) : null;
}
function readDragFolderId(e: DragEvent): number | null {
  const raw = e.dataTransfer?.getData("folderid");
  return raw ? parseInt(raw) : null;
}
// Which half of the row the cursor is over → drop before or after it.
function edgeFromEvent(e: DragEvent): "before" | "after" {
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
  return e.clientY < rect.top + rect.height / 2 ? "before" : "after";
}
function markerClass(kind: "pl" | "folder" | "album", id: number | string) {
  const m = dropMarker.value;
  return {
    "drop-before": !!m && m.kind === kind && m.id === id && m.edge === "before",
    "drop-after": !!m && m.kind === kind && m.id === id && m.edge === "after",
  };
}
function clearDrag() {
  dragging.value = null;
  dropMarker.value = null;
  dragOverFolder.value = null;
}

// drag sources
function onPlDragStart(id: number) {
  dragging.value = { type: "playlist", id };
}
function onFolderDragStart(id: number, e: DragEvent) {
  dragging.value = { type: "folder", id };
  e.dataTransfer?.setData("folderid", String(id));
  if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
}
function onAlbumDragStart(albumhash: string, e: DragEvent) {
  dragging.value = { type: "album", id: albumhash };
  e.dataTransfer?.setData("albumhash", albumhash);
  if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
}

// playlist rows: show the line for any drag (a folder can also land before/after)
function onItemDragOver(plId: number, e: DragEvent) {
  if (!dragging.value) return;
  dragOverFolder.value = null;
  dropMarker.value = { kind: "pl", id: plId, edge: edgeFromEvent(e) };
}
// album rows: same, with the album's own marker
function onAlbumDragOver(albumhash: string, e: DragEvent) {
  if (!dragging.value) return;
  dragOverFolder.value = null;
  dropMarker.value = { kind: "album", id: albumhash, edge: edgeFromEvent(e) };
}

// reorder the shared top zone, placing the dragged entry next to the target
function reorderTopZone(
  draggedKind: "folder" | "playlist" | "album",
  draggedId: number | string,
  targetKind: "folder" | "playlist" | "album",
  targetId: number | string,
  edge: "before" | "after"
) {
  const order = topZone.value
    .map((en) => ({ kind: en.kind, id: en.id }))
    .filter((en) => !(en.kind === draggedKind && en.id === draggedId));
  let to = order.findIndex((en) => en.kind === targetKind && en.id === targetId);
  if (to < 0) to = order.length;
  if (edge === "after") to += 1;
  order.splice(to, 0, { kind: draggedKind, id: draggedId });

  const folderPos: { id: number; position: number }[] = [];
  const plPos: { id: number; position: number }[] = [];
  const albumPos: { albumhash: string; position: number }[] = [];
  order.forEach((en, i) => {
    if (en.kind === "folder") folderPos.push({ id: en.id as number, position: i });
    else if (en.kind === "album") albumPos.push({ albumhash: en.id as string, position: i });
    else plPos.push({ id: en.id as number, position: i });
  });
  if (folderPos.length) folderStore.reorder(folderPos);
  if (plPos.length) playlists.reorderTopLevel(plPos);
  if (albumPos.length) pinnedAlbums.reorderTopLevel(albumPos);
}

// drop anything onto a pinned album row → interleave next to it
async function onAlbumDrop(targetAl: Album, e: DragEvent) {
  void e;
  const drag = dragging.value;
  const edge = dropMarker.value?.edge ?? "before";
  clearDrag();
  if (!drag) return;

  if (drag.type === "album" && drag.id === targetAl.albumhash) return;

  if (drag.type === "playlist") {
    // Pull the playlist out of any folder first, then place it (only if pinned).
    if (folderStore.folderOf.has(drag.id)) await folderStore.move(drag.id, null);
    const dragged = playlists.playlists.find((p) => p.id === drag.id);
    if (!dragged?.pinned) return;
  }

  reorderTopZone(drag.type, drag.id, "album", targetAl.albumhash, edge);
}
function onDropInFolderAt(folder: { id: number; items: number[] }, targetPl: Playlist, e: DragEvent) {
  const pid = readDragPid(e);
  const edge = dropMarker.value?.edge ?? "before";
  clearDrag();
  if (pid === null) return;
  const without = folder.items.filter((i) => i !== pid);
  let pos = without.indexOf(targetPl.id);
  if (pos < 0) pos = without.length;
  if (edge === "after") pos += 1;
  folderStore.move(pid, folder.id, pos);
}
// drop a folder, album or playlist onto a pinned playlist in the top zone → interleave
async function onTopItemDrop(targetPl: Playlist, e: DragEvent) {
  void e;
  const drag = dragging.value;
  const edge = dropMarker.value?.edge ?? "before";
  clearDrag();
  if (!drag) return;

  if (drag.type === "folder" || drag.type === "album") {
    reorderTopZone(drag.type, drag.id, "playlist", targetPl.id, edge);
    return;
  }

  const pid = drag.id;
  if (pid === targetPl.id) return;
  // Pull the playlist out of any folder first, then place it (only if pinned).
  if (folderStore.folderOf.has(pid)) await folderStore.move(pid, null);
  const dragged = playlists.playlists.find((p) => p.id === pid);
  if (dragged?.pinned) reorderTopZone("playlist", pid, "playlist", targetPl.id, edge);
}

// Folder header: a dragged folder reorders (before/after). A dragged playlist
// uses 3 zones — top/bottom edge = land before/after the folder, middle = drop
// INTO the folder.
function folderHeaderZone(e: DragEvent): "before" | "into" | "after" {
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
  const y = e.clientY - rect.top;
  if (y < rect.height * 0.28) return "before";
  if (y > rect.height * 0.72) return "after";
  return "into";
}
function onFolderHeaderDragOver(folder: PlaylistFolder, e: DragEvent) {
  // Folders and albums can only land before/after a folder (no "into" zone —
  // folders contain playlists only).
  if (dragging.value?.type === "folder" || dragging.value?.type === "album") {
    dragOverFolder.value = null;
    dropMarker.value = { kind: "folder", id: folder.id, edge: edgeFromEvent(e) };
    return;
  }
  const zone = folderHeaderZone(e);
  if (zone === "into") {
    dropMarker.value = null;
    dragOverFolder.value = folder.id;
  } else {
    dragOverFolder.value = null;
    dropMarker.value = { kind: "folder", id: folder.id, edge: zone };
  }
}
async function onFolderHeaderDrop(folder: PlaylistFolder, e: DragEvent) {
  void e;
  const drag = dragging.value;
  const edge = dropMarker.value?.edge ?? "before";
  const into = dragOverFolder.value === folder.id;
  clearDrag();
  if (!drag) return;

  if (drag.type === "folder" || drag.type === "album") {
    if (drag.type === "folder" && drag.id === folder.id) return;
    reorderTopZone(drag.type, drag.id, "folder", folder.id, edge);
    return;
  }

  const pid = drag.id;
  if (into) {
    folderStore.move(pid, folder.id);
    return;
  }
  if (folderStore.folderOf.has(pid)) await folderStore.move(pid, null);
  const dragged = playlists.playlists.find((p) => p.id === pid);
  if (dragged?.pinned) reorderTopZone("playlist", pid, "folder", folder.id, edge);
}

// folder body / empty area: append a dragged playlist to the folder
// (folders and albums can't be dropped into a folder)
function onDropToFolder(folderId: number, e: DragEvent) {
  if (dragging.value && dragging.value.type !== "playlist") return clearDrag();
  const pid = readDragPid(e);
  clearDrag();
  if (pid !== null) folderStore.move(pid, folderId);
}
// drop in the top-zone empty space → append the dragged item to the end
function onDropToTopZone(e: DragEvent) {
  void e;
  const drag = dragging.value;
  clearDrag();
  if (!drag) return;
  const last = topZone.value[topZone.value.length - 1];
  if (!last || (drag.id === last.id && drag.type === last.kind)) return;
  if (drag.type === "folder" || drag.type === "album") {
    reorderTopZone(drag.type, drag.id, last.kind, last.id, "after");
  } else {
    const dragged = playlists.playlists.find(p => p.id === drag.id);
    if (dragged?.pinned && !folderStore.folderOf.has(drag.id)) {
      reorderTopZone("playlist", drag.id, last.kind, last.id, "after");
    }
  }
}
// bottom (un-pinned) zone: dropping here ungroups a playlist out of any folder
function onDropToTop(e: DragEvent) {
  if (dragging.value?.type === "folder") return clearDrag();
  const pid = readDragPid(e);
  clearDrag();
  if (pid !== null) folderStore.move(pid, null);
}
function onNewFolder() {
  modal.showFolderModal();
}
// All tracks of a folder: its playlists in folder order, each in full.
// Returns null (with a toast) when the folder yields no tracks.
async function getFolderTracks(folder: PlaylistFolder): Promise<Track[] | null> {
  const results = await Promise.all(
    folder.items.map((pid) => getPlaylist(String(pid), false, 0, -1))
  );
  const tracks = results.flatMap((r) => r?.tracks ?? []);
  if (!tracks.length) {
    useToast().showNotification("Folder has no tracks", NotifType.Error);
    return null;
  }
  return tracks;
}

function onFolderContextMenu(e: MouseEvent, folder: PlaylistFolder) {
  // showContextMenu expects the options getter to return a Promise.
  const options = async () => [
    {
      label: "Play",
      icon: PlayIcon,
      action: async () => {
        const tracks = await getFolderTracks(folder);
        if (!tracks) return;
        tracklist.setFromPlaylistFolder(folder.name, folder.id, tracks);
        queue.playSource();
      },
    },
    {
      // Every track in every playlist of the folder — same naming rule as the
      // other container menus, so it can't be read as "the one row I clicked".
      label: "Play folder next",
      icon: PlayNextIcon,
      action: async () => {
        const tracks = await getFolderTracks(folder);
        if (tracks) tracklist.insertAfterCurrent(tracks);
      },
    },
    {
      label: "Add folder to queue",
      icon: AddToQueueIcon,
      action: async () => {
        const tracks = await getFolderTracks(folder);
        if (tracks) tracklist.addTracks(tracks);
      },
    },
    {
      label: "Rename",
      action: () => modal.showFolderModal({ folder }),
    },
    {
      label: "Delete folder",
      icon: DeleteIcon,
      action: async () => {
        await folderStore.remove(folder.id);
      },
    },
  ];
  contextStore.showContextMenu(e, options, ContextSrc.PHeader);
}

// Wrapper so the handler receives the actual Ref — in the template,
// ctxFlag would be auto-unwrapped to a plain boolean.
function onAlbumContextMenu(e: MouseEvent, al: Album) {
  showAlbumContextMenu(e, ctxFlag, al);
}

// Is the given album the one currently loaded in the player?
function isCurrentAlbum(albumhash: string) {
  return (
    (tracklist.from as any)?.type === FromOptions.album &&
    (tracklist.from as any)?.albumhash === albumhash
  );
}
function isPlayingAlbum(albumhash: string) {
  return isCurrentAlbum(albumhash) && queue.playing;
}
function togglePlayAlbum(al: Album) {
  if (isCurrentAlbum(al.albumhash)) {
    queue.playPause();
  } else {
    playFromAlbumCard(al.albumhash, al.title);
  }
}

const SIDEBAR_MIN_WIDTH = 180
const SIDEBAR_MAX_WIDTH = 420
const isResizing = ref(false)
const dragWidth = ref(0)
let moveHandler: ((ev: MouseEvent) => void) | null = null
let upHandler: (() => void) | null = null

const displayWidth = computed(() =>
  isResizing.value ? dragWidth.value : settings.sidebar_width
)

function clamp(n: number) {
  return Math.min(Math.max(n, SIDEBAR_MIN_WIDTH), SIDEBAR_MAX_WIDTH)
}

function teardown() {
  if (moveHandler) document.removeEventListener('mousemove', moveHandler)
  if (upHandler) document.removeEventListener('mouseup', upHandler)
  moveHandler = null
  upHandler = null
  document.body.style.cursor = ''
  document.body.style.userSelect = ''
}

function startResize(e: MouseEvent) {
  e.preventDefault()
  isResizing.value = true
  dragWidth.value = settings.sidebar_width
  document.body.style.cursor = 'col-resize'
  document.body.style.userSelect = 'none'

  moveHandler = (ev: MouseEvent) => {
    dragWidth.value = clamp(ev.clientX)
  }
  upHandler = () => {
    settings.sidebar_width = dragWidth.value
    isResizing.value = false
    teardown()
  }
  document.addEventListener('mousemove', moveHandler)
  document.addEventListener('mouseup', upHandler)
}

onMounted(() => {
  if (!playlists.playlists.length) {
    playlists.fetchAll();
  }
  if (!pinnedAlbums.albums.length) {
    pinnedAlbums.fetchAll();
  }
  folderStore.fetch();
});

onBeforeUnmount(teardown);
</script>

<style lang="scss">
// Drag & drop: rows are positioned so the drop line can sit on their edge.
.sidebar-playlist-item,
.sidebar-folder-header {
  position: relative;
}

// The drop indicator — a brand-coloured line showing where the item will land.
.sidebar-playlist-item.drop-before::before,
.sidebar-playlist-item.drop-after::after,
.sidebar-folder-header.drop-before::before,
.sidebar-folder-header.drop-after::after {
  content: "";
  position: absolute;
  left: $small;
  right: $small;
  height: 2px;
  border-radius: 2px;
  // The theme's ink line, not static black: on the dark ground the drop
  // indicator was black on near-black, so the one piece of feedback telling
  // you where the item would land was invisible in exactly half the themes.
  background-color: $mem-line;
  pointer-events: none;
}

.sidebar-playlist-item.drop-before::before,
.sidebar-folder-header.drop-before::before {
  top: -1px;
}

.sidebar-playlist-item.drop-after::after,
.sidebar-folder-header.drop-after::after {
  bottom: -1px;
}

.l-sidebar {
  grid-area: l-sidebar;
  display: grid;
  // Logo lives in the top bar, the version moved to Settings → About: the
  // scroll container is the only row left.
  grid-template-rows: 1fr;
  @include candy-box($candy-white, $candy-radius);
  position: relative;
  // ⚠️ No padding here — it belongs to the scroller below. A padded panel
  // moves the scrollport's clip edge INWARDS, and a scroll container clips at
  // its padding box: rows then vanished 14px short of the ink frame, inside a
  // strip of paper where nothing was ever drawn (measured at 1440×760: clip at
  // y=97 against the frame's inner edge at y=83, and 599 against 611 at the
  // bottom). Padding on the SCROLLER scrolls away with the content instead, so
  // the same resting inset stays but rows are cut at the frame.
  min-height: 0;
  // Small black gap on the far left so the panel floats (Spotify-style).
  margin-left: 8px;

  .scrollable {
    height: 100%;
    overflow: auto;
    overflow-x: hidden;
    -webkit-overflow-scrolling: touch;
    // The panel's inset, moved here from `.l-sidebar` (see above). Vertically
    // 1.875rem = the 0.875rem the panel used to hold plus the 1rem this
    // already had, so the resting distance from frame to first row is
    // unchanged at 30px; the scrollbar now rides the frame instead of floating
    // 14px inside it.
    padding: 1.875rem 0.875rem;

    // ⚠️ Follow the frame's curve. Now that the scrollport reaches the border,
    // both its contents AND its scrollbar are square against a rounded panel —
    // and a child paints ABOVE its parent's border, so the thumb cut straight
    // through the corner arc at top-right and bottom-right. The inner radius
    // is the panel's minus the border it sits inside. (`overflow: hidden` on
    // `.l-sidebar` would fix the same thing by clipping, but it would also
    // swallow `.sidebar-resize-handle`, which hangs 4px outside on purpose.)
    border-radius: $candy-radius - $candy-border-w;

    // Scrollbar is hidden until the sidebar is hovered. The width/`thin` track
    // stays constant so showing the thumb never reflows the list.
    // Firefox + standard-properties path (Chrome 121+): transparent thumb by default.
    scrollbar-width: thin;
    scrollbar-color: transparent transparent;

    // Legacy WebKit path (older Chrome): transparent thumb by default.
    &::-webkit-scrollbar-thumb {
      background-color: transparent;
    }
  }

  &:hover .scrollable {
    scrollbar-color: $gray2 transparent;
  }

  &:hover .scrollable::-webkit-scrollbar-thumb {
    background-color: $gray2;
  }

  &:hover .scrollable::-webkit-scrollbar-thumb:hover {
    background-color: $gray1;
  }
}

.sidebar-resize-handle {
  position: absolute;
  top: 0;
  right: -4px;
  width: 8px;
  height: 100%;
  cursor: col-resize;
  z-index: 10;
  background-color: transparent;
  transition: background-color 0.15s ease;

  &:hover,
  &.active {
    background-color: $candy-pink-deep;
  }
}

// (The version sticker and its ink-topped footer stood here — including the
// negative horizontal margin that bled the divider past .l-sidebar's padding
// to reach the frame. All of it is gone: Settings → About already carried the
// same number, and more of it (client AND server version, which the sticker
// never showed), so the sidebar was spending a permanent 40px band and its
// bottom edge on a duplicate. Removing it also hands the scroller the panel's
// full height — see the clip-edge note on .l-sidebar.)

.sidebar-library {
  // No border-top any more: the LIBRARY label carries its own surface and is
  // the divider (see .sidebar-library-title). The 1px hairline that stood here
  // was the only element of its weight among 3px ink frames.
  margin-top: 1.4rem;

  // The rows are plates now (#378), so the list needs the same air and the same
  // reserved room for the offset shadow as the navigation above it — the two
  // lists sit directly on top of each other and any difference shows.
  //
  // ⚠️ .sidebar-bottom-zone (alphabetical, un-pinned playlists) had NONE of
  // this — no rule for it existed anywhere in this file. Rows sat flush
  // against each other (0px gap, measured) with their right-hand offset
  // shadow clipped at the scroll container's edge (no padding-right
  // reserve): exactly the "same fix as the row above it, minus one row" gap
  // this comment already warns about, just in the sibling zone instead of a
  // sibling row.
  .sidebar-toplevel,
  .sidebar-bottom-zone {
    display: flex;
    flex-direction: column;
    gap: $small;
    // Both directions the offset falls towards — see the same fix in
    // NavButtons.vue. Without the bottom reserve the last row of the library
    // loses its shadow the way Stats did.
    padding-right: $small;
    padding-bottom: $smaller;
  }

  // Air between the pinned/grouped zone and the alphabetical remainder below
  // it — without it the two zones' rows sat exactly as flush as the rows
  // inside .sidebar-bottom-zone did before the fix above.
  .sidebar-bottom-zone {
    margin-top: $small;
  }

  .sidebar-library-title {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 0.75rem;
    font-weight: 700;
    text-transform: uppercase;
    padding: 0 0 0.6rem;
    // The same right-hand reserve every other sidebar row has (#397): the
    // scroll container clips at overflow-x, and this was the one row whose
    // control sat flush against that edge — measured: the [+]'s right edge at
    // exactly the clip line, its frame and 3px offset shadow cut off. With the
    // reserve it also lines up with the plates below instead of overhanging
    // them by the same 8px.
    padding-right: $small;
    letter-spacing: 0.05em;

    // The heading IS the divider now. The 1px grey hairline that used to sit
    // above it was the only element of that weight in a sidebar built from 3px
    // ink frames — it read as a different kit (#355 collects the same mismatch
    // elsewhere). A label with its own surface separates the two lists without
    // drawing a line at all.
    //
    // Blush, and that only works since #418 moved hover to the contrast
    // surface: while blush WAS the pointer colour, a heading wearing it looked
    // permanently hovered.
    //
    // No hatch: the texture means "you can press this", and this is a caption.
    > span {
      background-color: $mem-blush;
      color: $mem-ink;
      border: $candy-border;
      border-radius: 8px;
      box-shadow: 3px 3px 0 var(--mem-shadow);
      padding: 3px 10px;
    }

    // "New folder". Its blush circle came from the global button base — the
    // comment here used to say so — which meant a control with no owner: no
    // border, no shadow, and 22px across in a design where every other button
    // has a frame it sits in. It takes the action role now, at the smallest
    // size that still reads as a button next to the section caption.
    // `$control-dense`, the same footprint as the thumbnails in the rows below
    // — the size was already right, it just had no name, and the glyph came
    // from a hand-written override because `btn-action` had no `$glyph` knob.
    // It does now, so both numbers come from the tier.
    .sidebar-newfolder {
      @include btn-action($size: $control-dense, $glyph: $control-dense-glyph, $radius: 50%);
    }
  }

  // A FOLDER IS ONE PLATE, not a plate with plates inside it (#378).
  //
  // The alternatives both broke down at the same place. Giving each child its
  // own plate makes six equal-ranking plates out of a group, so the folder stops
  // reading as a folder; leaving the children flat rebuilds — in miniature — the
  // exact seam between plates and bare rows that this whole round removed from
  // the sidebar. Wrapping head and contents in ONE box solves both: the children
  // may be flat BECAUSE they sit on a plate, and the group is visible as a group.
  .sidebar-folder {
    @include mem-row-plate($sidebar-row-radius);
    // The children sit flush against the frame, so the box has to clip them —
    // this is also what keeps the head's fill inside the rounded corners.
    overflow: hidden;

    &.drag-over {
      background-color: $candy-pink-soft;
      outline: 1px dashed $mem-line;
    }

    .sidebar-folder-header {
      display: flex;
      align-items: center;
      gap: $small;
      // 38px, NOT the 44px a playlist row is — and that difference is the
      // point. The head sits INSIDE the folder's plate, so the box adds its own
      // 3px frame above and below: a head as tall as a row made the collapsed
      // folder 50px against 44 everywhere else, visible as one row sticking out
      // of the rhythm. 38 + 2x3 = 44.
      min-height: 2.375rem;
      // NO plate of its own: the head is the top section of the folder's box.
      // But it IS the pressable part of that box, so it carries the hatch —
      // as a ring in its own padding, like every other row.
      padding: 5px $small;
      --row-fill: #{$mem-panel};
      background-color: var(--row-fill);
      @include mem-hatch(38px, $on: surface);
      cursor: pointer;
      font-size: $sidebar-row-font;
      // Same weight as every other row in this sidebar.
      font-weight: 700;
      // NO transition: the paint is a cut (styling.md).

      // Hover tints the head's section of the box rather than drawing a second
      // frame inside the first one. The ring follows via --row-fill.
      //
      // The SHARED pointer token, not blush — this head was the last hover in
      // the app still painting the retired pointer colour, invisible to the
      // hoverToken census because the fill travels through `--row-fill`. Blush
      // means "label" and "owns the open context menu" since #422; a hover may
      // not impersonate either. Text and hatch flip with the fill, exactly as
      // on the row plates one section up.
      &:hover {
        --row-fill: var(--mem-hover);
        color: var(--mem-hover-text);
        background-image: var(--mem-hatch-hover);
      }

      .folder-icon-slot {
        // The sidebar's own tier, same slot as a playlist thumbnail, so the
        // folder icon lines up with the other library items — and so the head
        // fits in its 38px without the slot pushing it back open.
        flex-shrink: 0;
        width: $control-dense;
        height: $control-dense;
        display: grid;
        place-items: center;
      }

      .folder-icon {
        width: 1.35rem;
        height: 1.35rem;
        opacity: 0.85;
      }

      .folder-chevron {
        // Expand/collapse affordance on the right; points right when collapsed,
        // rotates down when open.
        flex-shrink: 0;
        width: 0.7rem;
        height: 0.7rem;
        opacity: 0.6;
        transition: transform 0.15s ease;

        &.open {
          transform: rotate(90deg);
        }
      }

      // Same as the playlist rows, small buffer for the same reason.
      span.ellip {
        @include mem-hatch-clear($small);
      }

      .folder-count {
        // The count sits on the plate just like the name does, so it needs the
        // same cover (#476) — it was the one label on this row without one, and
        // at 0.7rem with 0.5 opacity the strokes behind it cost the most.
        @include mem-hatch-clear(4px);
        margin-left: auto;
        flex-shrink: 0;
        font-size: 0.7rem;
        font-weight: 500;
        opacity: 0.5;
      }
    }

    // The contents live INSIDE the folder's plate, separated from the head by
    // one ink line — the indent rail (margin + 1px border-left) that used to
    // mark the group is what the box does now, and doing both would state the
    // same thing twice.
    .sidebar-folder-items {
      border-top: $candy-border-w solid $mem-line;
      padding: $smaller;
      display: flex;
      flex-direction: column;
      gap: $smallest;

      // Flat BECAUSE they sit on a plate: no frame, no offset, no hatch. This
      // is the one place a library row is allowed to drop the plate, and it is
      // allowed precisely because the folder around it already is one.
      .sidebar-playlist-item {
        background-color: transparent;
        background-image: none;
        border-color: transparent;
        box-shadow: none;

        &:hover {
          background-color: $mem-soft;
          border-color: transparent;
          box-shadow: none;
        }

        // The selection still needs to be visible in here, so the fill and its
        // accent hatch stay — only frame and offset are dropped.
        &.active {
          @include mem-row-plate-active;
          border-color: transparent;
          box-shadow: none;
        }
      }
    }

    .sidebar-folder-empty {
      font-size: 0.75rem;
      opacity: 0.4;
      padding: 0.35rem $small;
      font-style: italic;
    }
  }

  .sidebar-playlist-item {
    display: flex;
    align-items: center;
    gap: $small;
    // Same plate as the navigation above: panel fill, ink frame, offset shadow,
    // hatch. The padding still subtracts the border width so the row height does
    // not follow $candy-border-w.
    @include mem-row-plate($sidebar-row-radius);
    // ONE row anatomy in this sidebar: same 44px height and same weight as the
    // navigation above. The earlier split (500, shorter rows) was a deliberate
    // "structure vs. data" distinction and it read as two half-finished lists
    // instead — the plates are the same object, so they look the same.
    // 28px thumbnail + 2x5px padding + 2x3px border = 44px, the navigation's
    // 24px glyph + 2x7px + 2x3px.
    padding: 5px $small;
    font-size: $sidebar-row-font;
    font-weight: 700;

    &:hover { @include mem-row-plate-hover; }
    &.active {
      // Static blush + the accent hatch; frame and offset are already on the
      // plate, so selecting a playlist changes colour only.
      @include mem-row-plate-active;
    }

    // The label carries the smooth fill and is only as wide as its own text —
    // the space between it and the pin stays texture. The thumbnail needs no
    // cover of its own: it is opaque and hides what is under it.
    // Small buffer here, unlike the navigation: every pixel of it is taken off
    // the visible name. At the navigation's 26px the playlist titles truncated
    // a whole word early ("Chill Gami…" instead of "Chill Gaming"), and a name
    // you cannot read is a worse trade than a little less texture.
    span.ellip {
      opacity: 0.85;
      @include mem-hatch-clear($small);
    }

    .pl-pin {
      // Pushed to the far edge now that the label no longer fills the row.
      margin-left: auto;
      flex-shrink: 0;
      width: 0.95rem;
      height: 0.95rem;
      color: $candy-text;
      // Tilt the thumbtack like Spotify's pin (📌): head top-right, point lower-left.
      transform: rotate(35deg);
    }
  }

  .sidebar-pl-img {
    // `$control-dense`, the sidebar's tier — 28px rather than the content
    // rows' 32: the row's padding grew to make room for the hatch ring and the
    // thumbnail gives that back, so the row height stays where it was
    // (28 + 2x4 + 2x3 = 42px against the previous 43). That decision is what
    // the token now records; it used to be a literal with a comment.
    width: $control-dense;
    height: $control-dense;
    flex-shrink: 0;
    overflow: hidden;
    position: relative;

    img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }

    // Spotify-style play/pause overlay: shows on hover, or always while this
    // playlist is the one playing.
    .pl-play-overlay {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      padding: 0;
      border: none;
      border-radius: 0;
      background-color: rgba(0, 0, 0, 0.55);
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      opacity: 0;
      transition: opacity 0.15s ease;

      svg {
        height: $control-dense-glyph;
        width: $control-dense-glyph;
        // White play glyph over the dark hover scrim — static light.
        color: $mem-panel-static;
      }

      &:hover {
        background-color: rgba(0, 0, 0, 0.65);
      }
    }

    &:hover .pl-play-overlay,
    .pl-play-overlay.playing {
      opacity: 1;
    }
  }

  .sidebar-pl-placeholder {
    width: 100%;
    height: 100%;
    background-color: $candy-pink-soft;
    display: flex;
    align-items: center;
    justify-content: center;

    svg {
      width: 1.1rem;
      height: 1.1rem;
      opacity: 0.5;
    }
  }
}
</style>
