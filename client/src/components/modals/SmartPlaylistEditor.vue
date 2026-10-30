<template>
  <!-- Create and edit share this form. The rules are rows of three controls
       whose shape follows the field and the operator (utils/smartPlaylistRules):
       a field picks the operators, an operator picks the value input. -->
  <form class="smart-editor" novalidate @submit.prevent="save">
    <label class="se-label" for="smart-name">Name</label>
    <input
      id="smart-name"
      v-model="name"
      name="name"
      type="text"
      class="se-input"
      placeholder="e.g. Jazz from the 90s"
      spellcheck="false"
    />

    <label class="se-label" for="smart-match">Tracks must match</label>
    <select id="smart-match" v-model="match" name="match" class="se-input">
      <option value="all">All of the rules</option>
      <option value="any">Any of the rules</option>
    </select>

    <div class="se-rules">
      <div v-for="(row, i) in rows" :key="row.key" class="se-rule">
        <select
          :name="`rule-${i + 1}-field`"
          :aria-label="`Rule ${i + 1}: field`"
          class="se-input"
          :value="row.draft.field"
          @change="setField(row, $event)"
        >
          <option v-for="f in FIELDS" :key="f" :value="f">{{ FIELD_LABELS[f] }}</option>
        </select>

        <select
          :name="`rule-${i + 1}-op`"
          :aria-label="`Rule ${i + 1}: operator`"
          class="se-input"
          :value="row.draft.op"
          @change="setOp(row, $event)"
        >
          <option v-for="op in OPS_BY_FIELD[row.draft.field]" :key="op" :value="op">{{ OP_LABELS[op] }}</option>
        </select>

        <template v-if="valueKind(row.draft.field, row.draft.op) === 'text'">
          <input
            v-model="row.draft.value"
            :name="`rule-${i + 1}-value`"
            :aria-label="`Rule ${i + 1}: text`"
            type="text"
            class="se-input se-value"
            placeholder="Text"
            spellcheck="false"
          />
        </template>

        <template v-else-if="valueKind(row.draft.field, row.draft.op) === 'number'">
          <input
            v-model="row.draft.value"
            :name="`rule-${i + 1}-value`"
            :aria-label="`Rule ${i + 1}: number`"
            type="number"
            min="0"
            inputmode="numeric"
            class="se-input se-value"
          />
        </template>

        <template v-else-if="valueKind(row.draft.field, row.draft.op) === 'days'">
          <input
            v-model="row.draft.value"
            :name="`rule-${i + 1}-value`"
            :aria-label="`Rule ${i + 1}: days`"
            type="number"
            min="1"
            inputmode="numeric"
            placeholder="Days"
            class="se-input se-value"
          />
        </template>

        <template v-else-if="valueKind(row.draft.field, row.draft.op) === 'range'">
          <div class="se-range">
            <input
              v-model="row.draft.value"
              :name="`rule-${i + 1}-value`"
              :aria-label="`Rule ${i + 1}: from`"
              type="number"
              min="0"
              inputmode="numeric"
              placeholder="From"
              class="se-input"
            />
            <input
              v-model="row.draft.high"
              :name="`rule-${i + 1}-high`"
              :aria-label="`Rule ${i + 1}: to`"
              type="number"
              min="0"
              inputmode="numeric"
              placeholder="To"
              class="se-input"
            />
          </div>
        </template>

        <template v-else-if="valueKind(row.draft.field, row.draft.op) === 'flag'">
          <select
            v-model="row.draft.value"
            :name="`rule-${i + 1}-value`"
            :aria-label="`Rule ${i + 1}: yes or no`"
            class="se-input se-value"
          >
            <option value="true">Yes</option>
            <option value="false">No</option>
          </select>
        </template>

        <p v-else class="se-none">No value needed</p>

        <button
          type="button"
          class="se-remove"
          :aria-label="`Remove rule ${i + 1}`"
          :disabled="rows.length === 1"
          @click="removeRow(i)"
        >
          <span class="icon" v-html="DeleteIcon"></span>
        </button>
      </div>
    </div>

    <button type="button" class="btn-pill se-add" @click="addRow">Add rule</button>

    <label class="se-label" for="smart-limit">Most tracks</label>
    <input
      id="smart-limit"
      v-model="limit"
      name="limit"
      type="number"
      :min="1"
      :max="MAX_LIMIT"
      inputmode="numeric"
      class="se-input"
    />

    <label class="se-label" for="smart-sort">Sort by</label>
    <div class="se-sort">
      <select id="smart-sort" v-model="sort.field" name="sort-field" class="se-input">
        <option :value="SORT_RANDOM">Random</option>
        <option v-for="f in FIELDS" :key="f" :value="f">{{ FIELD_LABELS[f] }}</option>
      </select>
      <select v-if="sort.field !== SORT_RANDOM" v-model="sort.order" name="sort-order" class="se-input">
        <option value="desc">Descending</option>
        <option value="asc">Ascending</option>
      </select>
    </div>

    <p v-if="preview" class="se-preview">{{ preview }}</p>
    <p v-if="error" class="se-error" role="alert">{{ error }}</p>

    <div class="se-submit">
      <button type="submit" class="btn-pill" :disabled="busy">{{ props.playlist ? 'Save rules' : 'Create' }}</button>
    </div>
  </form>
