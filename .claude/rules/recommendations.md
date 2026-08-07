---
paths:
  - "src/swingmusic/plugins/**"
  - "src/swingmusic/lib/recipes/**"
  - "src/swingmusic/crons/**"
  - "src/swingmusic/store/homepage*.py"
  - "src/swingmusic/api/home/**"
---

# Empfehlungen / Mixes — woher die Vorschläge kommen

Alle Personalisierung basiert auf der **lokalen Hörhistorie** (`ScrobbleTable`, pro User) plus
der eigenen Bibliothek. Externe Quellen: der Swing-Music-Cloud-Server (Mixes) und — außerhalb
der Empfehlungen — der ab Werk aktive Lyrics-Finder (Musixmatch, siehe CLAUDE.md
„Empfehlungen / Mixes"-Abschnitt und `plugins/register.py`).

- **Cron `mixes`** (`crons/mixes.py`, alle 12 h): erst `ArtistMixes`, dann `BecauseYouListened`
  (nutzt die Artist-Mix-Ergebnisse).
- **Artist-Mixes** (`plugins/mixes.py` + `lib/recipes/artistmixes.py`): meistgehörte Artists nach
  `playduration` aus vier Zeitfenstern (heute / 2 Tage / 7 Tage / Monat; max. 4/3/4/4 Mixe,
  unbelegte Slots wandern ins nächste Fenster). Pro Artist gehen die **Top-5-Tracks — Titel,
  Artists und Album als Klartext** — per `POST {server}/radio` an `https://smcloud.mungaist.com`.
  Der antwortet mit ähnlichen Track-**Weakhashes** plus ähnlichen Alben und Artists. Gematcht
  wird ausschließlich gegen die **eigene Bibliothek** (bei Weakhash-Duplikaten gewinnt die
  höchste Bitrate), aufgefüllt aus lokalen Tracks der ähnlichen Alben/Artists
  (`fallback_create_artist_mix`), dann `balance_mix`. Qualitäts-Gates: mindestens 15 Tracks und
  mindestens 4 verschiedene Artists, sonst wird der Mix verworfen. `sourcehash` (Top-5-Hashes)
  dedupliziert gegen `MixTable`.
- **„Mixes for you"** = aus den Artist-Mixen abgeleitete Track-Mixe (`get_track_mix`).
  **„Because you listened …"** und **„Artists you might like"** speisen sich aus den im
  Mix-`extra` gespeicherten similar artists/albums der Cloud-Antwort.
- **Top artists week/month, Stats, Recently played** = reine lokale Scrobble-Aggregation
  (`utils/stats.py`, sortiert nach `playduration`). **Recently added** = Library-Timestamps.
  Kein Cloud-Anteil.
- **Last.fm-Plugin** (`plugins/lastfm.py`) ist **nur** Scrobble-Export (optional), keine
  Empfehlungsquelle.

⚠️ **Privacy:** Für Mixes verlassen Track-Metadaten (Titel, Artist, Album) das Haus Richtung
`smcloud.mungaist.com` — sonst nichts. Wer hier eine neue Quelle ergänzt, ändert damit das
Datenschutz-Versprechen und muss es in der CLAUDE.md vermerken.
