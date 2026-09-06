import useFavorites from "@/stores/favorites";
import useTracklist from "@/stores/queue/tracklist";

import { favType } from "../enums";
import { addFavorite, removeFavorite } from "@/requests/favorite";
/**
 * Handles the favorite state of an item.
 * @param setter The ref to track the is_favorite state
 * @param type The type of item
 * @param itemhash The hash of the item
 */
export default async function favoriteHandler(
  flag: boolean | undefined,
  type: favType,
  itemhash: string,
  setter: (x?: unknown) => void,
  remover: (x?: unknown) => void
) {
  if (itemhash == "") return;

  if (flag) {
    const removed = await removeFavorite(type, itemhash);
    if (!removed) return;
    remover();
  } else {
    const added = await addFavorite(type, itemhash);
    if (!added) return;
    setter();
  }

  const is_favorite = !flag;

  // The one write path for favourites, so this is where the answer is published
  // to every OTHER copy of the item — see stores/favorites.ts for why there are
  // several.
  useFavorites().record(type, itemhash, is_favorite);

  if (type === favType.track) {
    // The queue's own copies are written too, rather than left to the registry:
    // the queue is persisted to localStorage and read back on the next load, so
    // a flip that only lived in the (session-only) registry would come back
    // undone. By hash and not by index: this used to write `currentindex` only,
    // and only when the flipped track WAS the current one, so every other copy
    // of it in the queue kept the old flag — and the same track can sit in a
    // queue more than once. Setting the value rather than toggling it also
    // makes the write idempotent, which is what lets the registry above and
    // this line state the same answer without fighting.
    useTracklist().setFav(itemhash, is_favorite);
  }
}
