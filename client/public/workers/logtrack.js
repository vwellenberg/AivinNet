onmessage = (e) => {
  const { trackhash, duration, source, timestamp, deviceId } = e.data;

  const is_dev = location.port === "5173";
  const protocol = location.protocol.replace(':', '');
  const base_url = is_dev ? `${protocol}://${location.hostname}:1980` : location.origin;
  const url = base_url + "/logger/track/log";

  fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    // #541: the device that played it (its registry id). Omitted when unknown.
    body: JSON.stringify({ trackhash, duration, source, timestamp, device_id: deviceId }),
    credentials: "include"
  })
    .then((res) => (res.ok ? res.json() : null))
    // Only a milestone play (#545) is passed on: the page celebrates it. The
    // rest of the answer is not used.
    .then((body) => {
      if (body && body.milestone) postMessage(body.milestone);
    })
    .catch(() => {})
    // A dedicated worker lives until it closes itself or the page goes away.
    // One is started per play, so a long session piled up hundreds of idle
    // worker threads (measured: 150 plays, ~150 threads that GC never freed).
    .finally(() => self.close());
};
