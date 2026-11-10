import Fuse, { type FuseResult } from "fuse.js";
import { computed, toValue, type ComputedRef, type MaybeRefOrGetter } from "vue";

/**
 * Fuzzy search over a list, with Fuse.js.
 *
 * Replaces `useFuse` from `@vueuse/integrations`, the only thing that package
 * provided. Same behaviour for every caller:
 * - an empty search term returns every item, wrapped as `{ item, refIndex }`,
 *   so the shape of the result does not depend on the query;
 * - the results follow the list: a change to `data` recomputes them;
 * - `query` and `data` may be plain values, refs or getters.
 *
 * @param query The query to search for
 * @param data The list to search in
 * @param fuseOptions Fuse.js options (threshold and ignoreLocation are fixed here)
 * @returns A computed ref containing the search results
 */
export default (query: MaybeRefOrGetter<string>, data: MaybeRefOrGetter<any[]>, fuseOptions: object) => {
  const options = { ...fuseOptions, threshold: 0.3, ignoreLocation: true };

  // No watcher: every caller is a Pinia getter that calls this anew on each
  // evaluation, and a deep watch per call (what @vueuse/integrations did)
  // walked the whole track list and was never stopped. The computed tracks
  // what building the index reads, so a ref or getter input stays reactive.
  const results: ComputedRef<FuseResult<any>[]> = computed(() => {
    const list = toValue(data) ?? [];
    const term = toValue(query);
    if (!term) {
      return list.map((item: any, index: number) => ({ item, refIndex: index }));
    }
    return new Fuse<any>(list, options).search(term);
  });

  return results;
};
