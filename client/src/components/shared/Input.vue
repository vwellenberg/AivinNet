<template>
    <div class="passinput">
        <input
            :id="props.inputId"
            class="passinput"
            :type="type"
            :placeholder="placeholder"
            @input="$emit('input', ($event.target as HTMLInputElement).value)"
            v-model="value"
        />
        <!-- A control, so a button — and it says what it does and which state
             it is in, because an eye glyph alone says neither (#137). -->
        <button
            class="showpass rounded-sm"
            type="button"
            v-if="props.type === 'password'"
            :class="{ show: value.length }"
            :aria-label="showingPassword ? 'Hide password' : 'Show password'"
            :aria-pressed="showingPassword"
            @click="toggleShowPassword"
        >
            <EyeSlashSvg v-if="showingPassword" />
            <EyeSvg v-else />
        </button>
    </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'

import EyeSvg from '@/assets/icons/eye.svg'
import EyeSlashSvg from '@/assets/icons/eye.slash.svg'

const props = defineProps<{
    type?: string
    placeholder?: string
    inputId?: string
}>()

const value = ref('')

defineEmits<{
    (e: 'input', value: string): void
}>()

const type = ref(props.type || 'text')
const showingPassword = ref(false)

function toggleShowPassword() {
    type.value = showingPassword.value ? 'password' : 'text'
    showingPassword.value = !showingPassword.value
}
</script>

<style lang="scss">
.passinput {
    position: relative;

    .showpass {
        // Restated for the <button>.
        background-color: transparent;
        border: none;
        color: inherit;
        padding: 0;
        position: absolute;
        right: $medium;
        top: 50%;
        transform: translateY(-50%);
        display: flex;
        cursor: pointer;
        opacity: 0;

        transition: all 0.2s ease-in-out;
        transition-delay: 0;

        svg {
            width: 1.25rem;
            aspect-ratio: 1;
            color: $candy-text-muted;
        }
    }

    // ⚠️ Hidden until something is typed — and a hidden tab stop is a trap once
    // this is a real button, so keyboard focus shows it too.
    .showpass:focus-visible,
    .showpass.show {
        opacity: 1;
        transition-delay: 1s;
    }

    input {
        width: 100%;
        padding: 0.5rem;
        margin: 0.5rem 0;
        border: $candy-border;
        border-radius: $candy-radius-sm;
        background-color: $candy-pink-soft;
        height: 2.75rem;
        font-size: 1rem;
        padding: 1rem;
        color: $candy-text;

        &:focus {
            outline: solid $focus-ring-w $mem-line;
        }
    }
}
</style>
