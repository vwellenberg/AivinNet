// The server measures silence in the BACKGROUND and answers at once
// (src/aivinnet/lib/silence.py). `pending: true` means "not measured yet": ask
// again shortly. The request goes out ~30 s before the track ends, and a
// measurement takes a few seconds, so the answer is normally there in time. If
// it is not, the last reply is passed on as it is and the player falls back to
// an ordinary track change.
const RETRY_MS = 2000;
const MAX_TRIES = 12;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

onmessage = async (e) => {
  const { ending_file, starting_file } = e.data;

  const is_dev = location.port === "5173";
  const base_url = is_dev ? "http://localhost:1980" : location.origin;
  const url = base_url + "/file/silence";

  let data = {};

  for (let attempt = 1; attempt <= MAX_TRIES; attempt++) {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ending_file, starting_file }),
      credentials: "include"
    });

    data = await res.json();

    if (!data.pending) break;
    if (attempt < MAX_TRIES) await wait(RETRY_MS);
  }

  postMessage(data);
};
