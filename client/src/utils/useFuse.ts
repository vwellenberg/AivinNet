import Fuse from "fuse.js";
import { computed, shallowRef, toValue, watch, type ComputedRef, type MaybeRefOrGetter } from "vue";

/**
 * Fuzzy search over a list, with Fuse.js.
 *
 * Replaces `useFuse` from `@vueuse/integrations`, the only thing that package
 * provided. Same behaviour for every caller:
 * - an empty search term returns every item, wrapped as `{ item, refIndex }`,
 *   so the shape of the result does not depend on the query;
 * - the index follows the list: a deep change to `data` rebuilds it, and the
 *   results recompute from the new index;
 * - `query` and `data` may be plain values, refs or getters.
 *
 * @param query The query to search for
 * @param data The list to search in
 * @param fuseOptions Fuse.js options (threshold and ignoreLocation are fixed here)
 * @returns A computed ref containing the search results
 */
export default (query: MaybeRefOrGetter<string>, data: MaybeRefOrGetter<any[]>, fuseOptions: object) => {
  const options = { ...fuseOptions, threshold: 0.3, ignoreLocation: true };
  // shallowRef, not a plain variable: Fuse is not reactive, so the computed
  // below needs this ref to see that the index was replaced.
  const fuse = shallowRef(new Fuse<any>(toValue(data) ?? [], options));

  watch(
    () => toValue(data),
    (list) => {
      fuse.value = new Fuse<any>(list ?? [], options);
    },
    { deep: true }
  );

  const results: ComputedRef<Fuse.FuseResult<any>[]> = computed(() => {
    const term = toValue(query);
    if (!term) {
      return (toValue(data) ?? []).map((item: any, index: number) => ({ item, refIndex: index }));
    }
    return fuse.value.search(term);
  });

  return results;
};
