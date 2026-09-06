<template>
    <div class="cardscroller" :class="uniformType ? `row-is-${uniformType}` : ``">
        <div class="rinfo">
            <div class="rtitle">
                <b>
                    <RouterLink :to="route || ''">
                        {{ title }}
                    </RouterLink>
                </b>
                <!-- INFO: This SEE ALL is shown when there's no description. Eg. in favorites page -->
                <SeeAll
                    v-if="!description && route && itemlist.length >= maxAbumCards"
                    :route="route"
                    :text="seeAllText"
                />
            </div>
            <div v-if="description" class="rdesc">
                <RouterLink :to="route || ''">
                    {{ description }}
                </RouterLink>
                <!-- INFO: This SEE ALL is shown when there's a description. Eg. in the home page -->
                <SeeAll v-if="route && itemlist.length >= maxAbumCards" :route="route" :text="seeAllText" />
            </div>
        </div>
        <div ref="grid" class="recentitems">
            <component
                :is="getComponent(i.type)"
                v-for="(i, index) in itemlist.slice(0, columns)"
                :key="i"
                class="hlistitem"
                v-bind="getProps(i)"
                @playThis="() => $emit('playThis', index)"
            ></component>
        </div>
    </div>
</template>

<script setup lang="ts">
import { playSources } from '@/enums'
import { maxAbumCards } from '@/stores/content-width'
import useCardGridColumns from '@/helpers/useCardGridColumns'

import { computed, ref } from 'vue'
import PlaylistCard from '../PlaylistsList/PlaylistCard.vue'
import SeeAll from '../shared/SeeAll.vue'
import AlbumCard from './AlbumCard.vue'
import ArtistCard from './ArtistCard.vue'
import CardContent from './CardContent.vue'
import FolderCard from './FolderCard.vue'
import TrackCard from './TrackCard.vue'

const props = defineProps<{
    title: string
    description?: string
    items: {
        type: string
        item?: any
        with_helptext?: boolean
    }[]
    playSource?: playSources
    child_props?: any
    route?: string
    seeAllText?: string
}>()

defineEmits<{
    playThis: [index: number]
}>()

/**
 * The row's type, if it has exactly one — "Top artists this week" is all
 * artists, "Recently played" is a mix.
 *
 * The caption sticker takes the entity colour only in the first case. That
 * keeps one meaning per colour: coral says "artist", never "this row". A mixed
 * row has no single thing to name, so it stays neutral.
 */
const uniformType = computed(() => {
    const types = new Set(props.items.map(i => i.type))
    return types.size === 1 ? [...types][0] : null
})

/**
 * This is a ONE-row scroller: it must render exactly as many cards as the
 * grid below has columns, or the surplus card wraps into a second row. The
 * count therefore comes from the grid's own measured width run through the
 * CSS auto-fill formula (helpers/useCardGridColumns.ts) — never from a
 * heuristic like the old global `maxAbumCards`, which overshot on half-width
 * screens. `maxAbumCards` stays as the SEE ALL threshold.
 */
const grid = ref<HTMLElement | null>(null)
const columns = useCardGridColumns(grid)

const itemlist = computed(() => {
    if (!props.items.length) {
        const items = Array.from(Array(columns.value)).fill({
            type: 'placeholder',
            with_helptext: true,
        })

        return items
    }

    return props.items
})

function getComponent(type: string) {
    if (type == 'placeholder') {
        return CardContent
    }

    switch (type) {
        case 'album':
            return AlbumCard
        case 'track':
            return TrackCard
        case 'artist':
            return ArtistCard
        case 'folder':
            return FolderCard
        case 'playlist':
            return PlaylistCard
    }
}

function getProps(item: { type: string; item?: any; with_helptext?: boolean }) {
    if (item.type == 'placeholder') {
        return {
            with_helptext: item.with_helptext,
        }
    }

    switch (item.type) {
        case 'album':
            return {
                album: item.item,
                ...props.child_props,
            }
        case 'track':
            return {
                track: item.item,
                playSource: props.playSource,
            }
        case 'artist':
            return {
                artist: item.item,
            }
        case 'folder':
            return {
                folder: item.item,
            }
        case 'playlist':
            return {
                playlist: item.item,
            }
    }
}
</script>

<style lang="scss">
.cardscroller {
    // Abstände nach Stufe B der Mockup-Runde: 28px oben und unten ergeben
    // 56px zwischen zwei Zeilen (vorher 48), 32px zwischen zwei Kacheln
    // (vorher 20). Der spürbare Teil ist der Abstand ZWISCHEN den Objekten —
    // innerhalb der Kachel reichen 16px (Global/cards.scss).
    padding: 1.75rem 0;

    .recentitems {
        gap: $card-row-gap $card-col-gap;
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax($cardwidth, 1fr));

        @include mediumPhones {
            grid-template-columns: repeat(auto-fill, minmax(9rem, 1fr));
        }
    }

    // Playlist cards keep their white candy-box here — the old dark design
    // flattened them to transparent inside scroller rows, which let the page
    // ground (indigo in dark) bleed through the card.

    .rinfo {
        // No horizontal padding: the caption sticker shares its left edge with
        // the first tile below (and SEE ALL its right edge with the last one).
        // The old $medium indent left the heading 12px right of the cards —
        // next to the tiles' crisp ink frames that read as misaligned, not as
        // breathing room.
        // 24px von der Überschrift zur ersten Kachel (Stufe B).
        margin-bottom: 1.5rem;

        // The row's caption ("Recently played", "Artist mixes for you") and its
        // "SEE ALL" link are stickers: they sat free on the doodle ground,
        // which is exactly the pairing every plate in this design exists to
        // avoid. The sticker goes on the TEXT, not on the flex row — a bar
        // across the full width would read as a section divider.
        .rtitle {
            font-size: 1.15rem;
            font-weight: 700;
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: $small;

            // A row of exactly one type names that type in colour; a mixed row
            // stays neutral (see `uniformType`). Written on the row root so the
            // caption and its description answer together.
            @each $name, $colour in $mem-entities {
                .cardscroller.row-is-#{$name} & > b {
                    @include mem-entity-tint($name);
                }
            }

            > b {
                @include mem-sticker;
                min-width: 0;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            }

            // No anchor pin here, deliberately. The global rule is
            // `a { color: inherit }` and the sticker above colours the caption,
            // so a pin adds nothing — except weight: at three classes deep it
            // outranked the SEE ALL pill's own hover flip, which left that pill
            // solid ink with invisible ink text (#422's fill, nobody's text).
        }

        .rdesc {
            font-size: 0.9rem;
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: $small;
            margin-top: $smaller;

            > a {
                @include mem-sticker;
                color: $candy-text-muted;
                min-width: 0;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            }
        }
    }

    .to_playlist {
        // Static-white highlight card with ink text — keep light in both themes.
        background-color: $mem-panel-static;
        color: $candy-black;
        border: $candy-border;
        padding: 1.25rem 2rem;
        margin: 1rem;
    }

    .hlistitem {
        // TODO: Handle when there's no time
        // INFO: Set the time to display none by default

        .rhelp .time {
            display: none;
        }

        &:hover {
            // INFO: Set the help text to display none on hover
            .rhelp .help {
                display: none;
            }

            .keep {
                display: block !important;
            }

            // INFO: Set the time to display block on hover
            .rhelp .time {
                display: block;
            }
        }
    }
}
</style>
