<template>
    <div class="loginmodal" v-auto-animate>
        <div class="head" :class="{ selected }">
            <button
                class="back rounded-sm"
                title="Back to selection"
                @click="resetSelected"
                :style="{
                    visibility: shownUsers.length > 1 ? 'visible' : 'hidden',
                }"
            >
                <span>back</span> <ArrowSvg />
            </button>
            <Logo />
            <button class="back back2 rounded-sm" title="Back to selection"><span>back</span> <ArrowSvg /></button>
        </div>

        <div class="alcontent">
            <div class="helptext" v-if="!selected">
                <div class="h2">Welcome back</div>
            </div>
            <div class="selected-user" v-if="selected">
                <User
                    :user="selected.username === '' ? { id: 0, username: username, firstname: '' } : selected"
                    :selected="true"
                />
            </div>

            <div class="userlist" v-auto-animate v-else>
                <User v-for="user in shownUsers" @click="setUser(user)" :user="user" :key="user.id" />
            </div>
            <form class="passinput" v-if="selected" v-auto-animate @submit.prevent="loginUser">
                <!-- Only show username input if there's no user list -->
                <Input
                    placeholder="Enter username"
                    v-if="selected.username === ''"
                    input-id="loginuserinput"
                    @input="(input: string) => username = input"
                />
                <Input
                    type="password"
                    placeholder="Enter password"
                    input-id="loginpassinput"
                    @input="(input: string) => password = input"
                />
                <!-- v-if="username.length && password.length" -->
                <button class="submit btn-pill" :class="{ long: selected.username !== '' }">Login</button>
            </form>
        </div>
        <div v-if="guestAllowed" class="guestlink" @click="() => guestLogin()">
            <span>Or continue as guest </span>
        </div>
    </div>
</template>

<script setup lang="ts">
import { Ref, computed, nextTick, onMounted, ref } from 'vue'

import { UserSimplified } from '@/interfaces'
import { getAllUsers } from '@/requests/auth'
import useAuth from '@/stores/auth'

import ArrowSvg from '../../assets/icons/expand.svg'
import Logo from '../Logo.vue'
import Input from '../shared/Input.vue'
import User from '../shared/LoginUserCard.vue'

const auth = useAuth()

const username = ref('')
const password = ref('')

const users: Ref<UserSimplified[]> = ref([])
const shownUsers = computed(() => users.value.filter(user => user.username !== 'guest'))
const selected = ref<UserSimplified | null>(null)

const guestAllowed = computed(() => users.value.some(user => user.username === 'guest'))

async function setUser(user: UserSimplified) {
    selected.value = user
    username.value = user.username

    // if user has no username, focus on username input
    await nextTick()
    if (user.username === '') {
        document.getElementById('loginuserinput')?.focus()
    } else {
        document.getElementById('loginpassinput')?.focus()
    }

    // await nextTick()
    // loginpass.value?.focus()
}

function resetSelected() {
    selected.value = null
}

async function loginUser() {
    if (!password.value) {
        return
    }

    await auth.login(username.value, password.value)
}

async function guestLogin(username: string = 'guest', password: string = 'guest') {
    await auth.login(username, password)
}

onMounted(async () => {
    let res = await getAllUsers()

    // if there are no users, or only the guest user, set the user to empty user
    if (res.users.length === 0 || (res.users.length == 1 && res.users[0].username === 'guest')) {
        setUser({ id: 0, username: '', firstname: '' })
    }

    // if there's only one user, and it's not the guest user, select them
    if (res.users.filter(user => user.username !== 'guest').length === 1) {
        setTimeout(() => {
            setUser(res.users[0])
        }, 250)
    }

    // remove guest user
    // res.users = res.users

    // finally, set the users
    users.value = res.users
})
</script>

<style lang="scss">
.loginmodal {
    height: 35rem;
    display: grid;
    grid-template-rows: max-content 1fr max-content;

    max-height: calc(100vh - 4rem);

    .alcontent {
        padding-bottom: 2rem;
        overflow: auto;
        overflow-x: hidden;
        scrollbar-gutter: stable;
        -webkit-overflow-scrolling: touch;
    }

    .guestlink {
        padding: 1rem;
        width: fit-content;
        margin: 0 auto;
        color: $gray2;
        display: flex;
        text-decoration: underline;

        & > * {
            cursor: pointer;
        }
    }

    .helptext {
        padding: 0 $small;
        text-align: center;
        margin: 1.5rem 0;
        color: $white;

        .h2 {
            font-size: 2rem;
            font-weight: bold;
            margin-top: 0;
        }
    }

    .head {
        text-align: center;
        border-bottom: solid 1px $separator;
        padding: 1rem;
        user-select: none;

        display: flex;
        justify-content: space-between;
        align-items: center;

        // A labelled text button, so no icon role. The markup reads
        // "back ->"; it used to be rendered as "<- back" by rotating the whole
        // BUTTON 180deg and counter-rotating the label. `row-reverse` says the
        // same thing with one transform instead of two — and leaves the
        // button's own transform free, which matters now that hover/press
        // feedback lives there.
        .back {
            flex-direction: row-reverse;
            gap: $smaller;
            height: 2.25rem;
            padding: 0 $small;
            opacity: 0;

            svg {
                transform: rotate(180deg);
            }
        }

        .back2 {
            // NOTE: This element is used to center the Swing Music logo
            visibility: hidden;
        }
    }

    .head.selected .back {
        opacity: 1;
        transition: all 0.25s;
    }

    .swing-logo {
        width: max-content;
        padding: $small 2rem;
        background: none;
        border: none;
        pointer-events: none;
        // No `svg` rule here: the logo has been a PNG (`.logo-img`) since the
        // pixel planet arrived, so the old `svg { transform: scale(.85) }`
        // matched nothing. Size belongs to the component anyway.
    }

    .selected-user {
        display: grid;
        place-items: center;
        margin-top: 2rem;
    }

    .userlist {
        display: flex;
        flex-wrap: wrap;
        justify-content: center;
        gap: 1rem;
        padding: 1rem 0;
    }

    form {
        width: 60%;
        margin: 0 auto;
        margin-top: 1rem;
        display: grid;
        align-items: center;

        input {
            font-size: 1rem;
            width: 100%;
            height: 3rem;
            padding: 1rem;
            border: $candy-border;
            border-radius: $candy-radius-sm;
            outline: none;
            background-color: $candy-pink-soft;
            color: $candy-text;
            text-align: center;
        }

        .submit {
            width: 7rem;
            border-radius: 4rem;
            margin: 0 auto;
            height: 3rem;
            margin-top: 1rem;
        }

        .submit.long {
            width: 100%;
            border-radius: $small;
        }
    }
}
</style>
