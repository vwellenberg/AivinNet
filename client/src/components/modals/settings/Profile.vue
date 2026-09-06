<template>
    <div class="profilesettings">
        <div class="profileavatar">
            <div
                class="avatar-wrap"
                :class="{ editable: !adding_user }"
                @click="!adding_user && fileInput?.click()"
            >
                <Avatar :name="username || auth.user.username" :image="auth.user.image" />
                <span v-if="!adding_user" class="avatar-overlay">Change</span>
            </div>
            <input ref="fileInput" type="file" accept="image/*" hidden @change="onPickImage" />
            <div class="name">
                {{ adding_user ? username : `Hi ${auth.user.username}` }}
            </div>
            <button
                v-if="!adding_user && auth.user.image"
                type="button"
                class="remove-pic"
                @click="onRemoveImage"
            >
                Remove picture
            </button>
            <div class="roles" v-if="!adding_user">
                <span class="role" v-for="role in auth.user.roles" :key="role"> {{ role }}</span>
            </div>
        </div>
        <form class="updateprof" v-auto-animate @submit.prevent="handleSubmit">
            <div class="names">
                <label for="username">Username</label>
                <Input
                    :placeholder="adding_user ? 'username' : auth.user.username"
                    @input="input => (username = input)"
                />
            </div>
            <label for="pswd">{{ adding_user ? 'Create' : 'Change' }} password</label>
            <Input type="password" placeholder="⏺⏺⏺⏺⏺⏺⏺⏺" @input="input => (password = input)" />
            <div class="confirmpassword" v-if="password.length">
                <label for="confirmpswd">Confirm password</label>
                <Input type="password" placeholder="⏺⏺⏺⏺⏺⏺⏺⏺" @input="input => (confirmPassword = input)" />
                <label class="error" v-if="errorText">{{ errorText }}</label>
            </div>
            <button v-if="showSubmit" class="btn-pill">
                {{ adding_user ? 'Add user' : 'Update' }}
            </button>
        </form>
    </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import Avatar from '@/components/shared/Avatar.vue'
import Input from '@/components/shared/Input.vue'
import { User } from '@/interfaces'
import useAuth from '@/stores/auth'

const props = defineProps<{
    adding_user?: boolean
}>()

const emit = defineEmits<{
    (e: 'userAdded', value: User): void
}>()

const auth = useAuth()

const username = ref('')
const password = ref('')
const confirmPassword = ref('')

const fileInput = ref<HTMLInputElement | null>(null)

async function onPickImage(e: Event) {
    const file = (e.target as HTMLInputElement).files?.[0]
    if (!file) return

    if (!file.type.startsWith('image/')) {
        auth.showError('Please choose an image file')
        return
    }

    await auth.uploadAvatar(file)

    // reset so picking the same file again still fires @change
    if (fileInput.value) {
        fileInput.value.value = ''
    }
}

async function onRemoveImage() {
    await auth.removeAvatar()
}

const showSubmit = computed(() => {
    if (props.adding_user) {
        return username.value.length && password.value.length && confirmPassword.value.length && !errorText.value
    }
    // show submit button if:
    // username has changed
    // password has changed and is confirmed
    return (
        (!confirmPassword.value.length || (confirmPassword.value && !errorText.value)) &&
        (payload.value.username || payload.value.password)
    )
})

const errorText = computed(() => {
    // if password has not changed, no error
    if (!password.value.length) {
        return ''
    }

    if (confirmPassword.value.length && password.value !== confirmPassword.value) {
        return 'Passwords do not match'
    }

    return ''
})

const payload = computed(() => {
    const payload = {
        username: '',
        password: '',
    }

    if (username.value.length && username.value !== auth.user.username) {
        payload['username'] = username.value
    }

    if (password.value.length && password.value === confirmPassword.value) {
        payload['password'] = password.value
    }

    return payload
})

async function handleSubmit() {
    if (props.adding_user) {
        const user = await auth.addNewUser(payload.value)
        if (user) {
            return emit('userAdded', user)
        }

        return
    }

    await updateProfile()
}

async function updateProfile() {
    const success = await auth.updateProfile(payload.value)
    if (success) {
        // clear form
        username.value = ''
        password.value = ''
        confirmPassword.value = ''
    }
}

onMounted(async () => {
    if (props.adding_user) {
        return
    }
    await auth.getLoggedInUser()
})
</script>

<style lang="scss">
.profilesettings {
    .profileavatar {
        display: flex;
        flex-direction: column;
        align-items: center;

        .avatar-wrap {
            position: relative;
            width: 80px;
            height: 80px;
            border-radius: 50%;

            &.editable {
                cursor: pointer;
            }

            .avatar-overlay {
                position: absolute;
                inset: 0;
                display: flex;
                align-items: center;
                justify-content: center;
                border-radius: 50%;
                background-color: $candy-pink-deep;
                color: $candy-black;
                font-size: 0.8rem;
                font-weight: 600;
                opacity: 0;
                transition: opacity 0.15s ease;
            }

            &.editable:hover .avatar-overlay {
                opacity: 1;
            }
        }

        .name {
            font-weight: 500;
            margin-top: 0.5rem;
        }

        .remove-pic {
            margin-top: 0.5rem;
            background: transparent;
            color: $gray1;
            font-size: 0.85rem;
            text-decoration: underline;
            cursor: pointer;
        }
    }

    .roles {
        margin-top: $small;
    }

    .updateprof {
        width: 60%;
        margin: 0 auto;
        margin-top: 1rem;

        .names {
            margin-bottom: 1rem;
        }

        .confirmpassword {
            margin-top: 1rem;
        }

        label {
            margin-bottom: 0.5rem;
            font-weight: 500;
            font-size: 0.9rem;
            color: $gray1;
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
                outline: solid 2px $mem-line;
            }
        }

        .error {
            color: $candy-text;
        }

        button {
            padding: $medium 1.5rem;
            margin: 1rem auto;
        }
    }
}
</style>
