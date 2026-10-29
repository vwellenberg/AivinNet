<template>
  <!-- The server's calling card (#547), above the results of the search "aivin".
    It decides for itself whether to show: the query is the whole condition, so
    no other query fetches it or draws it. A failed answer draws nothing either —
    it is an easter egg, not a status page. -->
  <section v-if="open && card" class="server-card" aria-label="About this server">
    <p class="server-card-title">AivinNet v{{ card.version }}</p>
    <p class="server-card-sub">
      Up for {{ uptime }}<template v-if="since"> · since {{ since }}</template>
    </p>
    <dl class="server-card-numbers">
      <div>
        <dt>Tracks</dt>
        <dd>{{ count(card.tracks) }}</dd>
      </div>
      <div>
        <dt>Albums</dt>
        <dd>{{ count(card.albums) }}</dd>
      </div>
      <div>
        <dt>Artists</dt>
        <dd>{{ count(card.artists) }}</dd>
      </div>
      <div>
        <dt>Plays, all users</dt>
        <dd>{{ card.plays === null ? "—" : count(card.plays) }}</dd>
      </div>
    </dl>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";

import { getServerCard, type ServerCard } from "@/requests/searchMusic";
import { formatSince, formatUptime, isServerCardQuery } from "@/utils/serverCard";

const props = defineProps<{ query: string }>();

const open = computed(() => isServerCardQuery(props.query));

// Fetched once per mount: the card is a snapshot, and the search view mounts
// it again only when the page does.
const card = ref<ServerCard | null>(null);

watch(
  open,
  async isOpen => {
    if (!isOpen || card.value) return;
    const data = await getServerCard();
    if (data && typeof data.version === "string") card.value = data;
  },
  { immediate: true }
);

const uptime = computed(() => (card.value ? formatUptime(card.value.uptime) : ""));
const since = computed(() => formatSince(card.value?.since ?? null));

function count(n: number): string {
  return n.toLocaleString("en-US");
}
</script>

<style lang="scss">
// A reading plate on the ground, like every text on it (styling.md, `--mem-veil`).
.server-card {
  margin: 0 0 $medium;
  padding: 1rem 1.25rem;
  background-color: var(--mem-veil);
  border: $candy-border;
  border-radius: $candy-radius;
  @include candy-shadow(4px, 4px);
  color: $mem-content-text;

  p {
    margin: 0;
  }

  .server-card-title {
    @include mem-sticker;
    margin: 0 0 0.5rem 0;
    font-size: 1.15rem;
    font-weight: 700;
  }

  .server-card-sub {
    color: $mem-content-muted;
  }

  .server-card-numbers {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(8rem, 1fr));
    gap: $small $medium;
    margin: 0.75rem 0 0 0;

    dt {
      color: $mem-content-muted;
      font-size: 0.85rem;
    }

    dd {
      margin: 0;
      font-size: 1.25rem;
      font-weight: 700;
      font-variant-numeric: tabular-nums;
    }
  }
}
</style>
