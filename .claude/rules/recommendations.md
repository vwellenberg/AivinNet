---
paths:
  - "src/aivinnet/plugins/**"
  - "src/aivinnet/lib/recipes/**"
  - "src/aivinnet/lib/home/**"
  - "src/aivinnet/crons/**"
  - "src/aivinnet/store/homepage*.py"
  - "src/aivinnet/api/home/**"
---

# Empfehlungen / Home — woher die Vorschläge kommen

⚠️ **Ein eigenes Empfehlungssystem gibt es (noch) nicht.** Es gibt keine Ähnlichkeit zwischen
Tracks, Alben oder Künstlern, die aus der eigenen Hörhistorie berechnet würde. Der Neuanfang ist
Issue **#138**; dort stehen auch die Fallen der Vorgängerrunde. Erst lesen, dann bauen.

Alles, was Home heute zeigt, ist **lokale Aggregation** der Hörhistorie (`ScrobbleTable`, pro
User) plus der eigenen Bibliothek. Kein Cloud-Anteil.

## Was es gab: Mixes (entfernt)

Die Mixes hingen an `smcloud.mungaist.com` (Swing-Music-Cloud). Ihre Startseiten-Zeilen
„Mixes for you“, „Because you listened …“ und „Artists you might like“ wurden aus den
Ähnlichkeitslisten gerendert, die in jedem Mix gespeichert waren. Der Dienst antwortete ab
31.05.2026 durchgehend mit **HTTP 502**. Daraufhin wurde das Feature komplett entfernt: Plugin,
Cron, Routen und Modell (#76/#77). `migrations/drop_mixes.py` löscht beim Start die Tabelle `mix`
und leert die `mix:`-Quellen der Scrobbles. Die Scrobbles selbst bleiben, denn das sind echte
Plays.

**Lehre daraus, Kriterium für #138:** Kein externer Dienst darf die einzige Quelle einer Zeile
sein. Die Zeilen liefen noch Wochen nach dem Tod des Dienstes, weil sie vom Zwischenspeicher
lebten, und niemand bemerkte den Ausfall.

## Was Home heute zeigt

Die Crons stehen in `crons/__init__.py` und laufen in einer `schedule`-Schleife, jeder Job hinter
`_guarded`.

- **„Continue listening“** (`lib/recipes/continuelistening.py`): bis zu drei Karten. Das sind die
  zuletzt gehörten, nicht beendeten Alben bzw. Playlists aus den neuesten 200 Scrobbles mit
  `al:`/`pl:`-Quelle. Gefüllt wird beim Start, danach nach jeder Wiedergabe neu.
- **„Rediscover“**: Alben mit ≥ 5 Plays insgesamt und keinem in den letzten 60 Tagen, täglich.
  Dazu der Button „Surprise me“ (`GET /nothome/surprise`, zufälliges Album, RAM).
- **„On this day“**: Scrobbles desselben Kalendertags vor einem Jahr, in der Zeitzone des
  Servers, stündlich.
- **Recently played** (lokale Scrobble-Aggregation, neu nach jedem Scrobble) und **Recently
  added** (Library-Timestamps, neu nach jedem Scan in `lib/index.py`): beide auch beim Start
  gefüllt.

Die Regeln und Schwellen stehen in `lib/home/homerows.py`, absichtlich ohne DB- und
Store-Imports, damit sie in der schnellen Testbahn testbar bleiben. Die Routinen dazu liegen in
`lib/recipes/homerows.py`. Die Reihen „Top artists this week/month“ sind von Home entfernt, die
Stats-Seite hat eigene Charts (`utils/stats.py`, sortiert nach `playduration`).

**Ähnliche Künstler auf Artist- und Album-Seiten** kommen aus `notlastfm_similar_artists`
(`SimilarArtistTable`), gefüllt von Last.fm, aber **nur** mit `enableOnlineMetadata` (ab Werk
aus). Auf Home erscheinen sie nicht.

Das **Last.fm-Plugin** (`plugins/lastfm.py`) ist **nur** Scrobble-Export (optional), keine
Empfehlungsquelle.

⚠️ **Privacy:** Wer eine neue externe Quelle für Empfehlungen ergänzt, ändert damit das
Datenschutz-Versprechen. Die Quelle gehört dann unten in die Tabelle und in die CLAUDE.md
(Abschnitt „Empfehlungen / Home“). Muster für den Weg nach draußen: Host-Allowlist
(`ALLOWED_HOST_SUFFIXES` in `lib/coverart.py`), harte Deadline, nur im Cron, nie im Request-Pfad.

## Ausgehende Verbindungen im Überblick

Damit „sonst nichts“ nachprüfbar bleibt, steht hier die vollständige Liste. In diese Tabelle
wird jede neue Quelle eingetragen:

| Wohin | Was | Wann |
|---|---|---|
| `apic-desktop.musixmatch.com` | Titel + Artist im Klartext | Lyrics-Seite ohne lokale Lyrics (Neuinstallation: aus; Settings → Plugins) |
| `musicbrainz.org` / `coverartarchive.org` | Albumtitel + Album-Artist im Klartext | **nur auf Anforderung**: Cover holen, und seit #221 Titel/Nummern holen |
| Deezer / Last.fm | Artist-Namen | nur mit `enableOnlineMetadata` (ab Werk **aus**) |

`smcloud.mungaist.com` steht seit dem Rückbau der Mixes nicht mehr in dieser Liste. Im Code gibt
es keinen Aufruf mehr dorthin.

⚠️ **Die Dateinamen-Quelle des Metadaten-Dialogs (`source: "filenames"`) geht NIRGENDWOHIN.** Sie
liest die Pfade der eigenen Bibliothek und rechnet lokal. Deshalb ist sie auch die Antwort für
Alben, die man aus Datenschutzgründen nicht nachschlagen möchte. Wer die beiden Quellen in der UI
zusammenlegt, nimmt dem Nutzer genau diese Wahl.
