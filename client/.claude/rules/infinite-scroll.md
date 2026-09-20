---
paths:
  - "src/components/ArtistView/AlbumsFetcher.vue"
  - "src/components/shared/GenericTrackPagination.vue"
  - "src/views/AlbumListView/main.vue"
  - "src/views/FolderView.vue"
  - "src/views/SearchView/*.vue"
  - "src/stores/pages/itemlist.ts"
---

# Nachladen am Listenende

## ⚠️ Der Auslöser ist SICHTBARKEIT — nicht das Mounten

`AlbumsFetcher.vue` ist ein **Sentinel**: eine 1-px-Zeile am Listenende, die per
`IntersectionObserver` meldet, dass der Leser in ihre Nähe gekommen ist (400 px Vorlauf). Das war
bis #142 anders und ist die Falle, die dieses Dokument trägt.

Vorher hing das Nachladen an `onMounted` — einer Aussage über die **Komponente**, nicht über den
Leser. Funktioniert hat es nur, weil fünf Wirte ihrem Fetcher-Eintrag `id: Math.random()` gaben:
Der virtuelle Scroller identifiziert Einträge über `id`, also bekam der letzte Eintrag bei **jeder**
Neuberechnung der Liste eine neue Identität und wurde neu gebaut. Das Nachladen hing damit an einem
erzwungenen Remount.

**Beide Hälften waren kaputt, in entgegengesetzte Richtungen** — und keine meldet sich:

- Wirte mit Zufalls-`id` bauten die Komponente dauernd neu (gemessen: ein zügiges Scrollen über
  `/artists` ließ **23** `btn-pop`-Animationen laufen, alle außerhalb des Bildes).
- Wirte, die schon eine **stabile** `id` hatten — der Track-Fetcher der Playlist, „ähnliche Alben“,
  „ähnliche Künstler“ —, mounteten einmal und luden **nie wieder** nach.

⚠️ **Deshalb ist der naheliegende Einzeiler falsch.** `id: Math.random()` gegen einen stabilen
Schlüssel zu tauschen, ohne den Auslöser zu ersetzen, schaltet das Nachladen **still** ab: Die
Liste endet einfach, ohne Fehler, ohne leeren Zustand. Wer hier anfasst, ersetzt **beides**. Der
Zensus dazu steht in `components/__tests__/visibleFetcher.test.ts` und prüft genau diese Kopplung.

## Zwei Dinge, die der Observer selbst können muss

1. **Nach dem Nachladen kann der Sentinel weiter im Bild stehen.** Ein hohes Fenster zeigt mehr
   Zeilen, als eine Seite bringt — und ein Observer feuert **nicht** erneut für einen Zustand, in
   dem er schon ist. Die Liste bliebe stehen, bis der Leser scrollt. `unobserve` + `observe`
   stellt den aktuellen Zustand erneut zu und setzt die Kette von selbst fort.
2. **Diese Kette braucht eine Bremse.** Rendert ein Wirt den Fetcher weiter, während sein Callback
   nichts hinzufügt (Listenende erreicht, Request fehlgeschlagen), dreht die Re-Observe-Schleife.
   Nach `CHAIN_LIMIT` automatischen Läufen hält sie an und schärft sich erst wieder, wenn der
   Sentinel das Bild verlässt und zurückkommt.

⚠️ **Ein Route-Update benutzt dieselbe Instanz weiter** — genau dafür ist `onBeforeRouteUpdate` da.
Das Ketten-Budget der vorherigen Seite läuft also mit hinüber. Aufgebrauchtes Budget plus ein
Sentinel, der das Bild nie verlassen hat, ergibt eine zweite Seite, die nie kommt: zurücksetzen
**und** neu schärfen.

## ⚠️ `useAxios` lehnt nicht ab — es liefert `{ error, data: undefined }`

Die zweitwichtigste Stelle, und sie liegt eine Datei weiter. Ein fehlgeschlagener Request kommt
beim Aufrufer **als erfülltes Promise** an ([requests/useAxios.ts](../../src/requests/useAxios.ts)).
Wer daraus `data.total` liest, wirft einen `TypeError` — und zwar an einer Stelle, an der niemand
mit einem Wurf rechnet.

In `stores/pages/itemlist.ts` lag dieser Wurf **hinter** der Zeile, die `canFetch` wieder
freigibt. Eine einzige Netz-Aussetzer-Anfrage ließ das Flag also für immer auf `false` stehen: Die
Liste lud nie wieder etwas nach, ohne Fehlermeldung, ohne Ladezustand. Daher:

- Freigabe-Flags gehören in ein **`finally`**, nie ans Ende des Erfolgspfads.
- Die Fehlergestalt **explizit** prüfen (`if (res.error || !res.data) return`), statt sie über
  einen Wurf zu entdecken.
- Der Fetcher selbst fängt zusätzlich — ein werfender Callback darf den Auslöser nicht mitnehmen
  (sonst entfällt das Neu-Schärfen oben).

## ⚠️ Über das Ende hinaus zu blättern kostet erst jetzt etwas

Solange der Fetcher bei jeder Neuberechnung neu gebaut wurde, fiel es nicht auf; ein dauerhaft
montierter Sentinel am Listenende macht daraus echte Requests. `getAlbums` bricht deshalb ab,
sobald `total` bekannt und `start >= total` ist. Die Bremse in der Komponente deckelt den Schaden,
die Abfrage im Store beendet ihn — und zwar für **beide** Wirte des Stores (`/albums`, `/artists`).

## Messen, nicht annehmen

Die Ausfälle hier sind allesamt stumm, und eine virtualisierte Liste rendert **konstant viele**
Zeilen — DOM-Knoten zu zählen beweist also nichts. Was wächst, wenn eine Seite hinzukommt, ist die
**Scrollhöhe des Scrollers**. `~/uitest/scrollend.js` scrollt bis zum Stillstand und meldet den
Endstand; gegen den ausgelieferten `master` gegenprüfen, sonst weiß man nur, dass etwas wächst,
nicht ob es weit genug wächst.
