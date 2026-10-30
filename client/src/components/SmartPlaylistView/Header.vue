<template>
  <!-- The playlist header's anatomy (detail-head: art cell, then the text
       column) with the smart playlist's own facts: no cover, a count, and the
       rules read back as a sentence. The action row is canonical: play, the one
       secondary (shuffle), then the overflow ("More options") that holds edit,
       save as playlist and delete — the same menu the card opens. -->
  <div class="p-header smart-header">
    <div class="dh-art">
      <div class="card-art is-glyph">
        <SparklesSvg class="bg" />
      </div>
    </div>
    <div class="smart-info dh-body">
      <div class="type dh-type">Smart playlist</div>
      <div class="title dh-title ellip" :title="info.name">{{ info.name }}</div>
      <div class="dh-meta">{{ countText }}</div>
      <p class="smart-rules">{{ rulesText }}</p>

      <div class="btns header-actions">
        <PlayBtnRect :source="playSources.smartPlaylist" />
        <button class="smart-shuffle" title="Shuffle" aria-label="Shuffle" @click="shuffle">
          <span class="icon" v-html="ShuffleIcon"></span>
        </button>
        <button
          class="options"
          :class="{ context_menu_showing: contextMenuFlag }"
          title="More options"
          aria-label="More options"
          @click.prevent="showMenu"
        >
          <MoreSvg />
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'

import { playSources } from '@/enums'
import { showSmartPlaylistContextMenu } from '@/helpers/contextMenuHandler'
import PlayBtnRect from '@/components/shared/PlayBtnRect.vue'
import useSmartPlaylistPage from '@/stores/pages/smartPlaylist'
import { playFromSmartPlaylist } from '@/helpers/usePlayFrom'
import { summarize } from '@/utils/smartPlaylistRules'

import MoreSvg from '@/assets/icons/more.svg'
import ShuffleIcon from '@/assets/icons/shuffle.svg?raw'
import SparklesSvg from '@/assets/icons/sparkles.svg'

const page = useSmartPlaylistPage()
const contextMenuFlag = ref(false)

const info = computed(() => page.info)

const countText = computed(() => {
  const n = page.count
  return `${n.toLocaleString()} ${n === 1 ? 'Track' : 'Tracks'}`
})

const rulesText = computed(() => {
  // Nothing to read before the page has loaded its rules.
  if (!info.value.rules) return ''
  return summarize(info.value)
})

function shuffle() {
  playFromSmartPlaylist(info.value.id, undefined, true)
}

// Edit, save as playlist and delete: the same entries as the card's menu.
function showMenu(e: MouseEvent) {
  showSmartPlaylistContextMenu(e, info.value, contextMenuFlag)
}
</script>

<style lang="scss">
.smart-header {
  .smart-rules {
    margin: 0.25rem 0 0;
    font-size: 0.9rem;
    line-height: 1.35;
    overflow-wrap: anywhere;
  }

  .header-actions {
    margin-top: 0;
  }

  // The secondary and the overflow action are the header role (`btn-action`):
  // the 44px target, the panel face and the offset shadow come from the role.
  .smart-shuffle,
  .options {
    @include btn-action;
    flex-shrink: 0;
  }

  .smart-shuffle .icon {
    display: flex;
    color: inherit;

    svg {
      width: 1.5rem;
      height: 1.5rem;
    }
  }

  .options.context_menu_showing {
    background-color: $darkblue;
    color: $mem-ink;
  }
}
</style>
