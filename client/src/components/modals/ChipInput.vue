<template>
    <div class="chip-input rounded-sm" @click="focusInput">
        <span v-for="(chip, i) in modelValue" :key="chip + i" class="chip">
            {{ chip }}
            <button type="button" class="chip-x" :title="`Remove ${chip}`" @click.stop="removeChip(i)">×</button>
        </span>
        <input
            ref="inputEl"
            v-model="draft"
            type="text"
            class="chip-text"
            :placeholder="modelValue.length ? '' : placeholder"
            spellcheck="false"
            @keydown="onKeydown"
            @blur="commitDraft"
        />
    </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'

const props = withDefaults(
    defineProps<{
        modelValue?: string[]
        placeholder?: string
    }>(),
    { modelValue: () => [] }
)

const emit = defineEmits<{
    (e: 'update:modelValue', value: string[]): void
}>()

const draft = ref('')
const inputEl = ref<HTMLInputElement | null>(null)

function focusInput() {
    inputEl.value?.focus()
}

function commitDraft() {
    const name = draft.value.trim()
    draft.value = ''
    if (!name || props.modelValue.includes(name)) return
    emit('update:modelValue', [...props.modelValue, name])
}

function removeChip(index: number) {
    emit(
        'update:modelValue',
        props.modelValue.filter((_, i) => i !== index)
    )
}

// One handler: multiple `@keydown.<modifier>` bindings would all collide on the
// single `onKeydown` prop, so we dispatch by key here.
function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' || e.key === ',') {
        e.preventDefault()
        commitDraft()
    } else if (e.key === 'Backspace' && draft.value === '' && props.modelValue.length) {
        removeChip(props.modelValue.length - 1)
    }
}
</script>

<style lang="scss" scoped>
.chip-input {
    display: flex;
    flex-wrap: wrap;
    gap: $smaller;
    align-items: center;
    background-color: $candy-pink-soft;
    border: $candy-border;
    padding: $smaller $small;
    min-height: 2.75rem;
    cursor: text;

    .chip {
        display: inline-flex;
        align-items: center;
        gap: $smaller;
        background-color: $candy-lavender;
        // Lavender accent chip → static ink label + paper outline.
        color: $mem-ink;
        border: 1px solid $mem-line;
        border-radius: $smaller;
        padding: 0.15rem 0.5rem;
        font-size: 0.85rem;
        white-space: nowrap;

        .chip-x {
            border: none;
            background: none;
            // Static dark-muted so the × stays visible on the lavender chip in
            // dark (the theme var would go light on this light fill).
            color: $mem-text-muted-static;
            cursor: pointer;
            padding: 0;
            font-size: 1.1rem;
            line-height: 1;

            &:hover {
                color: $candy-black;
            }
        }
    }

    .chip-text {
        flex: 1;
        min-width: 6rem;
        border: none;
        background: none;
        outline: none;
        color: $candy-text;
        font-size: 14px;
        height: 1.75rem;
    }
}
</style>
