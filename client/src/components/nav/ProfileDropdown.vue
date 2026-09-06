<template>
    <div class="profiledrop rounded-md pad-sm shadow-lg noSelect">
        <div class="info item">
            <div class="username ellip2">Hi {{ auth.user.firstname || auth.user.username }}</div>
        </div>
        <div class="separator"></div>
        <!-- A scan walks the root dirs and can drop tracks from the library, so
             the backend refuses it for non-admins (AivinNet#105). -->
        <div v-if="auth.is_admin" class="item scan" @click="onScan">
            <div class="label">Quick scan</div>
            <ReloadSvg />
        </div>
        <div class="item" @click="onSettings">
            <div class="label">Settings</div>
            <SettingsSvg />
        </div>
        <div class="separator"></div>
        <div class="item critical logout" @click="onLogout">
            <div class="label">Log out</div>
            <LogoutSvg />
        </div>
    </div>
</template>

<script setup lang="ts">
import useAuth from '@/stores/auth'
import useModal from '@/stores/modal'

import LogoutSvg from '@/assets/icons/logout.svg'
import ReloadSvg from '@/assets/icons/reload.svg'
import SettingsSvg from '@/assets/icons/settings.svg'
import { triggerScan } from '@/requests/settings/rootdirs'

const auth = useAuth()
const modal = useModal()

const emit = defineEmits<{
    (e: 'close'): void
}>()

// Each action closes the dropdown, so it never lingers on top of the
// opened modal (z-index 9999 over the modal's 21) — the cause of the
// settings modal being unclosable on touch devices.
function onScan() {
    triggerScan()
    emit('close')
}

function onSettings() {
    modal.showSettingsModal()
    emit('close')
}

function onLogout() {
    emit('close')
    auth.logout()
}
</script>

<style lang="scss">
.profiledrop {
    position: absolute;

    z-index: 9999;
    top: 2.25rem;
    right: 0;
    width: 10.25rem;
    font-size: 0.95rem;
    font-weight: 400;
    display: flex;
    flex-direction: column;
    @include candy-box($candy-white, $candy-radius);
    // Floating chrome gets the hard offset shadow (the .shadow-lg utility on
    // this element resolves to the same 4px 4px 0 black — this keeps it
    // explicit and lane-independent).
    @include candy-shadow(4px, 4px);

    .separator {
        height: 1px;
        background-color: $separator;
        padding: 0;
    }

    .item {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: $smaller;
        padding: $small $medium;
        padding-right: $small;
        max-height: 36px;
        border-radius: 8px;
        cursor: pointer;
        transition: background-color 0.2s ease-out, opacity 0.2s ease-out, box-shadow 0.2s ease-out;

        &:hover {
            background-color: $candy-pink-soft;
        }

        &:active {
            opacity: 0.3;
        }

        svg {
            display: block;
            height: 1.5rem;
        }
    }

    .item.scan {
        margin-bottom: $smaller;
    }

    .item.logout svg,
    .scan svg {
        // INFO: Though the icons are 1.5rem, it looks larger than the rest
        // So, we reduce the size a bit.
        height: 1.25rem;
    }

    .logout svg {
        margin-right: 1px;
    }

    .scan svg {
        margin-right: 3px;
    }

    .info {
        gap: $small;
        cursor: auto;
        padding: $smaller $medium;

        &:hover {
            background-color: transparent;
        }

        > .username {
            font-weight: 500;
        }
    }

    .info.item {
        max-height: unset;
        opacity: unset;
        pointer-events: none;
    }

    // Destructive entry: black text, deeper pink hover fill (no red, no ring).
    .critical {
        color: $candy-text;
    }

    .critical:hover {
        background-color: $candy-pink-deep;
    }
}
</style>
