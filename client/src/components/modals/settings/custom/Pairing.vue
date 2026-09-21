<template>
    <div class="pairing">
        <div
            class="qrcode"
            v-if="state === 'ready'"
        >
            <img
                :src="qrSrc"
                alt="Pairing QR code"
            />
        </div>
        <div
            class="loader"
            v-else-if="state === 'loading'"
        >
            <div class="spinner"></div>
        </div>
        <div
            class="error"
            v-else
        >
            <p>{{ errorMsg }}</p>
        </div>
        <p class="desc">
            Scan the QR code with your phone's camera to open AivinNet and pair the device.
        </p>

        <div class="serverurl rounded">{{ url }}</div>
    </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import QRCodeStyling from 'qr-code-styling'
import { sendPairRequest } from '@/requests/auth'
import { MEMPHIS } from '@/utils/colortools/pageGradient'

// Every outcome lives in the template. The panel used to hand-append its error
// into the QR container, which only exists once the code has loaded — so a
// failed request threw inside onMounted and the spinner never went away.
const state = ref<'loading' | 'ready' | 'error'>('loading')
const qrSrc = ref('')
const errorMsg = ref('')
const url = window.location.origin
let closed = false

async function buildQrCode(code: string) {
    // Deep-link URL: scanning with a phone camera opens the web client, which
    // redeems the code and logs the browser in (see views/PairView.vue).
    // Intentionally replaces the native Swing Music app's "<origin> <code>"
    // payload — pairing targets the AivinNet web client.
    const data = window.location.origin + '/#/pair?code=' + code
    const qrCode = new QRCodeStyling({
        width: 300,
        height: 300,
        type: 'svg',
        data: data,
        image: '/favicon.png',
        dotsOptions: {
            color: MEMPHIS.ink,
            type: 'extra-rounded',
        },
        backgroundOptions: {
            color: 'transparent',
        },
        imageOptions: {
            crossOrigin: 'anonymous',
            margin: 20,
        },
        margin: 20,
    })
    const svgBlob = await qrCode.getRawData('svg')
    if (!svgBlob) throw new Error('QR code rendered empty')
    return svgBlob
}

function fail(msg: string) {
    errorMsg.value = msg
    state.value = 'error'
}

onMounted(async () => {
    const res = await sendPairRequest()

    if (res.status != 200) {
        // useAxios answers a dead connection with `status: undefined`
        const reason = res.status ? 'Error code: ' + res.status : res.error || 'Server not reachable'
        return fail('Error fetching pairing code. ' + reason)
    }

    let svgBlob: Blob
    try {
        svgBlob = await buildQrCode(res.data.code)
    } catch (e) {
        return fail('Could not draw the QR code. ' + ((e as Error)?.message || ''))
    }

    // The modal may have closed while we waited; an object URL made now would leak.
    if (closed) return
    qrSrc.value = URL.createObjectURL(svgBlob)
    state.value = 'ready'
})

onBeforeUnmount(() => {
    closed = true
    if (qrSrc.value) URL.revokeObjectURL(qrSrc.value)
})
</script>

<style lang="scss">
.pairing {
    text-align: center;

    .qrcode,
    .loader,
    .error {
        height: 300px;
    }

    .qrcode {
        height: max-content;
        width: max-content;
        margin: 0 auto;
        padding: $small;
        // The QR has ink dots on a transparent bg — pin the wrapper to a static
        // light box so the code stays scannable on the dark modal in dark mode.
        @include candy-box($mem-panel-static, $candy-radius);
    }

    .loader,
    .error {
        display: grid;
        place-items: center;
    }

    .error p {
        max-width: 20rem;
        color: $candy-text;
    }

    .spinner {
        border-color: transparent;
        border-top-color: $mem-line;
        margin: 0 auto;
    }

    .serverurl {
        width: fit-content;
        margin: 0 auto;
        padding: $smaller $small;
        font-size: 12px;
        font-family: $mono-font;
        color: $candy-text;
        background-color: $candy-pink-soft;
        border: $mem-hairline;
    }
}
</style>
