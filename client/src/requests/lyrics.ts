import { paths } from "@/config";
import useAxios from "./useAxios";

export async function getLyrics(filepath: string, trackhash: string) {
  const { data } = await useAxios({
    url: paths.api.lyrics,
    props: {
      filepath,
      trackhash,
    },
  });

  return data;
}

export const checkExists = async (filepath: string, trackhash: string) => {
  // No current track: the queue getter hands out `{}`, so both arguments are
  // undefined, axios drops them from the JSON and the server answers 422 for
  // an empty body. There is nothing to check — answer locally.
  if (!filepath || !trackhash) return { exists: false };

  const { data } = await useAxios({
    url: paths.api.lyrics + "/check",
    props: {
      filepath,
      trackhash,
    },
  });

  return data;
};
