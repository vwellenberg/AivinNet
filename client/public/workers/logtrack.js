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
    // Only a play the server took is passed on (the page updates Home's
    // "Almost complete" card), with its milestone (#545) if it was one, and its
    // id: the page extends the play's length later (/track/log/extend).
    .then((body) => {
      if (body) postMessage({ logged: true, milestone: body.milestone || null, id: body.id ?? null });
    })
    .catch(() => {})
    // A dedicated worker lives until it closes itself or the page goes away.
    // One is started per play, so a long session piled up hundreds of idle
    // worker threads (measured: 150 plays, ~150 threads that GC never freed).
    .finally(() => self.close());
};
