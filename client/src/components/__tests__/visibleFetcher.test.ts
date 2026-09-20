import { mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import AlbumsFetcher from "../ArtistView/AlbumsFetcher.vue";

// ---------------------------------------------------------------------------
// WHAT LOADS THE NEXT PAGE (#142).
//
// The fetcher used to load on `onMounted`, which says nothing about whether the
// reader ever got near the end of the list. It worked only because its hosts
// handed the item `id: Math.random()`: the virtual scroller keys items by `id`,
// so every recomputation rebuilt the component and the remount did the paging.
//
// That makes the two halves ONE mechanism, and the failure mode of splitting
// them is silent in both directions — which is why this file tests both:
//
//   - stabilising the ids without changing the trigger would have switched
//     paging off (no remount, no fetch, a list that just ends);
//   - changing the trigger without stabilising the ids would have left the
//     remount storm in place (measured before: one quick scroll over /artists
//     re-ran 23 `btn-pop` animations, all of them off screen).
//
// Neither shows up as an error. The list simply stops, or the app simply does
// more work than it says.
// ---------------------------------------------------------------------------

type Entry = { isIntersecting: boolean };

/** The observers created during one test, in creation order. */
let observers: FakeObserver[] = [];

class FakeObserver {
    callback: (entries: Entry[]) => void;
    observed = 0;
    unobserved = 0;
    disconnected = false;

    constructor(callback: (entries: Entry[]) => void) {
        this.callback = callback;
        observers.push(this);
    }

    observe() {
        this.observed += 1;
    }

    unobserve() {
        this.unobserved += 1;
    }

    disconnect() {
        this.disconnected = true;
    }

    /** What the browser does when the sentinel enters or leaves the viewport. */
    fire(isIntersecting: boolean) {
        this.callback([{ isIntersecting }]);
    }
}

const withObserver = () => {
    // jsdom has no IntersectionObserver at all, so the component's own fallback
    // path would be the one under test unless we install one.
    (globalThis as unknown as { IntersectionObserver: unknown }).IntersectionObserver = FakeObserver;
};

const withoutObserver = () => {
    delete (globalThis as unknown as { IntersectionObserver?: unknown }).IntersectionObserver;
};

/** Lets every queued promise settle — the component awaits its callback. */
const settle = async () => {
    for (let i = 0; i < 4; i += 1) await Promise.resolve();
};

beforeEach(() => {
    observers = [];
});

afterEach(() => {
    withoutObserver();
});

describe("the fetcher loads when it becomes visible", () => {
    it("does not fetch just because it was mounted", async () => {
        withObserver();
        const fetch_callback = vi.fn().mockResolvedValue(undefined);

        mount(AlbumsFetcher, { props: { fetch_callback, outside_route: true } });
        await settle();

        // The old trigger. A remount is not a statement about the reader.
        expect(fetch_callback).not.toHaveBeenCalled();
        expect(observers).toHaveLength(1);
        expect(observers[0].observed).toBe(1);
    });

    it("fetches when the sentinel comes into view", async () => {
        withObserver();
        const fetch_callback = vi.fn().mockResolvedValue(undefined);

        mount(AlbumsFetcher, { props: { fetch_callback, outside_route: true } });
        observers[0].fire(true);
        await settle();

        expect(fetch_callback).toHaveBeenCalledTimes(1);
    });

    it("keeps going while it is still in view, and stops chaining", async () => {
        withObserver();
        const fetch_callback = vi.fn().mockResolvedValue(undefined);

        mount(AlbumsFetcher, { props: { fetch_callback, outside_route: true } });
        const observer = observers[0];

        // A tall window shows more rows than one page brings: the sentinel is
        // still on screen afterwards, and an observer does not re-fire for a
        // state it is already in. Only re-observing re-delivers it — so the
        // browser side of this loop answers a re-observe and nothing else.
        // Firing unprompted would test the test, not the component.
        let delivered = 0;
        for (let i = 0; i < 40; i += 1) {
            if (observer.observed === delivered) break;
            delivered = observer.observed;
            observer.fire(true);
            await settle();
        }

        // It chains, but not forever: a host that keeps rendering the fetcher
        // while its callback adds nothing (end of list, failed request) would
        // otherwise spin. One reader-driven load plus CHAIN_LIMIT automatic
        // ones, and then it waits for the reader again.
        expect(fetch_callback).toHaveBeenCalledTimes(11);
    });

    it("re-arms once the reader scrolls it out of view and back", async () => {
        withObserver();
        const fetch_callback = vi.fn().mockResolvedValue(undefined);

        mount(AlbumsFetcher, { props: { fetch_callback, outside_route: true } });
        const observer = observers[0];

        observer.fire(false);
        await settle();
        expect(fetch_callback).not.toHaveBeenCalled();

        observer.fire(true);
        await settle();
        expect(fetch_callback).toHaveBeenCalledTimes(1);
    });

    it("runs one fetch at a time", async () => {
        withObserver();
        let release: () => void = () => undefined;
        const fetch_callback = vi.fn().mockImplementation(
            () =>
                new Promise<void>(resolve => {
                    release = resolve;
                })
        );

        mount(AlbumsFetcher, { props: { fetch_callback, outside_route: true } });
        const observer = observers[0];

        observer.fire(true);
        observer.fire(true);
        observer.fire(true);
        await settle();

        expect(fetch_callback).toHaveBeenCalledTimes(1);
        release();
    });

    it("keeps the trigger alive when a page fails", async () => {
        withObserver();
        // `useAxios` resolves on failure, so the throw happens one frame deeper
        // in the caller (`data.total` on undefined). Either way it arrives here
        // as a rejected callback.
        const fetch_callback = vi
            .fn()
            .mockRejectedValueOnce(new TypeError("Cannot read properties of undefined"))
            .mockResolvedValue(undefined);

        mount(AlbumsFetcher, { props: { fetch_callback, outside_route: true } });
        const observer = observers[0];

        observer.fire(true);
        await settle();

        // Uncaught, the rejection would have skipped the re-observe below and
        // the list would have stood still with nothing on screen to say why.
        expect(observer.observed).toBe(2);

        observer.fire(true);
        await settle();
        expect(fetch_callback).toHaveBeenCalledTimes(2);
    });

    it("stops observing when it goes away", async () => {
        withObserver();
        const fetch_callback = vi.fn().mockResolvedValue(undefined);

        const wrapper = mount(AlbumsFetcher, { props: { fetch_callback, outside_route: true } });
        wrapper.unmount();

        expect(observers[0].disconnected).toBe(true);
    });

    it("still loads where there is no IntersectionObserver", async () => {
        withoutObserver();
        const fetch_callback = vi.fn().mockResolvedValue(undefined);

        mount(AlbumsFetcher, { props: { fetch_callback, outside_route: true } });
        await settle();

        // An old WebView should get a short list, not an empty one.
        expect(fetch_callback).toHaveBeenCalledTimes(1);
    });
});

// ---------------------------------------------------------------------------
// The other half: the hosts.
// ---------------------------------------------------------------------------

const SOURCES = import.meta.glob("/src/**/*.{vue,ts}", { as: "raw", eager: true }) as Record<string, string>;

describe("the hosts give their fetcher a stable identity", () => {
    it("no item that carries a fetcher is keyed on a random number", () => {
        const offenders: string[] = [];

        for (const [path, source] of Object.entries(SOURCES)) {
            if (!/is_fetcher|AlbumsFetcher/.test(source)) continue;

            // `items.push({ … id: Math.random() … })` — the identity of the
            // entry that renders the fetcher.
            //
            // ⚠️ The end of the entry is found by BALANCING BRACES, not by
            // looking for `});`: three of the five hosts are written without
            // semicolons, so that delimiter never matched and the "entry" ran
            // to the end of the file — passing only because no unrelated
            // random id happened to sit further down.
            for (const block of source.split("items.push({").slice(1)) {
                let depth = 1;
                let end = block.length;
                for (let i = 0; i < block.length; i += 1) {
                    if (block[i] === "{") depth += 1;
                    else if (block[i] === "}") {
                        depth -= 1;
                        if (depth === 0) {
                            end = i;
                            break;
                        }
                    }
                }
                if (/id:\s*Math\.random\(\)/.test(block.slice(0, end))) offenders.push(path);
            }
        }

        expect(offenders).toEqual([]);
    });
});
