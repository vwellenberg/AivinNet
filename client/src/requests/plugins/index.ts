import { paths } from "@/config";
import useAxios from "../useAxios";

export const pluginSetActive = async (plugin: string, active: boolean) => {
  const { data } = await useAxios({
    url: paths.api.plugins + "/setactive",
    props: {
      plugin,
      active,
    },
  });

  return data;
};

/**
 * Hand the Last.fm token from the browser's authorisation round trip to the
 * server, which exchanges it for a session key and stores it.
 *
 * ⚠️ The step BEFORE this one cannot live here: `authorizeLastfmApiKey` asks
 * Last.fm itself for the token, so it never touches our API.
 */
export async function createLastfmSession(token: string) {
  return await useAxios({
    url: paths.api.plugins + "/lastfm/session/create",
    method: "POST",
    props: { token },
  });
}

export async function deleteLastfmSession() {
  return await useAxios({
    url: paths.api.plugins + "/lastfm/session/delete",
    method: "POST",
  });
}

export async function updatePluginSettings(plugin: string, settings: any) {
  const { data } = await useAxios({
    url: paths.api.plugins + "/settings",
    props: {
      plugin,
      settings,
    },
  });

  return data;
}
