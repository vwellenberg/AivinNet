/**
 * AivinNet Rewind as a story image (#558): the browser draws the card from the
 * payload the page already holds. Nothing is sent anywhere; the cover is the
 * server's own thumbnail, read as an image and never uploaded.
 *
 * The layout is rewindStory.ts. This file only paints it.
 */

import brandColors from '@/brand-colors.json'
import { paths } from '@/config'

import type { RewindPayload } from './rewind'
import {
    type Measure,
    type Role,
    type StoryItem,
    STORY_HEIGHT,
    STORY_WIDTH,
    layoutStory,
    storyFacts,
} from './rewindStory'

/** Used only where the stylesheet is absent (no CSS loaded): the Memphis literals. */
const FALLBACK: Record<Role, string> = {
    ink: brandColors.memphis.ink,
    paper: brandColors.memphis.paper,
    lavender: brandColors.memphis.lavender,
    yellow: brandColors.memphis.yellow,
}

/** A cover that takes longer than this is drawn without; the card waits for no image. */
const COVER_TIMEOUT_MS = 4000

/**
 * The card's colours, read from the live palette (`--mem-<role>` on `<html>`)
 * so that a colour scheme recolours the card. `var()` does not resolve in a
 * canvas, so the values are read, not referenced.
 */
export function readPalette(style: Pick<CSSStyleDeclaration, 'getPropertyValue'>): Record<Role, string> {
    const read = (role: Role) => style.getPropertyValue(`--mem-${role}`).trim() || FALLBACK[role]
    return { ink: read('ink'), paper: read('paper'), lavender: read('lavender'), yellow: read('yellow') }
}

/** The app font's family list, from the body: the font switch sets it there. */
function readFamily(): string {
    return getComputedStyle(document.body).getPropertyValue('--app-font').trim() || 'sans-serif'
}

/**
 * The server's artist thumbnail, or null when it does not load in time. A
 * CORS-enabled request keeps the canvas untainted (same origin in production,
 * where the request is a plain same-origin one).
 */
export function loadCover(src: string, timeoutMs = COVER_TIMEOUT_MS): Promise<HTMLImageElement | null> {
    return new Promise(resolve => {
        const img = new Image()
        let timer: ReturnType<typeof setTimeout> | undefined
        const done = (result: HTMLImageElement | null) => {
            clearTimeout(timer)
            resolve(result)
        }
        timer = setTimeout(() => done(null), timeoutMs)
        img.crossOrigin = 'anonymous'
        img.onload = () => done(img)
        img.onerror = () => done(null)
        img.src = src
    })
}

function measurer(ctx: CanvasRenderingContext2D): Measure {
    return (text, font) => {
        ctx.font = font
        return ctx.measureText(text).width
    }
}

function paint(ctx: CanvasRenderingContext2D, item: StoryItem, palette: Record<Role, string>, cover: HTMLImageElement | null) {
    if (item.kind === 'band') {
        ctx.fillStyle = palette[item.role]
        ctx.fillRect(0, item.y, STORY_WIDTH, item.height)
    } else if (item.kind === 'text') {
        ctx.font = item.font
        ctx.fillStyle = palette[item.role]
        ctx.fillText(item.text, item.x, item.y)
    } else if (cover && cover.naturalWidth > 0) {
        // Square, centred crop: the thumbnail's own proportions are no card's concern.
        const side = Math.min(cover.naturalWidth, cover.naturalHeight)
        const sx = (cover.naturalWidth - side) / 2
        const sy = (cover.naturalHeight - side) / 2
        ctx.drawImage(cover, sx, sy, side, side, item.x, item.y, item.size, item.size)
    }
}

/** The story card as a PNG. Rejects only when the canvas cannot be drawn or encoded. */
export async function renderStory(data: RewindPayload): Promise<Blob> {
    // The card's text is measured and drawn in the app font; wait for it first.
    await document.fonts?.ready

    const palette = readPalette(getComputedStyle(document.documentElement))
    const family = readFamily()
    const artist = data.top_artists[0]
    const cover = artist?.image ? await loadCover(paths.images.artist.medium + artist.image) : null

    const canvas = document.createElement('canvas')
    canvas.width = STORY_WIDTH
    canvas.height = STORY_HEIGHT
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('2D canvas is not available')

    ctx.textBaseline = 'alphabetic'
    ctx.textAlign = 'left'
    const layout = layoutStory(storyFacts(data, cover !== null), family, measurer(ctx))
    for (const item of layout.items) paint(ctx, item, palette, cover)

    return new Promise((resolve, reject) =>
        canvas.toBlob(blob => (blob ? resolve(blob) : reject(new Error('PNG encoding failed'))), 'image/png')
    )
}

/** Saves the PNG under `name`: a link with a download name, clicked once. */
export function saveBlob(blob: Blob, name: string): void {
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = name
    document.body.appendChild(link)
    link.click()
    link.remove()
    // The download has started by the time a click returns; the URL can go.
    setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

/** Whether this browser can share a PNG file (mobile share sheets do, desktop mostly not). */
export function canShareImage(): boolean {
    try {
        const probe = new File(['x'], 'probe.png', { type: 'image/png' })
        return typeof navigator.share === 'function' && typeof navigator.canShare === 'function' && navigator.canShare({ files: [probe] })
    } catch {
        return false
    }
}

/** Hands the PNG to the system share sheet. A cancelled share rejects with AbortError. */
export function shareImage(blob: Blob, name: string, title: string): Promise<void> {
    const file = new File([blob], name, { type: 'image/png' })
    return navigator.share({ files: [file], title })
}
