# SubspaceRadio Roadmap

## Playlists

- [x] Alphabetische Sortierung als Default
- [x] Songs via Drag & Drop in einer Playlist verschieben
- [ ] Alternative Darstellungs-Option (Liste)

## Ordner (Folders)

- [x] Alphabetische Ordner-Sortierung als Default
- [ ] Ordner-Namen in Kacheln besser lesbar machen (werden aktuell stark abgeschnitten)
- [ ] Sortierung rechts oben soll auch für Ordner gelten, nicht nur Songs

## Statistiken

- [ ] Wiedergabestatistiken: was wie oft gespielt wurde (Tracks, Alben, Künstler)

## Album-Cover

- [ ] KI-gestütztes Setzen von Album-Covern (aktuell werden nur Song-Bilder angezeigt)
- [ ] Cover Art Archive / MusicBrainz als Quelle für fehlende Cover

## Metadaten

- [ ] **Manuelle Metadaten-Bearbeitung:** Track-Detail-Panel (Modal/Seitenleiste) mit editierbaren Feldern (Titel, Künstler, Album, Genre, Jahr) — Backend schreibt Tags via `mutagen` direkt in die Audiodatei
- [ ] **Auto-Tag Button:** Album angeben → Track-Namen, Künstler, Genre etc. automatisch von MusicBrainz holen und in die Audiodateien schreiben (via `mutagen`)
- [ ] Automatischer Metadaten-Abgleich aus dem Netz (MusicBrainz + Cover Art Archive)
- [ ] Last.fm ist bereits als Plugin integriert — erweitern für fehlende Infos

## Bugs

- [x] Memory Leaks untersuchen und fixen (PIL Images, Watchdog, TransCodeStore, mutable default arg)