</template>

<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'

import { SmartPlaylist } from '@/interfaces'
import { DeleteIcon } from '@/icons'
import { createSmartPlaylist, updateSmartPlaylist } from '@/requests/smartPlaylists'
import useSmartPlaylistsStore from '@/stores/pages/smartPlaylists'
import useSmartPlaylistPageStore from '@/stores/pages/smartPlaylist'
import {
    bodyFromForm,
    changeField,
    emptyForm,
    FIELD_LABELS,
    FIELDS,
    formFromPlaylist,
    MAX_LIMIT,
    newDraft,
    OP_LABELS,
    OPS_BY_FIELD,
    RuleDraft,
    SmartField,
    SmartOp,
    SmartPlaylistForm,
    SORT_RANDOM,
    SortDraft,
    summarize,
    valueKind,
} from '@/utils/smartPlaylistRules'

const props = defineProps<{
    /** The playlist to edit. Without it the editor creates a new one. */
    playlist?: SmartPlaylist
}>()

const emit = defineEmits<{
    (e: 'setTitle', title: string): void
    (e: 'hideModal'): void
}>()

const router = useRouter()

emit('setTitle', props.playlist ? 'Edit smart playlist' : 'New smart playlist')

// Each row carries a key of its own, so removing one does not re-use the
// input of the row after it.
let nextKey = 0
const start = props.playlist ? formFromPlaylist(props.playlist) : emptyForm()

const name = ref(start.name)
const match = ref(start.match)
const limit = ref(start.limit)
const sort = reactive<SortDraft>({ ...start.sort })
const rows = ref(start.rules.map(draft => ({ key: nextKey++, draft: reactive<RuleDraft>({ ...draft }) })))

const error = ref('')
const busy = ref(false)

function currentForm(): SmartPlaylistForm {
    return {
        name: name.value,
        match: match.value,
        rules: rows.value.map(row => row.draft),
        limit: limit.value,
        sort: { ...sort },
    }
}

/** What the rules will read as, while they are valid. Empty while they are not. */
const preview = computed(() => {
    const result = bodyFromForm(currentForm())
    return 'body' in result ? summarize(result.body) : ''
})

function addRow() {
    rows.value.push({ key: nextKey++, draft: reactive(newDraft()) })
}

function removeRow(index: number) {
    if (rows.value.length > 1) rows.value.splice(index, 1)
}

function setField(row: { draft: RuleDraft }, event: Event) {
    const field = (event.target as HTMLSelectElement).value as SmartField
    // A new field starts its value over: a text does not become a number.
    row.draft = reactive(changeField(row.draft, field))
}

function setOp(row: { draft: RuleDraft }, event: Event) {
    row.draft.op = (event.target as HTMLSelectElement).value as SmartOp
}

async function save() {
    error.value = ''

    // Refused here first, with the rule's own sentence. Only what passes is sent.
    const result = bodyFromForm(currentForm())
    if ('error' in result) {
        error.value = result.error
        return
    }

    busy.value = true
    const saved = props.playlist
        ? await updateSmartPlaylist(props.playlist.id, result.body)
        : await createSmartPlaylist(result.body)
    busy.value = false

    // The server's answer is the text shown: a 400 names the rule it refused.
    if (!saved.ok) {
        error.value = saved.error
        return
    }

    const list = useSmartPlaylistsStore()
    list.upsert(saved.value)

    // The page showing these rules now holds the old tracks: reload them.
    const page = useSmartPlaylistPageStore()
    if (props.playlist && page.info.id === saved.value.id) void page.fetchPage(saved.value.id, true)

    emit('hideModal')

    if (!props.playlist) router.push({ name: 'SmartPlaylistView', params: { smartid: saved.value.id } })
}
</script>

<style lang="scss">
.smart-editor {
  display: grid;
  gap: 0.75rem;
  margin-top: 0.75rem;

  .se-label {
    font-size: 0.9rem;
    font-weight: 500;
    color: $gray1;
  }

  // Every control is a 44px target; the phone keeps them full width.
  .se-input {
    min-height: $bar-control;
    width: 100%;
    min-width: 0;
  }

  .se-rules {
    display: grid;
    gap: 0.75rem;
  }

  .se-rule {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) auto;
    gap: 0.5rem;
    align-items: center;

    // The value takes the row under the two pickers, not a column of its own.
    .se-value,
    .se-range,
    .se-none {
      grid-column: 1 / -1;
    }
  }

  .se-range {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.5rem;
  }

  .se-none {
    margin: 0;
    font-size: 0.85rem;
    color: $gray1;
  }

  .se-remove {
    @include btn-action;
  }

  .se-add {
    justify-self: start;
    min-height: $bar-control;
  }

  .se-sort {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.5rem;
  }

  .se-preview {
    margin: 0;
    font-size: 0.9rem;
    color: $gray1;
  }

  // Alarm text is the theme's ink (paper in the dark): `$red` is static ink, and
  // it would be black on the dark panel. Weight carries the emphasis.
  .se-error {
    margin: 0;
    font-size: 0.9rem;
    font-weight: 700;
    color: $candy-text;
  }

  .se-submit {
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
