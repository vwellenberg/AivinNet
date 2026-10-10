<template>
    <div class="loginuser rounded-sm" :class="{ selected }">
        <Avatar :name="user.username" />
        <div class="username">
            {{ (selected ? `Hi ` : '') + user.username }}
        </div>
    </div>
</template>

<script setup lang="ts">
import { UserSimplified } from '@/interfaces'
import Avatar from '../shared/Avatar.vue'

defineProps<{
    user: UserSimplified
    selected?: boolean
}>()
</script>

<style lang="scss">
.loginuser {
    display: grid;
    text-align: center;
    place-items: center;
    padding: $small;
    gap: $small;
    width: max-content;
    cursor: pointer;
    // The choice is a plate, like the choices in the root-dirs prompt (#424): it
    // used to be a bare grey tint on hover only, the one pressable on the login
    // screen with neither a frame nor a shadow.
    @include mem-row-plate($candy-radius-sm, $hatch: false);

    &:hover {
        @include mem-row-plate-hover($hatch: false);
    }

    &.selected {
        pointer-events: none;
    }

    > .username {
        font-weight: 500;
    }
}
</style>
