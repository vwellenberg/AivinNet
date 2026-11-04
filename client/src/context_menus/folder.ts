import * as icons from "@/icons";
import { ContextSrc } from "@/enums";
import { Option, Playlist } from "@/interfaces";
import { getTracksInPath } from "@/requests/folders";

import useModal from "@/stores/modal";
import useTracklist from "@/stores/queue/tracklist";

import { addFolderToPlaylist } from "@/requests/playlists";
import { toggleFolderPin } from "@/helpers/pinFolder";
import usePinnedFolders from "@/stores/pages/pinnedFolders";
import { getAddToPlaylistOptions } from "./utils";

export default async (path: string) => {
  const modal = useModal();

  // Everything under the folder, recursively — the folder page's track rows
  // keep the plain "Play next" for one song.
  const play_next = <Option>{
    label: "Play folder next",
    action: () => {
      getTracksInPath(path).then((tracks) => {
        const store = useTracklist();
        store.insertAfterCurrent(tracks);
      });
    },
    icon: icons.PlayNextIcon,
  };

  const add_to_queue = <Option>{
    label: "Add folder to queue",
    action: () => {
      getTracksInPath(path).then((tracks) => {
        const store = useTracklist();
        store.addTracks(tracks);
      });
    },
    icon: icons.AddToQueueIcon,
  };

  // Action for each playlist option
  const AddToPlaylistAction = (playlist: Playlist) => {
    addFolderToPlaylist(playlist, path);
  };

  const add_to_playlist = <Option>{
    label: "Add to Playlist",
    children: () =>
      getAddToPlaylistOptions(AddToPlaylistAction, {
        path,
        playlist_name: (() => {
          if (path.endsWith("/")) {
            path = path.slice(0, -1);
          }

          return path.split("/").pop();
        })(),
      }),
    icon: icons.PlusIcon,
  };

  // Same wording as the album menu: the sidebar section is "Library".
  // The sidebar loads the pins, but the phone has no sidebar: without this the
  // menu offered "Pin" for a pinned folder, and the toggle unpinned it.
  const pinned = usePinnedFolders();
  if (!pinned.loaded) await pinned.fetchAll();
  const is_pinned = pinned.isPinned(path);
  const pin = <Option>{
    label: is_pinned ? "Unpin from library" : "Pin to library",
    action: () => toggleFolderPin(path),
    icon: icons.PushPinIcon,
  };

  return [play_next, add_to_queue, add_to_playlist, pin];
};
