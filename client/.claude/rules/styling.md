---
paths:
  - "src/assets/scss/**"
  - "src/**/*.scss"
  - "src/**/*.vue"
  - "vite.config.ts"
---

# Styling — Rollen, Schatten, Icons, Bewegung

Aussehen gehört in eine **Rolle**, nicht in die Komponente. Die fünf Rollen stehen in
[Global/_buttons.scss](../../src/assets/scss/Global/_buttons.scss): `btn-primary` · `btn-action` ·
`btn-quiet` · `btn-pill` · `btn-toggle-on`. Ein Button, der von Hand
`background: transparent; border: none; padding: 0` schreibt, ist fast immer ein übersehener Fall.

Wiederkehrendes UI-Element ⇒ geteilte Komponente (`src/components/shared/`) **oder** Rolle,
nicht pro View kopieren.

## ⚠️ Icons nie über `fill` einfärben — immer über `color`

Der Transport-/Chrome-Satz (play, pause, next, shuffle, repeat, repeat-one, lyrics, volume-*) ist
ein einheitlicher **24×24-Satz in `currentColor`**: gefüllte Körper, wo die Form geschlossen ist,
**2,4px-Strokes**, wo sie offen ist. Eine `svg path { fill: … }`-Regel **flutet die gestrichenen
Glyphen zu schwarzen Klecksen**. Deshalb liegt die Farbe überall auf `color`.

Die eine verbliebene Pauschal-Regel (Kontextmenü-Icons mit Legacy-Glyphen) überspringt Pfade mit
Stroke: `svg path:not([stroke])`. Neue Icons daher **immer** mit `stroke="currentColor"` auf
**jedem** `<path>` zeichnen, nicht auf einer `<g>` — sonst greift dieser Schutz nicht.

Größen mit `width`/`height` setzen, **nicht** mit `transform: scale()`: beim Skalieren hängt die
optische Größe am Füllgrad der jeweiligen viewBox (daher kam „Lyrics-Icon zu groß").

## Der Chrome-Satz: ein Raster, keine Kompensation (#311)

Seit #311 sind die Navigations- und Chrome-Glyphen (home, search, folder\*, bookmark\*, playlist\*,
chart, settings, album, artist, delete, plus, queue, more, expand, arrow\*, volume-\*, pin\*,
download, pencil, reload, devices, headphones, a, square, check.filled, check.circle.fill,
heart\*, note, sowie seit der Settings-Runde paintbrush, phone, info, users, cover, backup)
**ein** Satz:

- **24×24-Box, ~18 px optisches Glyph** (Ink von 3 bis 21), **2,4 px** Strich, runde Kappen und
  Ecken. 2 px war der erste Wurf und las sich neben den 3-px-Rahmen und der fetten Schrift dieses
  Designs zu dünn.
- `stroke="currentColor"` auf **jedem** `<path>` (siehe die Regel darüber).
- Füllung nur, wo die Form geschlossen ist (`*.fill`-Varianten, Notenkopf, Lautsprecher).

**Wer ein Icon ersetzt, zeichnet es auf dieses Raster** — sonst kommt die Kompensations-Mechanik
zurück, die #311 abgeräumt hat: `NavButtons.vue` trug sechs `--nav-k * (viewBoxSeite / Ink-Höhe)`-
Faktoren und `navitems.ts` ein `iconClass`-Feld, nur weil drei Fremdsätze ihre Box unterschiedlich
stark füllten (Bookmark ~92 %, Home/Ordner/Suche ~60–67 %, Chart ~79 %). Ein Satz = eine Größe.

Zwei Fallen beim Ersetzen eines Legacy-Glyphs:

- **Eine `fill`-Regel, die genau dieses Icon reparierte, wird zur Waffe.** Der Untermenü-Chevron
  hatte `svg path { fill: currentColor }`, weil `expand.svg` `#F2F2F2` hartcodierte — auf dem neuen,
  gestrichenen Chevron hätte dieselbe Regel einen schwarzen Keil ergeben. Beim Neuzeichnen also
  **nach der Kompensation suchen und sie mit entfernen**.
- **Ein Glyph kann anderswo als roher Pfad einkopiert sein.** `FolderCard.vue` trug eine private
  Kopie von `folder-1.svg` im Template, die keine Icon-Änderung je erreicht hätte.

## ⚠️ Ein Akzent auf einer gefüllten Zeile ist eine Messung, keine Wahl

Die laufende Track-Zeile ist `$mem-yellow` (`.songlist-item.current`, dazu
`.track-item.currentInQueue`). Alles, was **auf** ihr sitzt, misst gegen diese Fläche — und die
Brandfarben verlieren dort:

| auf `$mem-yellow` | Kontrast |
|---|---|
| `$mem-teal` | **1,24:1** |
| `$mem-coral` | **1,98:1** |
| Ink | 9,64:1 |

WCAG 1.4.11 verlangt **3:1** für grafische Elemente. Teal und Coral sind auf der gelben Zeile also
beide unbrauchbar, obwohl beide auf Panel, Papier und dunklem Grund tragen. Genau deshalb stand am
alten Now-Playing-Glyph ein hartes `fill: $candy-black` — kein Versehen, sondern die einzige
Farbe, die dort funktioniert.

Die Regel daraus: **ein Glyph auf einer gefüllten Zeile nimmt `currentColor`** (die Zeile pinnt
Ink ohnehin, siehe „Filled row states" in `SongItem.vue`), und ein Akzent bekommt eine
**Custom Property mit Fallback**, die der Wirt zurücknehmen kann:

```scss
.peak { fill: var(--meter-peak, #{$mem-coral}); }   // Komponente
.now-playing-meter { --meter-peak: currentColor; }  // gelbe Zeile nimmt ihn zurück
```

So bleibt der Akzent dort, wo er misst (Player-Bar: 3,68:1 auf Weiß, 5,14:1 auf dem dunklen
Grund), ohne dass die Komponente ihre Wirte kennen muss. `PlayingMeter.vue` ist das Vorbild.

**Der zweite Weg: eine Ink-Kontur trägt den Kontrast, die Fläche trägt die Identität.** Ein
Glyph, das eine *geschlossene* Form hat, muss seinen Akzent nicht aufgeben — 1.4.11 verlangt, dass
die **Grenzen** des Elements unterscheidbar sind, nicht dass jede Innenfläche gegen den Wirt misst.
`check.circle.fill.svg` (der Favoriten-Marker) macht genau das: die Scheibe bleibt `currentColor`
und damit teal, aber Kontur und Haken sind **fest** Ink. Auf der gelben Zeile misst die Kante
9,64:1, während die Scheibe darin bei 1,24:1 liegen darf.

Zwei Bedingungen, sonst kippt es:

- **Die Marke darf nicht im selben Farbkanal liegen wie die Fläche.** Wäre der Haken auch
  `currentColor`, würde das Glyph überall dort zu einem massiven Fleck, wo ein Wirt `color: ink`
  pinnt — und das tun mehrere (`SongItem.vue` auf gefüllten Zeilen, die Kopfzeilen-Aktionen).
  Deshalb: Fläche = `currentColor`, Marke = feste Farbe.
- **Die Wirte, die Ink pinnen, meinen den AUS-Zustand.** Ihre Regeln gehören auf
  `:not(.is-fav)` gescopet, sonst entscheidet Spezifität statt Absicht. Real passiert:
  `.float-buttons .heart-button svg` (0,2,1) schlug `.heart-button.is-fav` (0,2,0), also war ein
  favorisierter Queue-Track die ganze Zeit ink statt teal — die beiden Zustände unterschieden sich
  dort nur noch in der Form.

Die feste Farbe wird im **Asset** gesetzt, nicht per CSS-Regel: sie ist eine Eigenschaft der
Zeichnung („diese Kante ist die Kontrastkante"), keine Aussage des Wirts.

**Vorsicht bei der Gegenprobe:** Ein Element-Screenshot der Zeile allein beweist nichts — er
rendert auf weißem Grund und lässt jede Farbe gut aussehen. Gemessen wird der **computed
`fill`/`backgroundColor` im laufenden Browser**, gegeneinander gerechnet.

## ⚠️ Die Songliste ist ein Kassetten-Inlay — und ihr Rahmen hat drei Besitzer

Die Track-Zeile trägt seit dem Inlay-Redesign vier Merkmale: **Farbleitband** auf der
Vorderkante (fünf Akzente im Wechsel), **Track-Nummer im Ink-Kreis**, **Perforation** zwischen den
Zeilen und ein **aufgeklebtes Cover** (voller Ink-Rahmen, Offset-Schatten, leichte Neigung, die
sich unter dem Zeiger geradezieht). Die Dauer sitzt in einer umrandeten Pille.

**Die Farbrotation kommt aus dem Zeilen-Index, niemals aus `:nth-child`.** Alle Songlisten rendern
durch `vue-virtual-scroller`, und der **recycelt** seine Zeilen-Elemente: DOM-Position folgt dort
dem Scroll-Offset, nicht der Liste. Eine `nth-child`-Regel gäbe demselben Track bei jedem Scrollen
eine andere Farbe — im Standbild unauffällig, in Bewegung ein Flackern. Zuständig ist
`trackBandClass()` in `utils/songItemMethods.ts`, die Farben stehen als `$mem-band-colours` in
`_candy.scss` und werden von `mem-band-cycle` zu `band-0`…`band-4` ausgerollt. Beide Hälften sind
aneinander getestet (`utils/__tests__/trackBand.test.ts`): Die Zahl der Klassen, die JS erzeugen
kann, muss der Länge der SCSS-Liste entsprechen — sonst steht eine Zeile still ohne Band da, weil
`--band` einfach auf den Fallback fällt.

⚠️ **Der `index`-Prop ist nicht überall die Listenposition.** Die Album-Ansicht reicht die
Track-Nummer aus den Tags durch, `ArtistView/TopTracks.vue` zählt bei gesetztem `total`
**rückwärts** (`total - index`, gefüttert aus dem API-Count von `Favorites.vue`), und der Typ
erlaubt einen String. Deshalb parst `trackBandClass` defensiv und normalisiert das Vorzeichen:
`band--2` matcht keine Regel, und eine Zeile ohne Band liest sich als Fehler, während eine Zeile
mit der Farbe ihres Nachbarn nur als Wiederholung liest.

**Den Listenrahmen malen drei Stellen, und sie müssen zusammenpassen:**

| Kante | wer |
|---|---|
| links | das Farbleitband (Background-Layer, ersetzt den linken Ink-Streifen) |
| rechts | der Ink-Streifen (Background-Layer) |
| oben | `.is-first` — **oder** die Ink-Kopfleiste der Playlist (`AfterHeader.caps-list`) |
| unten | `.is-last` |

⚠️ **Oben gibt es deshalb zwei mögliche Besitzer, und nur einer darf.** Trägt die Kopfleiste die
Kappe, muss die erste Zeile ihre abgeben — sonst schiebt sich eine gerundete Ecke unter einen
geraden Ink-Balken. `PlaylistView` berechnet das einmal als `captionCapsList` und liest es zweimal
(Kopfleiste **und** `is_first`); die beiden als getrennte Bedingungen zu schreiben ist genau die
Drift, die man erst im Screenshot sieht.

**Die Perforation hängt an der UNTERkante, nicht an der oberen.** Sie gehört *zwischen* zwei
Zeilen, und nur die Unterkante kann das ohne ein zweites Flag sagen: `.is-last` meldet sich selbst,
während „erste Zeile" auf der Playlist-Seite gar nicht existiert (dort kappt die Leiste). Oben
angehängt bräuchte sie eine eigene Aussage „über mir steht schon etwas".

⚠️ **Und weil sie unten hängt, ist sie das Erste, was eine falsche `item-size` frisst.** Ein
`RecycleScroller` **misst nicht** — er stapelt seine Zeilen in exakt `item-size` Abstand, und der
Item-Wrapper ist `overflow: visible` (app-grid.scss). Eine Zeile, die höher ist als das Raster,
malt also über die untersten Pixel ihrer Vorgängerin, ohne dass irgendetwas clippt oder meldet.
Drei Listen führten `64` gegen die 72 px aus `$song-item-height`: 8 px Überlappung, und die
Perforation lag genau darin. Sichtbar blieb sie nur zu **8 %** — so viel Tinte scheint durch die
zu 92 % deckende `--mem-veil`-Platte der nächsten Zeile (gemessen `rgb(226,224,220)` statt
`rgb(23,23,26)`; #553). Schwarz waren nur die Kanten, die niemand überlappt: die Schlusskante der
letzten Zeile und die Ink-Rahmen der gefüllten Zustände — gemeldet wurde das als „manchmal
schwarz, sonst eher so blass".

**Die Zahl hat deshalb eine Quelle:** `SONG_ROW_HEIGHT` (`utils/songItemMethods.ts`), gegen
`$song-item-height` gespiegelt und von `songRowHeight.test.ts` an jeden `RecycleScroller`
gebunden, der `SongItem`s stapelt. `DynamicScroller`s `min-item-size` gehört ausdrücklich **nicht**
dazu — das ist eine Schätzung vor der Messung, und diese Scroller tragen gemischten Inhalt
(Disc-Leisten, Kartenzeilen, Köpfe), dessen Höhe keine Zeilenhöhe ist. Der Unterschied ist auch
die Gegenprobe: dieselben Zeilen malten unter dem messenden Scroller der Album-Ansicht die ganze
Zeit volle Tinte.

Alle drei Layer liegen im **Background**, nicht auf Pseudo-Elementen: `::before` und `::after`
gehören der laufenden Zeile (Textur + Zackenband), und eine laufende Zeile braucht ihr Band
weiterhin.

## ⚠️ Der Laufend-Zustand hat EINE Quelle und markiert die VORDERKANTE

Fläche, Rahmen und Marke der laufenden Zeile kommen aus **`mem-now-playing-row`**
([_candy.scss](../../src/assets/scss/_candy.scss)). Beide Wirte binden nur noch das Mixin ein —
`.songlist-item.current` (Songlisten) und `.track-item.currentInQueue` (Queue-Panel). Vorher stand
der Zustand **zweimal wortgleich** da, also war jede Änderung am Ornament zwei Änderungen, und die
zweite Stelle sieht man nur im rechten Seitenpanel und nur während etwas läuft. Der Zensus dazu
ist getestet (`src/components/__tests__/nowPlayingRow.test.ts`).

Das Zackenband sitzt an der **linken** Kante, nicht mehr unten. Drei Gründe, die alle drei zählen:

- Die Zeile hat `overflow: hidden`, das untere Band lag also **innen** — 9 px Zeilenluft weg, die
  Zacken klebten an der Künstlerzeile.
- Unten gehört die Kante schon dem Rahmen; ein Ink-Band darüber wiederholt dieselbe Schwärze ein
  zweites Mal. Das Auge fährt eine Liste aber **senkrecht** ab — die Marke gehört an die Kante,
  die es dabei kreuzt.
- **Ein gerader Ink-Balken an dieser Stelle liest sich als dickerer Rand**, nicht als Marke: er
  stößt direkt an den Rahmen. Die Marke muss deshalb eine **Form** haben (Zacken), nicht nur eine
  Breite. In Farbe wäre sie unbrauchbar — siehe die Kontrast-Tabelle oben.

Die Ink-Farbe steht **im Asset** (`fill="%2317171A"` im data-URI), nicht in einer CSS-Regel: sie
ist die Kontrastkante, unabhängig davon, was ein Wirt als `color` pinnt.

Das horizontale `mem-zigzag`-Mixin gibt es damit nicht mehr — wer danach sucht, sucht vergeblich.

**Die Fläche trägt den Sprinkle — aber nur an Ober- und Unterkante.** Es ist dieselbe Textur, die
`mem-transport-aux-on` für „Shuffle/Repeat AN" malt, also eine Vokabel statt einer Erfindung pro
Element. Läuft sie durch die ganze Zeile, liegt sie im Textband, und **zuerst brechen die
gedämpften Spalten weg** (Album, Datum, Dauer): sie sind ohnehin nur Grau auf Gelb. Deshalb eine
`mask-image`-Blende — 13 px Textur, bis 21 px ausgeblendet, an beiden Kanten.

Dazu liest die laufende Zeile **auf voller Stärke**: Titel eine Gewichtsstufe höher, Künstlerzeile
ohne `opacity`-Dämpfung, Album/Datum/Dauer in Ink statt Grau (in beiden Wirten). Das ist kein
Schönheitsschritt, sondern die Konsequenz aus der Textur — und es ist die eine Zeile, die gerade
gelesen wird. **Die Überschreibungen brauchen mehr Spezifität als die Vorgaben**, denn die stehen
in den Kind-Komponenten (`TrackTitle`, `TrackAlbum`, `TrackDateAdded`, `TrackDuration`), deren
Style-Blöcke in Import-Reihenfolge ausgegeben werden — bei Gleichstand entschiede der Bundler.

⚠️ **Beide Pseudo-Elemente der Zeile sind vergeben** (`::before` Textur, `::after` Marke). Wer der
Zeile noch etwas aufmalen will, braucht einen anderen Mechanismus: Die Drop-Marke der Queue ist
deshalb ein **`inset box-shadow`** — sie lag vorher auf `::before` und hätte ausgerechnet auf der
laufenden Zeile kollidiert.

## ⚠️ Die Schraffierung bedeutet „das kann man drücken" (#378)

`mem-hatch` in [_candy.scss](../../src/assets/scss/_candy.scss) malt die Terrazzo-Striche, und
sie sind **keine Dekoration, sondern eine Aussage**: Buttons, die Platten der Sidebar-Zeilen und
Karten tragen sie. Was nur *aussieht* wie eine Platte (Überschriften-Sticker, die Etiketten des
Sortier-Banners), bleibt **glatt**, und genau dieser Unterschied unterscheidet die beiden.

**Präziser seit #468: Die Schraffur markiert einen Bedienpunkt _zwischen_ Nicht-Bedienpunkten.**
Der Satz hieß hier vorher „jede drückbare Fläche trägt sie", und in dieser Form stimmt er nicht —
er wurde an der Sidebar gefunden, wo Zeilen mit Überschriften und Trennern abwechseln. Dort trennt
die Textur wirklich etwas.

Eine **Inhaltsliste über die volle Breite** ist der umgekehrte Fall: Dort ist *jede* Zeile
drückbar, die Textur trennt also nichts mehr — sie kostet nur Lesbarkeit. Bei den Chart-Zeilen
(~1900 px breit) liefen die 38-px-Kacheln rund fünfzigmal nebeneinander, zehn Zeilen untereinander,
quer durch Titel und Untertitel. `mem-row-plate` nimmt deshalb ein **`$hatch`-Flag**.

**Die Textur gehört dem Chrome.** Auf dem Charts-Schirm behalten die Tabs und die Seiten-Knöpfe
sie, die Zeilen geben sie ab — und *dieser Kontrast* ist ab jetzt das, was sie aussagt.

⚠️ **`mem-row-plate-hover` nimmt dasselbe Flag, und beide Hälften müssen übereinstimmen.** Eine
Zeile, die die Schraffur abgibt, aber mit ihr hovert, ließe unter dem Zeiger eine Textur
*wachsen* — dieselbe Klasse Fehler wie ein Hover, der `--mem-hover-text` vergisst. Der Zensus in
`rowHover.test.ts` hält die Antwort pro Platte fest und prüft **beide Richtungen**: Die Sidebar
darf sie nicht still verlieren, die Chart-Zeile nicht still zurückbekommen.

Die frühere Lesart („primär/aktiv" — Play-CTA und eingeschaltete Toggles) ist damit abgelöst. Sie
war vom Bildschirm aus nicht lernbar: Die Hierarchie steckt ohnehin in der **Füllung** (teal =
Wiedergabe, gelb = an, blush = ausgewählt), die Textur konnte sie nur wiederholen.

Drei Bedingungen, alle tragend:

1. **Es braucht eine Fläche.** `btn-quiet` ist im Ruhezustand transparent und bleibt deshalb blank;
   die Textur darf mit seiner Hover-Platte kommen. Ein Offset-Schatten unter nichts ist ein
   Schmierfleck — dasselbe Argument wie beim Schatten.
2. **Die Strichfarbe antwortet auf die Füllung darunter.** `$on: surface` liest das
   theme-abhängige `--mem-hatch` (Ink auf hellem, Paper auf dunklem Panel), `$on: accent` das
   statische `--mem-hatch-accent` (immer Ink — blush, teal und gelb sind in beiden Themes
   dieselbe Farbe). **Die Verwechslung ist im Light-Theme unsichtbar** und im Dark-Theme eine
   leere Fläche; der Zensus in `rowHover.test.ts` prüft deshalb genau dieses Paar.
3. ⚠️ **Die Schraffur läuft NIE hinter Text.** Striche zwischen Buchstaben kosten genau die
   Lesbarkeit, für die der Rest des Designs Platten und Veils einführt — bei 2× berühren sie die
   Glyphen sichtbar. Welche der beiden Umsetzungen gilt, entscheidet die **Fläche**:

   - **Breites Element, dessen Text nur einen Teil einnimmt** (Sidebar-Zeile, Navigations-Zeile,
     Browse-Kachel) → `mem-hatch-clear` auf dem **Label**, nicht auf dem Container. Es legt eine
     Deckfläche in `--row-fill` hinter genau die Textbreite (`flex: 0 1 auto`); rundherum bleibt
     die Textur stehen. Der Puffer im Mixin ist kein Zierrat — ohne ihn endet die Schrift genau
     dort, wo die Striche anfangen, und wirkt gequetscht.
   - **Kleines Element, das im Wesentlichen aus seinem Label besteht** (Tab, Chip, Text-Button)
     → **gar keine Schraffur.** Ein Cover ließe hier nur einen 4-px-Rand übrig: Rauschen ohne
     Aussage. Platte, Offset-Schatten und der Hover-Schnitt tragen „drückbar" allein — dieselbe
     Antwort wie bei den Inhaltszeilen weiter oben.

   Die Textur braucht also **Fläche neben dem Text**, sonst hat sie keinen Platz, an dem sie
   etwas sagen könnte. Icon-Buttons sind davon unberührt: Ein Glyph ist eine Strichzeichnung mit
   eigenem Kontrast, kein Fließtext.

**Und wo sie bleibt, läuft sie nie durch ein Schriftband.** Trägt eine schraffierte Fläche Text,
liegen die Striche zwischen den Buchstaben und berühren sie bei 2× sichtbar. Dafür gibt es das
Mixin-Paar: `mem-hatch-ring($size, $on)` auf der **Fläche** (Textur über die ganze Box plus eine
Deckschicht in der eigenen Füllung, auf die Content-Box geclippt) und `mem-hatch-clear($buffer)`
auf dem **Inhalt** (Label, Glyph-Zeile). Sichtbar bleibt exakt das Padding — ein Ring aus Textur um
ein glattes Schriftband. Vorbilder: `NavButtons.vue`, `LeftSidebar/index.vue`, das aktive Segment
in `SettingsView/Components/Select.vue`.

Zwei Bedingungen: **Die Füllung hat EINE Quelle** — `--row-fill`; wer daneben von Hand ein
`background-color` schreibt, malt ein sichtbares Rechteck um sein Label. Und **der Ring ist nur so
breit wie das Padding**: Eine Zeile, deren Padding nach Abzug der 3-px-Kante bei ~3 px landet,
zeigt gar keine Textur mehr.

⚠️ **Der Ring ist die Antwort auf „Textur UND Text", nicht auf „Textur oder nicht".** Steht die
Frage, ob eine Fläche überhaupt schraffiert gehört, entscheidet die Chrome-Regel oben — bei einer
Inhaltsliste heißt die Antwort `$hatch: false`, und dann braucht es auch keinen Ring. Der Weg
dorthin ist in dieser Sitzung zweimal falsch abgebogen: erst Striche quer durch die
Button-Beschriftung (Mockup-Runde, `Desktop\AivinNet\2026-08-07-settings\`), dann ein Ring auf
einer Zeile, die gar keine Textur haben sollte.

**Gemalt wird als Hintergrund-Ebene, nicht als `::before`-Overlay.** Die Sidebar-Zeilen verbrauchen
beide Pseudo-Elemente für ihre Drag-Marken, die laufende Track-Zeile für Textur und Marke (siehe
oben) — ein Overlay wäre ausgerechnet mit den Zuständen kollidiert, die man beim CSS-Schreiben
nicht offen hat. Deshalb steckt die Deckkraft als `stroke-opacity` **im Sprite**, nicht in einer
CSS-Regel, und `background-color` darf nie über die `background`-Kurzform gesetzt werden (die
wischt die Bild-Ebene weg).

**Die Kachelgröße folgt der Fläche:** 28 px auf einem 44-px-Button, 38 px auf einer Zeile, die
sechsmal so breit ist. Die Button-Kachel auf einer Zeile liest sich als Textildruck — gemessen an
der 260×44-Zeile in der Mockup-Runde zu #378.

Diese Skala hat aber eine **Obergrenze**, und #468 hat sie gefunden: Ab einer gewissen Breite gibt
es keine passende Kachel mehr, weil die Fläche nicht mehr als *ein Ding* gelesen wird, sondern als
Tapete. Wenn die Frage lautet „welche Kachelgröße passt hier noch?", ist die Antwort meistens
**gar keine** — siehe die Chrome-Regel oben.

## ⚠️ Text auf dem Grund braucht eine Platte — `--mem-veil`

Der Seitengrund ist Rasterpapier **mit** den Memphis-Doodles. Jede Textfläche, die direkt darauf
liegt, ist genau dort unlesbar, wo eine Form darunter durchläuft — und das ist nicht die Ausnahme,
sondern der Normalfall, weil die Doodle-Kachel 3840×1600 groß ist und jeden Bildschirm füllt.

Deshalb liegt Inhaltstext auf `--mem-veil` (Ordner-Liste, Chart-Zeilen, die Now-Playing-Quelle,
seit #486 die Lyrics). Die Regel gilt für **Fließtext und Listen**, nicht für einzelne
Bedienelemente: die tragen ihre eigene Fläche ohnehin.

Zwei Dinge, die dazugehören:

- **Chrome nimmt `$mem-panel`, Inhalt nimmt `--mem-veil`.** Der Veil ist zu 92 % deckend, also
  scheint durch ihn hindurch, was darunter durchscrollt. Ein **sticky** Kopf über einer scrollenden
  Liste muss deshalb die opake Panel-Fläche nehmen, sonst laufen die Zeilen sichtbar durch seine
  eigene Schrift. Der Unterschied liest sich zusätzlich als Rollenunterschied.
- **Die Breite wird gedeckelt.** Eine Textplatte, die ein 1440er-Fenster ausfüllt, ist ein
  Leseproblem — Lyrics und ähnlicher Fließtext stehen bei `max-width: 54rem`.

### ⚠️ Eine Abschnitts-Überschrift ist ein STICKER — und der Zensus zählt pro Überschrift (#509)

Die Platte ist die Antwort für Listen und Fließtext; für eine **Überschrift** heißt sie
`mem-sticker` (Karten-Zeilen, „Top Tracks", „Browse Library", „Up Next"/„Queue", die
Chart-Gruppen, die Seitentitel, der Recent-Searches-Kopf). Die beiden Überschriften des
Such-Tabs „Top" waren die letzten ohne — sie trugen ein theme-abhängiges `color`, und
genau das ist der Fehler in Reinform: **eine Farbe beantwortet keine Form darunter.**

Zwei Dinge, die dabei jedes Mal auffallen:

- **Der Sticker gehört an eine KLASSE, nicht an den `h3`-Elementselektor.** Auf einer
  Suchseite trifft `h3` auch den Titel *in* der Top-Result-Karte — der sitzt auf Panel und
  wird durch einen Sticker zur Platte auf der Platte. Dafür gibt es `.section-title`.
- **Der Sticker fluchtet links mit dem, was er beschriftet — ein Rest-Inset ist ein Bug.**
  Ein linkes `padding`/`margin` an einer Überschrift stammt fast immer aus ihrer Zeit als
  nackter Text: Abstand zur Kante, damit das Wort nicht klebt. Ein Sticker trägt diesen
  Abstand **in sich** (das Padding des Chips), also wirkt derselbe Wert danach anders — und
  zwar je nach Kasten unterschiedlich, weshalb beide Hälften in den Zensus gehören:
  - **`margin-left` verschiebt die Platte.** Auf jeder Seite starten Überschrift, Karten,
    Kacheln und Zeilen an **einer** Kante (gemessen: Home 303 px durchgehend). Muss 0 sein.
  - **`padding-left` lässt die Platte stehen und verschiebt den Text** — der Chip wächst nach
    innen. Es ist das Padding des Chips, und `mem-sticker` setzt **beide** Seiten; wer eine
    einzeln überschreibt, macht ihn schief. Also **symmetrisch**, nicht null: eine Überschrift
    darf ein größerer Chip sein.

  Gefunden in dieser Reihenfolge, und die Reihenfolge ist die Lehre: „Up Next"/„Queue" fielen
  im Screenshot auf (16 px, schmal 8 px), der daraufhin geschriebene Zensus fand „Pinned"/
  „Other Playlists" (12 px), und das Review fand die zweite Form — „Top Tracks" auf
  Artist/Favoriten mit 16 px innen links gegen 8 px rechts (#521). Vertikale Margins sind
  davon nicht betroffen — die sind die Luft zwischen den Abschnitten.
- **⚠️ Eine kompensierte Einrückung ist ein Bug mit angehängtem Workaround.** `.generichead`
  rückte sich um `$medium` ein und gab die Einrückung über `.after { margin-left: -$medium }`
  wieder zurück. Netto null für den Inhalts-Slot — und 12 px Versatz für alles im Kopf, das
  **nicht** kompensieren kann: Seitentitel und Beschreibung, gleichzeitig auf Albums, Artists,
  Playlists, Favorites, Stats und Charts (#527). Die Konstruktion versteckt ihren eigenen
  Schaden: wer die Gegen-Marge schreibt, prüft das Element, das er ansieht — und das **ist**
  bündig. Bezahlt wird eine Komponente weiter. Also **beide Hälften löschen, nie eine dritte
  Kompensation**. Zensus: `compensatedIndent.test.ts` (negative linke Marge exakt in Höhe des
  eigenen `padding-left`). Legitim bleibt eine negative Marge, deren Betrag **nicht** die
  eigene Einrückung ist — z. B. die Textfläche der Kartenzeilen, die genau deshalb eine
  begründete Ausnahme im Zensus hat.
- **Gemessen wird am laufenden Build: `node scripts/edge-audit.js`.** Er misst jede
  Sticker-Überschrift gegen den Block darunter (Liste/Grid/Platte) und meldet Versatz sowie
  schiefes Chip-Padding. Beide Fehlstellungen dieser Runde kamen aus Nutzer-Screenshots, nicht
  aus den Zensus-Tests — und das ist kein Zufall: Padding aus einem **Mixin**, interpolierte
  Selektoren und Sass-Arithmetik sind für einen Quelltext-Zensus unsichtbar und hier trivial
  sichtbar. Nach jeder Kanten-/Kopf-Änderung einmal laufen lassen; gegen den **alten** Build
  gegenprüfen, sonst weiß man nicht, ob er misst oder nur grün ist.
- **Ein Zensus über „die Datei erwähnt `mem-sticker`" ist keiner.** Eine Komponente, die
  ihre erste Überschrift plattiert und daneben eine zweite blank stehen lässt, bleibt damit
  grün — und das ist exakt die Form dieses Bugs. `sectionCaptionSticker.test.ts` sammelt
  deshalb **jede** `<h2>/<h3>` aller Views und Komponenten ein und löst pro Überschrift ihre
  eigenen Selektoren auf (Klassen, dann das Element); wer keinen Sticker hat, trägt seine
  Datei mit der Fläche ein, auf der sie stattdessen sitzt (`NOT_ON_THE_GROUND`).

⚠️ **Und eine Platte macht sichtbar, was ohne sie nichts kostete.** Eine leere Liste unter
einem Rahmen ist ein leeres Rechteck (die Guard `v-if="…tracks.length"` stand nur im
Sidebar-Zwilling), und ein `margin-top` auf *jeder* Zeile addiert sich an der Oberkante auf
das Platten-Padding (8 px oben gegen 4 px unten). Beides war auf dem nackten Grund
unsichtbar — wer eine Fläche einzieht, liest die Innenabstände und die Leerzustände neu.

## ⚠️ Die Sidebar-Zeile IST ein Button (#378)

Navigation und Bibliothek tragen dieselbe **Platte**: `mem-row-plate` / `-hover` / `-active` in
[_candy.scss](../../src/assets/scss/_candy.scss) — Panel-Fläche, Ink-Rahmen, 3-px-Offset,
Schraffur. Vorher waren es flache Zeilen; das war unter sich stimmig, zerlegte die Sidebar aber in
zwei Hälften, sobald die Navigation Platten bekam.

- **Die Mixins nehmen, nie ausschreiben.** Dieselbe Behandlung von Hand zu wiederholen hat vier
  Runden gebraucht, bis die Zeilen dieser Sidebar übereinstimmten (siehe „die letzte Stelle" in
  CLAUDE.md). Der Zensus steht in `rowHover.test.ts`.
- **Der Aktiv-Zustand tauscht Füllung UND Schraffur** (`mem-row-plate-active`): statisches Blush
  verlangt den Akzent-Token. Beides steckt im selben Mixin, damit es nicht getrennt driftet.
- **Ein Ordner ist EINE Platte**, Kopf und Inhalt in einem Kasten, getrennt durch eine Ink-Linie.
  Kinder als eigene Platten machen aus einer Gruppe sechs gleichrangige Platten; flache Kinder
  neben Platten bauen die Naht im Kleinen wieder auf. In einem Kasten dürfen sie flach sein,
  **weil** sie auf einer Platte sitzen — der Ordner-Kopf hat deshalb bewusst *keine* eigene Platte.
- **Platten brauchen Luft:** `gap: $small` statt `$smaller`, und der Container reserviert rechts
  `padding-right: $small`, weil `overflow: hidden` sonst den Offset-Schatten bündig abschneidet.
  Kosten gemessen: 986 → 1046 px über 19 Einträge (+6 %), komplett in den Abständen.
  ⚠️ **Auch unten** — ohne `padding-bottom` verlor die letzte Zeile ihren Schatten (Stats war die
  eine Platte ohne, #397).
- **Die Beschriftung IST der Trenner** (#422). Über LIBRARY stand eine 1-px-Haarlinie in Grau —
  das einzige Element dieser Stärke in einer Sidebar aus 3-px-Ink-Rahmen; sie las sich wie aus
  einem anderen Bausatz (#355 sammelt dieselbe Diskrepanz anderswo). Die Überschrift trägt
  stattdessen einen **Blush-Sticker** und trennt damit selbst. Zwei Bedingungen: Er darf **keine
  Schraffur** tragen (die bedeutet „drückbar", und das hier ist eine Beschriftung), und er
  funktioniert nur, seit Blush nicht mehr die Zeigerfarbe ist — vorher hätte eine Beschriftung
  dauerhaft gehovert ausgesehen.

## ⚠️ Ein Icon nicht mit `opacity` dämpfen, wenn es kein Zustand ist

Die Sidebar-Glyphen liefen unter `opacity: 0.75` — ein Rest aus der Zeit der gefüllten
SF-Symbols-Masse, wo das die Härte nahm. Auf 2,4-px-Strichen macht dieselbe Regel aus reiner Tinte
ein **mittleres Grau neben dem eigenen Label** (gemessen: `#17171A` bei 0,75 über Weiß landet bei
etwa `#515154`). Genau das kam als „die Icons wirken schwächer" zurück.

Die Regel dahinter: **`opacity` auf einem Glyph ist eine Zustandsaussage, keine Dekoration.**
Legitim sind deshalb nur `aux-off` (Shuffle/Repeat AUS, 0,45 — beide Transport-Reihen) und
Platzhalter-Glyphen in leeren Bildflächen. Der aktive Nav-Zustand trägt seine Aussage schon in der
Zeile (Blush-Fläche + Ink-Rahmen); das Glyph muss nicht zusätzlich flüstern.

Prüfen statt schätzen: das Glyph und sein Label im **selben** 4×-Element-Screenshot ansehen. Das
Label ist die eigene Referenz-Schwärze des Designs — nebeneinander sieht man den Unterschied
sofort, isoliert nie.

Zeichnerisch gilt: **abgesetzte Radialstriche lesen sich als Sonne, nicht als Zahnrad.** Die Zähne
von `settings.svg` beginnen deshalb *innerhalb* der Ring-Außenkante — und die Sonne ist in dieser
App der Theme-Toggle.

Neu gezeichnete Icons vor dem Commit **ansehen, nicht nur schreiben**: ein Kontaktbogen aus allen
Glyphen, hell und dunkel, bei 24/36/64 px, headless gerendert. Genau daran fiel das Zahnrad auf.

Noch im alten Stil (selten, einzeln, kein sichtbarer Stilbruch): `calendar`, `explicit`, `lastfm`,
`symlink`, `grid`, `radio`, `sparkles`, `timer`, `image`, `eye*`, `logout`, `lyrics`,
`add_to_queue`, `add-to-queue`.

⚠️ **„Einzeln, kein sichtbarer Stilbruch" hält nur, solange die Glyphen einzeln stehen.** Fünf
davon (`paintbrush`, `phone`, `avatar`, `mic`, `info`) saßen in **einer** Liste — der
Bereichsliste des Settings-Fensters — untereinander neben vier Chrome-Glyphen, und dort war der
Bruch sofort sichtbar: gefüllte Silhouetten neben gestrichenen Umrissen, gemeldet als „Icons
prüfen, Stil nicht konsistent". Wer einen Legacy-Glyph in eine Liste hängt, zeichnet ihn vorher
neu. Dieselbe Liste trug zweimal **dasselbe** Icon für zwei verschiedene Einträge (Albums/Album
Cover, Artists/Backup) — ein wiederverwendetes Glyph fällt beim Schreiben nie auf, in der
gerenderten Spalte sofort.

⚠️ **Diese Liste zählte lange auch Dateien mit, die gar nicht mehr importiert wurden**
(`tag`, `sdcard`, `hifi`, `upload`, `play-next`, `previous`, `heart*` — seit dem Wechsel des
Favoriten-Zeichens wieder da, neu auf dem Raster —, `lyrics2`, `clock` und
neun weitere — 18 von 83). Eine Datei im Ordner ist kein Beleg dafür, dass sie benutzt wird:
`vite-svg-loader` übersetzt SVGs in Vue-Komponenten, ungenutzte landen also **nicht** im Bundle
und fallen bei nichts auf. Wer den Satz inventarisiert, zählt über die **Importe**, nicht über
`ls`:

```bash
for f in src/assets/icons/*; do n=$(basename "$f"); \
  grep -rqF "$n" src || echo "TOT: $n"; done
```

Der Grep allein reicht als Beweis nicht — er findet keine dynamischen Pfade. Gegenprobe ist der
**Content-Hash**: löschen, `rm -rf dist && yarn build`, und die Dateinamen in `dist/assets`
vergleichen. Bleiben sie gleich, war der Beitrag null (so belegt beim Aufräumen dieser 18).

## ⚠️ Eine Ein-Zeilen-Kartenreihe rendert GENAU so viele Karten wie CSS Spalten baut

Der `CardScroller` (Home-Zeilen, „ähnliche Alben/Artists", Favoriten-Reihen) ist ein
`repeat(auto-fill, minmax($cardwidth, 1fr))`-Grid und soll **eine** Zeile sein — eine Karte mehr
als das Grid Spalten hat, und die überzählige bricht in eine zweite Zeile um. Die Spaltenzahl von
`auto-fill` ist `floor((Breite + Gap) / (Mindestbreite + Gap))`; der JS-Spiegel dazu ist
`utils/cardColumns.ts`, gespeist aus der **gemessenen Breite des Grids selbst**
(`useElementSize`), nicht aus einer Seiten-Heuristik.

- **Der Kartenabstand hat EINE Quelle:** `$card-row-gap` / `$card-col-gap` in `_variables.scss`.
  Jedes Karten-Grid (`minmax($cardwidth, …)`) liest den Spalten-Gap aus dem Token — der Zensus
  dazu ist getestet (`components/__tests__/cardGridGap.test.ts`). Die Alben-/Künstlerliste, die
  Such-Kartenseiten und die Discography standen bis #440 **ohne** Gap da: Seit die Kacheln keine
  eigene Fläche mehr tragen (Platten-Anatomie), stießen die Cover dort Kante an Kante — sichtbar
  nur im Vergleich mit den Home-Zeilen nebenan, und kein Diff einer einzelnen Datei sagte es.
- **Wer `$cardwidth`, `$card-col-gap` oder den `mediumPhones`-Override (9rem) ändert, zieht die
  Konstanten in `cardColumns.ts` mit** — beide Hälften sind aneinander getestet
  (`utils/__tests__/cardColumns.test.ts` gegen eine Nachbildung des auto-fill-Algorithmus,
  `cardGridGap.test.ts` für die Token-Spiegelung).
- **Was Items in Kartenzeilen partitioniert, zählt Spalten MIT Gap:** `useCardGridColumns()`
  (helpers) misst das Grid bzw. eine Null-Höhen-Probe im `#before`-Slot des Scrollers und
  rechnet durch den auto-fill-Spiegel. `maxAbumCards` (content-width.ts) ist nur noch die
  **Fetch-Heuristik** (wie viele Items der Server liefern soll) — sie ignoriert den Gap bewusst
  und überschösse als Gruppengröße nahe der Breakpoints um eine Karte, die dann **innerhalb**
  jeder virtualisierten Zeile umbricht. Der Zensus in `cardGridGap.test.ts` verbietet
  `maxAbumCards` deshalb in den Partitionierern (`AlbumListView`, `CardGridPage`).

## ⚠️ Der Inhalt läuft HINTER der Player-Bar — jeder Scroller reserviert sie

`#acontent` spannt die Grid-Zeilen 2–4 (`grid-row: 2 / 4`), damit der Memphis-Grund hinter der Bar
durchläuft und die Seite nicht in einer Naht endet. Die Konsequenz: die Bar überdeckt den unteren
Rand **jedes** Scroll-Containers, und jeder muss sich `$bottombarheight` (bzw.
`$bottombarheight-phone`) selbst reservieren.

`.content-page` tat das seit jeher, `.v-scroll-page .scroller` nicht — 4rem Reserve gegen eine
5,125rem hohe Bar, also lagen die letzten ~18 px der letzten Zeile darunter, auf dem Handy ~88 px
(#307). Betroffen war damit **jede** virtualisierte Seite, weil sie alle durch denselben Scroller
laufen. Die Höhe hat jetzt eine Quelle in `_variables.scss`; nicht wieder ausschreiben.

Beim Messen: **erst scrollen, bis die Liste nicht mehr wächst.** Ein einzelnes
`scrollTop = scrollHeight` löst den Infinite-Scroll-Sentinel aus, der nachlädt und den Boden
verschiebt — man misst dann eine Zeile, die gar nicht die letzte ist. Und eine Freiraum-Zahl
beweist nichts ohne Gegenprobe: den alten Wert im laufenden Browser zurücksetzen und zeigen, dass
er verdeckt wird (gemessen: 836 gegen Bar-Oberkante 818, mit Fix 754).

### ⚠️ Wer den Einzug besitzt, entscheidet, WO abgeschnitten wird (#473)

Ein Scroll-Container clippt an seiner **Padding-Box**. Ein Panel, das seinen Einzug als eigenes
`padding` trägt, schiebt damit die Schnittkante seines Scrollers nach **innen** — und Zeilen
lösen sich in einem Streifen auf, in dem nie etwas gezeichnet wird. Die Sidebar hatte genau das:
`.l-sidebar { padding: 0.875rem }`, also endete der Scrollport 14 px innerhalb des Ink-Rahmens
(gemessen bei 1440×760: Clip bei y=97 gegen Rahmen-Innenkante y=83; unten 599 gegen 611).

**Padding auf dem SCROLLER verhält sich umgekehrt:** es scrollt mit dem Inhalt weg, die Kante
bleibt am Container. Also gehört der Einzug dorthin — gleicher Ruheabstand, aber der Schnitt
sitzt am Rahmen (danach beide Lücken 0, erste Zeile unverändert 30 px unter der Kante).

Zwei Dinge, die daran hängen:

- **Ein Kind malt ÜBER den Rahmen seines Elternteils.** Sobald der Scrollport die Kante erreicht,
  ist er eckig gegen ein rundes Panel, und der Scrollbalken schneidet durch die Rundung. Der
  Scroller braucht deshalb den **Innenradius** (`$candy-radius - $candy-border-w`), nicht der
  Wirt ein `overflow: hidden` — das schluckt sonst absichtlich außen hängende Geschwister wie
  `.sidebar-resize-handle` (`right: -4px`).
- **Der seitliche Einzug bleibt nur gleich, wenn man den Scrollbalken mitrechnet.** Er liegt
  innerhalb der Padding-Box: vorher 14 px Panel-Padding + 6 px Balken, nachher 6 px Balken +
  14 px Scroller-Padding — beides 20 px bis zur Zeile.

⚠️ **Headless beweist das nur zur Hälfte.** Chromium malt hier Overlay-Scrollbalken im Standbild
nicht, und `scrollbar-width: thin` schaltet die `::-webkit-scrollbar`-Gestaltung ab — der Thumb
über der Rundung ist im Screenshot **nicht** reproduzierbar. Belastbar sind der Computed Style
(`border-radius` 0px → 11px) und die Inhaltskante, die der Rundung sichtbar folgt.

## ⚠️ SVG-Icons abgeschnitten beim Verkleinern (viewBox)

`vite-svg-loader` nutzt SVGO, und `removeViewBox` aus `preset-default` **strippte den viewBox**.
Ohne viewBox skaliert das SVG seinen Inhalt nicht auf die CSS-Größe: es rendert in nativen
Koordinaten, und das SVG-eigene `overflow: hidden` schneidet alles ab, was über die kleinere
CSS-Box ragt. Symptom: Glyph unten abgeschnitten — in **jeder** Version, also kein Cache-Problem.

Fix liegt global in [vite.config.ts](../../vite.config.ts):
`svgLoader({ svgoConfig: { plugins: [{ name: 'preset-default', params: { overrides: { removeViewBox: false } } }] } })`.

`getBoundingClientRect()` verrät das **nicht** — nur `getBBox()` (Glyph-Bounds in user units)
gegen die gerenderte svg-Höhe, oder ein hochauflösender Element-Screenshot
(`locator.screenshot()`, deviceScaleFactor 3).

## ⚠️ Die Memphis-FORM ist ein Satz Laufzeit-Tokens (#198)

Farben waren schon immer Laufzeit-Tokens (`--mem-*`), die **Form** war beim Build eingebacken:
Versatz-Schatten, das Drücken in den Schatten, Eckenradien, Sprinkle und Doodles. Ein zweites
Theme hätte die App umfärben, aber nicht umformen können. Seit #198 liest jede dieser Stellen
`var(--shape-<name>, <Memphis-Wert>)`:

| Token | Quelle im Code | Memphis-Fallback |
|---|---|---|
| `--shape-shadow` · `-hover` · `-lift` | `mem-shadow($x, $y, $state)` (+ `candy-shadow`) | `3px 3px 0 var(--mem-shadow)` usw. |
| `--shape-press` | `mem-press($x, $y)` | `translate(3px, 3px)` |
| `--shape-radius` · `-sm` · `-xs` | `$candy-radius` · `$candy-radius-sm` · `$candy-radius-xs` | `14px` · `10px` · `4px` |
| `--shape-sprinkle` · `--shape-doodles` | `mem-sprinkle` · `mem-grid` | die heutigen Grafiken |

**Der Fallback IST das Design.** Memphis setzt keines dieser Properties und rechnet deshalb
exakt, was es vorher gerechnet hat — so wurde #198 bewiesen: berechnete Styles jedes Elements
und seiner Pseudo-Elemente (Schatten, vier Radien, Hintergrundbild/-größe, Transform, Rand) über
10 Routen × hell/dunkel × Desktop/Phone, dazu 998 Hover- und 682 Press-Zustände, master gegen
Branch: **30 728 Vergleiche, 0 Abweichungen**. Ein Theme setzt die Properties auf `body`.

⚠️ **Zwei Fallen beim Nachmessen:** Die beiden Builds laufen hinter zwei Proxys, und jede
aufgelöste `url()` trägt deren Port — ohne Normalisierung meldet der Vergleich 40 falsche
Abweichungen. Und `waitUntil: "networkidle"` wartet in dieser App **ewig**: der Device-Sync
pollt jede Sekunde, das Netz wird nie still. `load` plus feste Pause nehmen. Ein Press
(`mouse.down`) auf einer ziehbaren Sidebar-Zeile startet einen HTML5-Drag, auf dessen Drop
Playwright dann ohne Frist wartet — ziehbare Elemente beim Press-Test auslassen.

Drei Regeln, alle getestet (`shapeTokens.test.ts`):

- **Keinen Versatz-Schatten von Hand schreiben** — `box-shadow: mem-shadow(3px, 3px)`, nie
  `3px 3px 0 var(--mem-shadow)`. Die handgeschriebene Form behält in jedem anderen Theme ihre
  harte Tintenkante. Beim Schreiben des Zensus standen 13 solche Stellen in 11 Dateien.
- **Rechnen nur mit den `-static`-Zwillingen oder in `calc()`**: `$candy-radius` ist ein
  `var()`, Sass kann davon nichts abziehen (`calc(#{$candy-radius} - #{$candy-border-w})`).
- **Drei Strichstärken, alle mit Namen** (#141, #233): `$candy-border` (3 px) für Platten, Zeilen
  und Karten; `$mem-ring-w` (2 px) für Ringe um Dinge, die **auf** einer Fläche sitzen und kleiner
  sind als eine Platte (Tracknummer-Scheibe, Dauer-Pille, Zähl-Chip, Chart-Balken, Schalter-Knopf,
  Drop-Marker); `$mem-hairline` (1 px) für Chips in einer Textzeile, Tooltips, kleine Eingaben und
  Trenner. Die Fokus-Umrandung hat mit `$focus-ring-w` einen eigenen Namen, obwohl sie heute gleich
  breit ist wie der Ring: Wer Badge-Ringe verbreitert, darf nicht nebenbei ändern, was ein
  Tastaturnutzer verfolgt. Die Hairline ist eine Rolle, keine Nachlässigkeit — ein 3-px-Rahmen um einen 6-px-Punkt
  oder ein 40-px-Zahlenfeld ist schwerer als das, was er einfasst. Ein literales `1px` in `border`
  oder `outline` erfindet eine dritte Stärke und ist getestet.
- **Schatten-Versätze: 3 px (Ruhe) und 4 px (gehoben).** Modal und Now-Playing-Panel schweben
  bewusst höher. 2 px war Drift an drei Elementen gegen über tausend; `.shadow-sm` gibt es nicht
  mehr, die Nutzer tragen `.shadow-md`.
- **Keine Ecke aus einem Abstands-Token** (#140). `border-radius: $small` sah aus wie ein Wert
  aus der Skala und war eine Kategorienverwechslung: wer den Abstand ändert, verbiegt Ecken, und
  kein Look erreicht sie, weil sie an `--shape-radius-*` vorbeigehen. Knöpfe, Zeilen und
  Vorschaubilder nehmen `$candy-radius-sm`; Etiketten **in** einer Textzeile (Rollen-Chip,
  Zeit-Pille, Brotkrume) und Skeleton-Balken `$candy-radius-xs` — 10 px auf einem 1rem hohen
  Etikett lesen sich als Pille.
- **Memphis-Stylesheets definieren kein `--shape-*`** — sonst wäre der Fallback tot und der
  Gleichheitsbeweis wertlos.

Bewusst **nicht** tokenisiert: die **Randbreite**. Rund 100 Layout-Rechnungen ziehen
`$candy-border-w` ab (reservierte transparente Ränder halten Zeilenhöhen konstant). Ein Theme
ohne sichtbare Ränder macht sie über die Farbe `--mem-line` unsichtbar, nicht über die Breite —
dann bleibt jede Zeile gleich hoch. Ebenfalls unverändert: die Schraffur (`--mem-hatch*`, war
schon Laufzeit) und Glyph-Konturen (`drop-shadow` am Logo und am Herz gehören zur Zeichnung).

## ⚠️ Zwei Achsen: LOOK und MODUS — Memphis, Stream (#199) und Desktop 98 (#241)

**Look** (Formsprache: Memphis, Stream, Desktop 98) und **Modus** (hell, dunkel, Auto) sind zwei Einstellungen,
keine Liste. Eine Liste „Memphis / Memphis Dark / Stream" mischt ein Design mit einer Helligkeit
und bricht beim ersten Look, der ebenfalls beide Modi hat. Modell und Body-Klassen:
`utils/theme.ts` (`themeBodyClasses(look, mode)`); gespeichert als `look` + das alte `theme`-Feld
(= Modus, Name blieb, damit nichts migriert werden muss).

- **Stream ist nur dunkel und überschreibt den Modus NICHT.** Die Hell/Dunkel-Wahl und Auto bleiben
  gespeichert und kommen beim Zurückwechseln unverändert wieder; Modus-Auswahl und Auto sind unter
  Stream ausgegraut, der Mond-Knopf ausgeblendet (`lookHasModes`).
- **Stream baut AUF Dark auf:** `body.theme-dark.theme-stream`. Jede Komponente hat ihre
  Dunkel-Antwort schon unter `body.theme-dark`; Stream formt sie nur um. Die doppelte Klasse ist
  auch die nötige Spezifität — die Datei wird *vor* den `:root`-/Dark-Blöcken importiert.
- **Stream ist keine einzige Komponentenregel**, sondern andere Token-Werte in
  `Global/_theme-stream.scss`. Nur die Look-Dateien dürfen `--shape-*` und `--look-*` definieren,
  jede nur unter ihrem eigenen Selektor (`shapeTokens.test.ts`).

**`--look-*` ist die zweite Token-Familie** — gleiche Mechanik wie `--shape-*`, aber für die
statischen **Akzent- und Zustandsfarben** (Pastell-Navigation, Gelb für „an"/„läuft", Blush-
Etiketten, Farbband, rosa Seek-Leiste, Ringe um Nummern und Dauer, Typ-Chip). Die Liste steht als
Kommentar über `mem-shadow()` in `_candy.scss`. Zwei Familien, damit ein Name sagt, welche Frage er
beantwortet: **Form** oder **Akzent**.

Beweis wie bei #198: Memphis hell/dunkel, berechnete Styles jetzt **zusätzlich mit `color`,
`display`, `padding-left/right` und `stroke`** (genau die Eigenschaften, die die Look-Tokens
berühren), master gegen Branch — Ergebnis im PR. Wer einen neuen Look baut, setzt Tokens; wer eine
Stelle findet, die der Look nicht erreicht, macht sie zum Token mit Memphis-Fallback — nie eine
`body.theme-stream .komponente`-Regel.

**Detailseiten (#200):** Album-, Artist- und Playlist-Kopf sind in Memphis eine **Platte** (Panel,
Rahmen, Offset) — der Text liest gegen die Panel-Fläche. Ein Look, der die Seite ohnehin aus dem
Cover einfärbt, lässt stattdessen den Farbverlauf selbst der Kopf sein: `--look-detail-head-fill:
transparent`, stärkerer und weiter laufender Verlauf (`--look-veil-top/-mid/-end`, gelesen in
`pageGradient()` — `var()` in `rgba()` löst ganz normal auf) und ein größerer Titel
(`--shape-detail-title`, plus die Phone-Variante). Der Play-CTA nimmt die Look-Farbe
(`--look-play-fill`/`-glyph`), in Memphis weiterhin Teal mit Ink-Glyph.

Drei Stellen, an denen es beim Bauen gehakt hat:

- **Eine gefüllte Zeile pinnt ihre Textfarbe.** Die laufende Zeile ist in Memphis gelb und setzt
  deshalb Ink auf Titel, Album, Dauer und Glyphen (`SongItem.vue`, „Filled row states"). Tauscht ein
  Look nur die Füllung, steht schwarzer Text auf fast Schwarz. Füllung und Text sind EIN Paar
  (`--look-playing-fill` + `--look-filled-text`).
- **„Aktiv" darf nicht allein an der Zickzack-Marke hängen.** Die Navigation markiert den aktiven
  Eintrag nur mit ihr (alle Zeilen sind ja farbig). Nimmt ein Look die Marke weg
  (`--look-marker: none`), braucht er ein Ersatzsignal — `mem-row-marker` setzt deshalb auch
  `--look-active-fill`/`-text`, in Memphis fällt das auf die eigene Tönung zurück.
- **Ein Inline-Style löst `var()` ganz normal auf.** Die Seek-Leiste baut ihren Hintergrund in JS
  (`Progress.vue`); die Farben stehen dort als `var(--look-track-*, <hex>)` im String.

### Desktop 98 (#241) — was beim dritten Look gelernt wurde

Graue Fenster mit 3D-Kante auf Desktop-Blau, Titelleisten als Überschriften, Navy als Auswahl.
**Nur hell**, gebaut auf den hellen Klassen: `body.theme-desktop98:not(.theme-dark)`. Das `:not`
ist keine Deko — `body.use-figtree-font` und `body.theme-dark` stehen in `Global/index.scss`
**später** bei gleicher Spezifität und hätten sonst Schrift bzw. Farben zurückgeholt.
`utils/theme.ts::fixedMode()` sagt pro Look, welcher Modus fest ist.

- **Die 3D-Kante malt der Browser.** `border-style: outset` in Weiß ergibt oben/links hell,
  unten/rechts grau — gemessen an Chrome, fast die Windows-Kante. Dafür sind Farbe **und Stil** des
  Plattenrahmens Tokens: `$mem-frame` = `var(--shape-frame, $mem-line)`, `$mem-frame-style` =
  `var(--shape-frame-style, solid)`, `$candy-border` ist aus beiden gebaut. Die schwarze Außenkante
  unten/rechts ist der Ruhe-Schatten (`--shape-shadow: 1px 1px 0 …`). Breite bleibt Sass-Konstante.
- **⚠️ Rahmenfarbe ≠ `--mem-line`.** `--mem-line` färbt auch Glyphen, Ringe, Haarlinien und den
  Fokus-Ring. Auf Weiß gesetzt, wären die unsichtbar geworden (Fokus weiß auf weißer Liste). Also:
  **Plattenrahmen** nehmen `$mem-frame`/`$mem-frame-style`, **Tintenlinien** bleiben bei `$mem-line`.
  Wer einen Rahmen von Hand schreibt (`$candy-border-w solid $mem-line`), prüft, welches von beiden
  gemeint ist — die Seitenleisten-Platten und `btn-action` waren Rahmen und standen schwarz da.
- **Eine Überschrift mit eigener Füllung nimmt `mem-sticker(…, $fill: …)`.** Die Titelleiste
  (`--look-sticker-image`) würde sonst über eine feste Pastellfläche (Genre-Chip, Now-Playing-Marke)
  gemalt. Überschriften, die ihre Textfarbe selbst setzen, schreiben
  `var(--look-sticker-text, <alte Farbe>)` — sonst Weiß-auf-Blau verloren.
- **Eine Custom Property kann nicht auf sich selbst zurückfallen.** `--row-fill:
  var(--look-active-fill, var(--row-fill))` ist ein Zyklus und damit ungültig. Die Ruhe-Füllung
  steht deshalb zusätzlich als `--row-fill-rest` (`mem-row-plate-tint`); `mem-row-marker` fällt
  darauf zurück. Ohne das behielt das Label-Cover die graue Ruhe-Tönung in der Navy-Auswahl.
- **Der Windows-Verlauf besteht keinen Kontrast.** Weiß auf `#1084d0` (Titelleisten-Ende von 98)
  misst 4,0:1; das Ende ist `#0e6fb4` (5,3:1). Der Grund ist einfarbig `#4a86da` — ein
  Verlauf in der Bildebene (feste 3840×1600, `mem-grid`) zeigte auf höheren Bildschirmen eine
  Naht —, damit Text direkt auf dem Grund 4,5:1 hält.
- **Ein Look mit DUNKLER Laufend-Füllung deckt jedes festgenagelte Tinte-Stück auf.** Memphis'
  laufende Zeile ist gelb, also stand an mehreren Stellen einfach `$mem-ink` — der Titel
  (`.title.is-current`) und das „…" der Zeile verschwanden auf Navy. Alles auf einer gefüllten
  Zeile nimmt `--look-filled-text`. Und ein Glyph in `currentColor` erreicht man über `color`,
  nicht über `stroke` — die alte `stroke`-Regel am „…" hatte nie gewirkt.
- **Keine Schrift von Google-Servern.** Die Pixelschrift der Überschriften (Pixelify Sans, OFL)
  liegt wie Figtree als `woff2` im Repo (`assets/fonts`, Lizenz daneben, `shippedFonts.test.ts`),
  auf dieselben zwei Zeichenbereiche zugeschnitten; der Fließtext bleibt Tahoma/Verdana. Ein
  Browser lädt eine `@font-face` erst, wenn ein Element sie benutzt — Memphis und Stream holen die
  Datei also nie (gemessen: 0 Requests).

Beweis beim Bau: Memphis hell/dunkel und Stream pixelgenau master gegen Branch
(`~/uitest/regress98.js` + `imgdiff.py`; Rauschen master gegen master: 5–50 px auf denselben
Seiten), Kontrast jedes sichtbaren Texts auf sechs Seiten (`~/uitest/contrast98.js`).

## ⚠️ Hard-Shadow-System

`candy-shadow($x,$y)` malt den einzigen erlaubten Schatten: kein Blur, immer nach rechts-unten,
Farbe aus dem Theme-Token `--mem-shadow`. `candy-raised($x,$y,$press)` = Schatten +
Hover-Vertiefung + Press-in-den-Schatten.

- **Kacheln nehmen `$press: false`** — CSS-`:active` matcht auch **Vorfahren**, eine pressende
  Karte würde also bei jedem Klick auf ihren eigenen Play-Button hüpfen.
- **Den Schatten trägt die ROLLE, nicht die Button-Basis.** Bis #244 bekam jeder `button` ihn
  global und musste sich zum Flachmachen in eine Ausnahmeliste in `Global/basic.scss` eintragen —
  **beides gibt es nicht mehr**, die Basis ist ein reiner Reset. Wer heute einen Schatten will,
  nimmt `btn-action`/`btn-primary`/`btn-pill`; wer keinen will, nimmt `btn-quiet` und trägt sich
  nirgends ein.
- Ein `transition`, das **nach** dem Mixin steht, überschreibt dessen Schatten-Transition —
  dann `box-shadow` mit auflisten.

Prüfen statt hoffen: `~/uitest/audit-shadows.js` läuft alle Routen in Desktop **und** Phone ab
und listet jeden transparenten Button, der noch einen Schatten wirft.

### ⚠️ Ein Kasten, der genau so groß ist wie sein Inhalt, frisst den Schatten

Der Schatten ist **Ink-Overflow**: er vergrößert weder die Box noch `scrollWidth`/`scrollHeight`.
Ein Vorfahr mit `overflow` ungleich `visible`, dessen Inhalt bündig an seiner Kante endet,
schneidet ihn deshalb ab — und zwar spurlos. Die Deklaration steht da, der Computed Style sagt
`3px 3px`, gemalt wird nichts. Real passiert bei den Such-Chips (#399): die Grid-Zeile war auf
`2rem` gepinnt, exakt die Chip-Höhe, und darin lag eine geerbte `position: absolute;
overflow: hidden`-Box.

Drei Dinge, die dabei jedes Mal schiefgehen:

- **Der Clipper ist selten der, den man zuerst anfasst.** `.tabheaders` (der Scroller) auf
  `overflow: visible` zu setzen änderte **nichts** — der äußere `#right-tabs` schnitt an derselben
  Kante weiter. Wer den Beweis führt, öffnet *alle* Vorfahren bis zum ersten sichtbaren Kasten.
- **Eine feste Zeilenhöhe ist die eigentliche Ursache**, nicht der `overflow`. `2rem` war die
  Chip-Höhe des Tages; sobald das Bedienelement wächst, wächst es in einen Kasten, der nicht
  folgen kann. Also `max-content` und den Versatz per `padding` reservieren (`$small` deckt die
  4 px Hover-Tiefe plus die 1.04-Hover-Skalierung), so wie es die Sidebar-Zeilen tun.
- **Ein `border-radius` auf einem Scroller ohne eigene Füllung ist nur eine Clip-Maske.** Solange
  der Kasten exakt eine Pille hoch war, lag er deckungsgleich auf deren Radius und fiel nie auf;
  mit reserviertem Platz schneidet er die erste und letzte Pille an der Ecke.

- **Eine Achse auf `hidden` setzt die andere auf `auto`.** Wer nur `overflow-x: hidden` schreibt,
  baut einen **vertikalen** Clipper — die Regel liest sich waagerecht, klemmt aber senkrecht.
  Real passiert im Genre-Banner (#550): `.scrollable` war `width: max-content` und lief nie über,
  trug das `overflow-x` aber trotzdem, und die frisch geerbten Sticker-Schatten der Chips fielen
  unten weg. Gemessen unter einem Chip: **9 Gerätepixel Ink** (der 3-px-Rahmen), dann direkt der
  Grund — nach dem Löschen der Zeile 18. Wer horizontal scrollt, setzt das `overflow` auf **den
  Scroller**, nicht auf die Reihe darin.

**Geometrie beweist das nicht — Pixel schon.** `getBoundingClientRect()` kennt den Schatten nicht,
und `scrollWidth` unterschlägt in Chrome das `padding-right` des Containers, meldet also selbst
für korrekt reservierte Kästen einen Fehlbetrag. Der belastbare Test ist ein **A/B-Screenshot**:
einmal wie gebaut, einmal mit den Clip-Vorfahren auf `overflow: visible`, dann die Bilder diffen.
Identisch = nichts wird abgeschnitten. ⚠️ Dabei **nur die betroffenen Vorfahren** öffnen, nicht
`*` — ein globales `overflow: visible` reflowt die Seite, und der Diff misst danach das Layout
statt des Schattens.

## ⚠️ Breakpoints lesen die Breite — bis auf einen

`content-width.ts` und die Mixins in `_mixins.scss` sind bis auf **eine** Ausnahme reine
`max-width`-Regeln. Ein quer gehaltenes Telefon ist aber **breit UND niedrig**: 844×390 fiel in
`isLargerMobile` (660–900) und bekam deshalb die reichere Leisten-Gruppe, während `isMobile`
zusätzlich die Navigationszeile einblendete. Die Höhe kam in keiner Bedingung vor.

Gemessen war das kein Schönheitsfehler: die Chrome ist ein **fester** Posten von 249 px — 30 %
eines 390×844-Bildschirms, aber **64 %** desselben Geräts gedreht (nutzbar 133 statt 579 px).
Dazu waren die drei Detail-Header (288/288/208 px) **höher als der ganze Inhaltsbereich**, ihre
eigene Aktionsreihe hing also unten heraus.

Die Ausnahme ist ein Paar, und **beide Hälften müssen synchron bleiben**:

| | |
|---|---|
| `isShort` in `content-width.ts` | `win_height <= 500 && win_width > win_height` |
| `@mixin shortViewport` in `_mixins.scss` | `(max-height: 500px) and (orientation: landscape)` |

**Die Orientierung gehört zwingend dazu.** Ein hochkant gehaltenes Tablet liegt in derselben
Breiten-Spanne (834 px) und ist nicht niedrig — ohne die zweite Hälfte verlöre es seine Leiste
mit. Der Test dazu (`stores/__tests__/shortViewport.test.ts`) prüft genau diesen Fall.

Zwei Dinge, die daran hängen:

- **Die Leiste im kurzen Viewport ist die PHONE-Leiste.** Die Bedingung steht als `phoneBar`
  einmal in `BottomBar/Left.vue` und wird dreimal gelesen. Wer nur einen der Zweige anfasst,
  baut die stille Sackgasse aus #326 wieder auf: ein Gerät, das mit `Actions` die Lautstärke
  verliert und den Unmute-Knopf nicht bekommt, ist stumm ohne Weg zurück.
- **Wer die Bar-Höhe ändert, ändert die Scroller-Reserve mit** (`$bottombarheight-short`) —
  siehe die Regel weiter unten: `#acontent` läuft hinter der Bar, jeder Scroller reserviert sie
  selbst.

⚠️ **Ein `min-height` ist ein Boden und will gelöst werden, nicht gesenkt** — und die Reihenfolge
im Block entscheidet: der `shortViewport`-Block im Playlist-Header stand zuerst **vor**
`.sqr_img`. Gleiche Spezifität, früher im Block ⇒ das 16rem-Cover gewann, und der Header stand bei
264 statt 127 px, obwohl `min-height` und Titelgröße nachweislich griffen. Solche Blöcke gehören
ans **Ende** ihres Selektors.

## ⚠️ Touch-Ziele: 44 px, Header-Aktionen haben EINE Anatomie

Sekundäre Aktionen in Seiten-Headern (Favorit, Pin, Download, Cover holen, Optionen, Edit,
Löschen) nehmen die Rolle **`btn-action`**: 2.75rem quadratisch, Panel-Fläche, Rahmen,
Offset-Schatten, 1.5rem-Glyph, `flex-shrink: 0`.

(Bis v1.5.1 hieß das `mem-header-action` in `_candy.scss`; **das Mixin gibt es seit #244 nicht
mehr** — wer danach sucht, sucht vergeblich.)

Die beiden Fallen dahinter:

1. **Ohne `flex-shrink: 0` quetscht eine Header-Reihe auf schmalen Phones ihre eigenen Buttons**
   (gemessen: 16×36 statt 40×40). Header-Reihen bekommen `flex-wrap: wrap`, und der Header eine
   `min-height` statt fixer `height` — sonst läuft die umgebrochene Reihe in den Inhalt darunter.
2. **Transparente Buttons erben aus der globalen Button-Basis statisches Ink.** Auf dem dunklen
   Ground waren Pin und Download schlicht **unsichtbar** → `color: $mem-content-text`.

Messen statt schätzen: `~/uitest/mobile-audit.js` listet pro Route × Theme alle interaktiven
Elemente < 44 px und jedes Element breiter als der Viewport. Legitim unter 44 px bleiben nur der
Slider-Track (der Knopf ist das Ziel) und Inline-Textlinks in Listenzeilen (die ganze Zeile ist
tappbar).

**Detail-Header haben eine feste Reihenfolge:** Play · Favorit · Pin · Zweitaktion · Overflow.
Es gibt **drei** davon — Album, Artist und Playlist. (Ein vierter, der Mix-Header, fiel mit dem
Mixes-Feature weg.) Wer einen neuen anlegt, trägt ihn in `headerActionOrder.test.ts` ein — der
Zensus-Test dort schlägt sonst fehl, und genau das ist seine Aufgabe.

Die Reihe selbst ist die geteilte Klasse **`.header-actions`** in
[_button-classes.scss](../../src/assets/scss/Global/_button-classes.scss) — Flex, Gap, Wrap und
Staffel-Versatz. Eine neue Header-Reihe bekommt einfach die Klasse; es gibt **keine Liste mehr,
in die man sich eintragen müsste**.

**Reihenfolge und Vollständigkeit sind getestet**
(`src/components/__tests__/headerActionOrder.test.ts`): Ein Button am falschen Ende der Reihe oder
eine fünfte `.header-actions`-Reihe, die der Test nicht kennt, lässt die Suite rot laufen.

## ⚠️ Es gibt DREI Kantenlängen, und jede hat einen Namen

Ein Zensus aller quadratischen Icon-Buttons der laufenden App
(`~/uitest/ctlcensus.js`, 12 Routen × Desktop und Phone) fand **sechs** Größen — 22, 26, 28, 32,
44, 52 px — von denen nur eine ein Token hatte. Die beiden größten Gruppen gehörten **niemandem**:
32 px (780 Vorkommen) und 28 px (756). Genau die Form, in der #354 den 8-px-Radius fand: kein
Fehler, sondern eine Entscheidung, die niemand aufgeschrieben hat.

| Token | Wert | gilt für |
|---|---|---|
| `$bar-control` | 2.75rem · 44 px | Chrome: Top-Bar, Player-Bar, Header-Aktionen |
| `$control-compact` | 2rem · 32 px | Bedienelemente **in einer Inhaltszeile**: Track-Zeile, Queue |
| `$control-dense` | 1.75rem · 28 px | die **Sidebar**: Thumbnails, deren Overlays, Sektions-Buttons |

Dazu je ein `*-glyph`-Token; die 52-px-Play-Scheibe auf einer Kachel bleibt bewusst eine
Call-Site-Entscheidung (primäre CTA, auf das Artwork gesized, kein Mitglied einer Stufe).

**Die drei sind kein Kompromiss, sondern drei Dichten.** Die Sidebar-Zeile ist 42 px hoch, eine
Track-Zeile 72 — und in der Sidebar ist die **Zeile** das Tippziel, das Overlay darauf sekundär.
Wer die Stufen zusammenzieht, macht entweder das Tippziel in der Track-Zeile kleiner oder kippt
die Zeilenhöhen-Rechnung aus #388.

⚠️ **`btn-action` hat ein `$glyph`-Argument** — ohne das überschrieb jede kleine Platte ihre
Glyphgröße am Aufrufort (ein 24-px-Icon in einer 22-px-Öffnung), und genau solche Patches sammelt
`_buttons.scss` ein.

Der Zensus ist getestet (`src/components/__tests__/controlScale.test.ts`): Er prüft **alle**
Komponenten auf Box-Geometrie an `.heart-button`, verlangt für die Zeilen- und Sidebar-Controls das
jeweilige Token statt einer Literal-Größe und besteht darauf, dass Überlauf- und
Entfernen-Trigger `<button>` mit `aria-label` sind.

## ⚠️ Die Chrome hat EINE Kantenlänge: `$bar-control`

Player-Bar **und** Top-Bar lesen `$bar-control` (2.75rem = 44 px) aus
[Global/_buttons.scss](../../src/assets/scss/Global/_buttons.scss). Die Top-Bar hatte die
Geschichte der Player-Bar in ihrer eigenen Zeile wiederholt — gemessen 48/48/48/36/36 px, zwei
Schattentiefen (4 px Home, 3 px Toggle), **drei** Press-Antworten (in-den-Schatten, `scale(0.94)`,
gar keine) und ein 20,8-px-Glyph in einer Reihe aus 24-px-Glyphen.

Die Ursache ist nicht Schlamperei, sondern **Kompensationsketten**: der Toggle war „auf den Avatar
gesized", die Such-Pille „auf den Home-Button", die Pille auf dem Handy wieder „auf den Avatar".
Jede Zahl war für sich begründet, keine kannte die Norm — und wer eine davon korrigiert, strandet
still die anderen. Deshalb: **kein Bedienelement der Chrome schreibt eine eigene Kantenlänge**,
auch nicht in einem `@include allPhones`-Block.

Zwei Fallen, die dabei aufgefallen sind:

- **Was wie ein Button aussieht, ist nicht immer ein `<button>`.** Der Home-Button ist ein
  RouterLink und fiel deshalb durch **jeden** Element-Selektor: keine Rolle, kein Fokusring aus
  `basic.scss`. Ein Element-Selektor ist keine Anatomie — die Rolle (und `focus-ring`) muss
  explizit dran.
- **Ein `<div>` mit `@click` ist kein Bedienelement.** Der Avatar öffnet ein Menü, war aber per
  Tastatur nicht erreichbar, meldete keinen Namen und konnte kein `aria-expanded` tragen.

Der Zensus ist getestet (`src/components/__tests__/topBarAnatomy.test.ts`): Er kennt jedes
Top-Bar-Bauteil, verlangt `$bar-control` statt einer Literal-Größe (inklusive Breakpoint-Blöcken),
verbietet ein lokales `transform:` (Hover 1.06 / Press 0.98 gehören der Rolle) und besteht darauf,
dass der Avatar-Trigger ein `<button>` mit `aria-expanded` ist.

⚠️ **Eine geteilte Komponente nimmt ihre Rolle selbst.** `HeartSvg.vue` trug seine Maße lange von
Hand, also wiederholten Album- und Artist-Header wortgleich denselben Patch. Jetzt trägt die
Komponente eine Prop `btn_role` (`quiet` = blanker Glyph, `action` = Header-Platte). Neue
Varianten also als **Rollen-Prop an der Komponente**, nicht als Regel in der aufrufenden View.

### ⚠️ Drei Wirte, drei Buttons — und keiner sah für sich falsch aus (#499)

Dieselbe Falle beim **Devices-Button**, nur eine Stufe schlimmer: seine Anatomie lag in den drei
Wirten, und die hatten sich auseinandergelebt — `BottomBar/Right.vue` plattierte ihn über die
Wirt-Regel mit `btn-action`, `BottomBar/Left.vue` strippte ihn per
`border: none; background: transparent` zum blanken Glyph, und `NowPlaying/Header.vue` setzte eine
44-px-Box **ohne jede Rolle**. Auf dem Handy — dem einen Gerät, für das Gruppen-Wiedergabe gedacht
ist — stand er damit als einziger Knopf ohne Fläche in einer Reihe aus lauter Platten (prev, play,
next). Gemeldet als „ist noch nicht als Button dargestellt (kein Schatten etc.)".

**Die Form des Fehlers ist der Punkt:** Keine der drei Dateien las sich für sich falsch. Jede war
in sich stimmig, und sichtbar wurde die Drift erst, wenn man zwei Bildschirme nebeneinander legt.
Ein Zensus muss deshalb „**kein** Wirt gestaltet diesen Button" prüfen, nicht „der Handy-Balken ist
plattiert" — und die Wirte **aufsammeln statt auflisten**
(`devicesButtonAnatomy.test.ts`: über alle `.vue` streichen, die die Komponente importieren; eine
feste Dreierliste ließe den vierten Wirt still durch).

Sechs Dinge, die dabei mit hochkamen:

- ⚠️ **Eine Platte legt Abstände offen, die ein blanker Glyph verdeckt hat.** `.left-group` stand
  im `largePhones`-Block auf `gap: 0` und ließ das Cover einen privaten `margin-right` tragen —
  tragfähig, solange die hinteren Bedienelemente blanke Glyphen waren: ein 24-px-Icon in einer
  44-px-Box bringt 10 px eigenes Padding mit, also sieht die Reihe bei **jedem** Gap gleichmäßig
  aus. Mit Füllung standen `next` und `devices` gemessen bei **exakt 0** — zwei 3-px-Ink-Rahmen
  auf Stoß. Der Abstand gehört deshalb der Reihe (`$bar-gap-phone`), nicht einem Kind. Dasselbe
  gilt für den Unmute-Knopf im stummen Zustand.

- **`candy-box()` malt Fläche und Rahmen — keinen Schatten.** Der beigetretene Zustand (grün) war
  damit der einzige *gefüllte* Knopf der App, der flach auf der Bar lag. Der Offset kam vor #244
  zufällig aus der globalen Button-Basis, also sah der Aufruf vollständig aus. Ein „An"-Zustand
  nimmt deshalb `btn-toggle-on` — dieselbe Box wie Shuffle/Repeat, nur mit `$fill: $brand-green`
  statt Gelb (Gelb heißt „läuft").
- **Der eigene Hover-Block gehört zum An-Zustand dazu.** `.ds-joined` steht später und mit gleicher
  Spezifität wie der `:hover` der Rolle — ohne eigenen Block wäre ausgerechnet der eingeschaltete
  Knopf der eine, auf dem der Zeiger nichts sagt. Dieselbe Lücke hat #422 bei `btn-toggle-on`
  geschlossen; sie kommt bei jedem neuen Zustands-Selektor zurück.
- ⚠️ **Ein An-Zustand muss die Textur des RUHE-Zustands löschen, nicht nur die Füllung tauschen.**
  `candy-box()` setzt ausschließlich `background-color` — die Schraffur von `btn-action` lebt im
  `background-image` und lag damit **unter** dem Sprinkle weiter: zwei Texturen gleichzeitig, und
  die überlebende ist die theme-abhängige (`$on: surface`), während eine statische Akzentfläche
  `$on: accent` verlangt. Unsichtbar geblieben ist das nur, solange jeder Aufrufer zufällig mit
  `btn-quiet` paarte, das gar keine Ruhe-Textur hat. `mem-transport-aux-on` setzt jetzt selbst
  `background-image: none`.
- ⚠️ **Ein Quelltext-Zensus fängt keinen Sass-Fehler.** Der Aufruf stand eine Runde lang mit
  `$glyph:` da — Dart Sass bricht damit ab („No argument named $glyph"), der Test war trotzdem
  grün, weil er nur `@include btn-toggle-on(` als Text suchte. Wer Aufrufe prüft, prüft die
  **Argumentnamen** mit; sonst bezeugt der Zensus eine Datei, die nicht kompiliert.
- ⚠️ **`$glyph` heißt in diesem Repo Glyph-GRÖSSE** (`btn-action`, `btn-quiet`, `btn-primary`).
  Ein Parameter für die Glyph-*Farbe* heißt `$glyph-color`, sonst emittiert der nächste Aufrufer
  `color: 1rem` — vom Browser wortlos verworfen.

## ⚠️ Ein `<button>` als Grid-Container zentriert seine SPUR

`display: grid` auf einem `<button>` verhält sich nicht wie auf einem `<div>`: Das
UA-Stylesheet zentriert die Tracks. Eine `auto`-Spalte ist damit nur so breit wie ihre eigene
längste Zeile und sitzt danach **mittig** in der Platte — `width: 100%` ändert daran nichts, das
setzt den *Container*, nicht die Spur darin.

Sichtbar wird es erst im Vergleich zweier Platten mit **unterschiedlich langem** Text, und dann
liest es sich als Ausrichtungsfehler statt als Zentrierung. Gemessen an den beiden Quellen-Knöpfen
des Metadaten-Dialogs (#226):

| | Platte | Label | gerendert |
|---|---|---|---|
| „Look it up online" | 640 px | 199 px | zentriert → sieht zentriert aus |
| „Read the file names" | 640 px | 364 px | zentriert → sieht linksbündig aus |

Gemeldet wurde das wörtlich als „das eine ist weiter links orientiert, das andere zentral" — und
genau so steht es auch im Quelltext, der `text-align: left` sagt und recht behält: Der Text *ist*
linksbündig, nur eben innerhalb einer zu schmalen, mittig sitzenden Spur.

**Also eine explizite Spur deklarieren** (`grid-template-columns: 1fr`, oder `1fr max-content` für
ein angehängtes Etikett). Ein `1fr`-Track schluckt den freien Platz, und die Frage, wo der
Container ihn ausrichtet, stellt sich nicht mehr. Festgehalten in `typeScale.test.ts`.

## ⚠️ `$small` ist ein Abstand, keine Schriftgröße

`$smaller` · `$small` · `$medium` · `$large` sind 0,25 / 0,5 / 0,75 / 1,5 rem — **Gaps und
Paddings**. Die Namen lesen sich wie eine Typo-Skala, und `font-size: $small` kompiliert
anstandslos zu **8 px**: halb so groß wie der Fließtext und kleiner als alles andere in der App.

Der Fehler ist in der Datei, die ihn macht, unsichtbar — `font-size: $small` neben `gap: $small`
und `padding: $small` sieht nach *einer* konsequent benutzten Skala aus. Lint, Typecheck und Build
sagen nichts, und im Screenshot ist es eine kleine graue Zeile, also genau das, wonach ein
Untertitel aussehen soll.

⚠️ **`$medium` ist davon ausgenommen, und das ist ein Befund, keine Nachlässigkeit.** Die erste
Fassung des Zensus verbot alle vier Token und fand **neun** bestehende Komponenten mit
`font-size: $medium` (Disc-Leiste, Player-Bar, Ordner-Zeile, Seek-Bar, Now-Playing-Kopf,
Settings-Liste, Dropdown, Track-Dauer). 0,75 rem sind 12 px, das ist lesbar, und neun Dateien, die
sich einig sind, sind eine Konvention. Die Grenze läuft dort, wo Text aufhört lesbar zu sein —
nicht dort, wo die Benennung aufhört, sauber zu sein.

## ⚠️ `aspect-ratio` braucht eine Dimension zum Auflösen

`aspect-ratio: 1.5` allein ergibt nichts — es braucht Höhe **oder** Breite. Früher kam die Höhe
unbemerkt aus der globalen Button-Basis (`button { height: 2.25rem }`); **seit #244 ist diese
Basis ein reiner Reset** und liefert sie nicht mehr. Wer nur eines der beiden Maße setzt, bekommt
ein Oval — bei `border-radius: 50%` eine Ellipse. Real passiert: `.heart-button` fiel von 54×36
auf 28×28, und der Now-Playing-Reglerknopf war eine liegende Ellipse, weil nur seine Höhe
überschrieben war.

## ⚠️ Sass wertet NICHTS innerhalb eines Custom-Property-Werts aus

`--btn-pop-delay: $motion-stagger * 3` landet **wörtlich** im Stylesheet — für Sass ist das ein
undurchsichtiges Token. Kein Build-Fehler, kein Lint-Befund, keine roten Tests: im Browser ist der
Wert einfach ungültig und der `var()`-Fallback greift. Immer interpolieren: `--x: #{$token * 3}`.
Real passiert bei #240 — der ganze Staffel-Effekt aus #279 wäre still gestorben.

## Bewegung

- **Die `animation`-Kurzform setzt `animation-delay` und `-fill-mode` zurück.** Die Button-Rollen
  schreiben die komplette Kurzform, und zwar aus einem **tieferen** Selektor, als eine Zeilen-Regel
  erreichen kann — ein `animation-delay` auf den Kindern einer Reihe wurde deshalb jedes Mal
  weggewischt (gemessen: 4 von 5 Buttons bei 0 s). Werte, die eine Rolle überleben sollen, gehören
  in eine **Custom Property**, die die Kurzform liest (`var(--btn-pop-delay, 0s)`).
- **⚠️ `:nth-child` zählt ALLE Geschwister, nicht die gleichartigen.** Die gestaffelte Ankunft
  (`mem-arrival`) wird auf dem Element eingebunden und liest dessen Position — also zählt jedes
  fremde Element davor mit. Die Chart-Zeilen standen im `.chartgroup` hinter dem Tab-Kopf und
  einem `<br>`: Zeile 1 saß auf Platz 3 und bekam 90 ms, Zeile 7 fiel auf Platz 9 hinter den
  Deckel und damit auf `0s` — sie kam **vor** Zeile 1 an. Am Build gemessen (`#1 0.09s … #6 0.315s,
  #7–#10 je 0s`), im Bild unsichtbar, weil alle Zeilen ja animierten. Wer die Ankunft einbindet,
  gibt den Elementen deshalb einen Kasten, der **nur** sie enthält (`.chartrows`), statt die
  Positionen im Kopf nachzuzählen — Statusmeldungen und Pager sind bedingt, die Rechnung stimmt
  also nicht einmal dauerhaft. Festgehalten in `motionArrival.test.ts`.
- **Eine segmentierte Leiste kommt als EIN Objekt an, nie als Satz Segmente.** `mem-seg-tabs` ist
  eine Platte mit Trennlinien und `overflow: hidden`, kein Satz Chips: Staffelten die Segmente
  einzeln, risse die Platte beim Auftauchen auf und wüchse danach wieder zusammen. Die Animation
  gehört deshalb ins Mixin selbst, nicht auf `#{$item}`.
- **⚠️ Der Staffel-Deckel einer LISTE ist im RASTER ein Fehler.** `.songlist-item` staffelt die
  ersten acht Zeilen und lässt alles danach auf `0s` fallen — richtig, weil Zeile 9 unter der Falz
  steht: Niemand sieht sie früher ankommen als Zeile 8. Ein Kachelraster ist breit, und dieselbe
  Regel wird dort sichtbar falsch. Gemessen auf `/playlists` bei 1440×900: **5 Spalten, 10 Kacheln
  im Viewport** — die Plätze 9 und 10 standen also mitten im Bild und waren fertig (Deckkraft 1,00),
  während Platz 8 noch bei 0,27 lief. Die Welle liest sich rückwärts, und das sieht nach einem
  Fehler aus, nicht nach einer Staffel. Deshalb hält `#{$card-types}` alles ab der neunten Kachel
  auf der **letzten** Verzögerung (`&:nth-child(n + 9)`), statt es auf 0s zurückfallen zu lassen.
  Wer einen Deckel von einer Liste auf ein Raster überträgt, zählt also vorher die Kacheln über der
  Falz. Beide Hälften stecken seit #168 in **einem** Mixin: `mem-arrival($beyond: hold)` für alles
  nebeneinander, `mem-arrival($beyond: drop)` für alles untereinander. Neue Reihen binden das ein
  statt die Staffel ein viertes Mal auszuschreiben. Festgehalten in `motionArrival.test.ts`.
- ⚠️ **Unter „weniger Bewegung" transitioniert JEDES Element JEDE Eigenschaft.** Die Policy
  (`motion-policy.scss`) setzt `transition-duration: 0.01ms !important` auf `*` — und ein Element
  ohne eigene Transition hat als Standard `transition-property: all`. Ein vererbtes `visibility`
  sickert dadurch **einen Frame pro Verschachtelungsebene** nach unten: Gemessen war das
  Untermenü sichtbar, sein `.wrapper` und die Einträge darin zwei Frames später noch `hidden`,
  und `focus()` auf einen versteckten Eintrag scheitert wortlos (#137). Wer etwas einblendet und
  dann fokussiert, wartet deshalb auf die **Bedingung** (`utils/focusWhenVisible.ts`), nie auf
  eine geratene Anzahl Frames. Und `visibility` selbst schaltet beim Öffnen **sofort** und nur
  beim Schließen verzögert (`.context-menu`, `.children` mit `is-open`) — eine
  `visibility`-Transition startet bei Fortschritt 0, also noch `hidden`.
- **`animation-fill-mode: backwards` ist erlaubt, `both` nicht.** `both` hält zusätzlich den
  **letzten** Frame, und ein Animations-`scale(1)` schlägt jedes deklarierte `transform` — Hover
  und Press wären in allen fünf Rollen still tot. `backwards` gilt nur *während* einer Verzögerung.
- **Eine Reihe von Buttons trifft von links nach rechts ein** — `@include btn-pop-stagger` auf das
  Element, dessen **direkte Kinder** die Buttons sind. `.header-actions` bindet es ein, der
  Sortier-Banner der Alben-/Künstlerliste ebenso. Die fünf `nth-child`-Regeln nicht abschreiben:
  genau das ließ den Banner als einzige Stelle elf Chips gleichzeitig aufploppen, während die
  Header-Reihe zwei Klicks weiter staffelte.
- **Was man nicht drücken kann, darf nicht wie ein Bedienelement erscheinen.** Der Pop ist die
  Aussage „hier ist ein Button aufgetaucht". Die beiden Etiketten des Sortier-Banners (`.tt`,
  `pointer-events: none`) leihen sich `btn-action` nur für die Platte und bekommen deshalb
  `animation: none`. Wer eine Rolle für reine Geometrie borgt, prüft, was er sich an Verhalten
  mitgeholt hat.
- Das Vokabular (Dauern, Kurven, Staffelung) steht in `_motion.scss` — und wird **benutzt, nicht
  nur definiert** (#173). Die Skala existierte monatelang, während daneben die Zahlen weiter von
  Hand geschrieben wurden (66 → 72 Stellen, jede neue Animation brachte eigene Werte mit).
  `motionScale.test.ts` macht beides rot: einen Skalenwert als Literal (`0.2s` statt
  `$motion-move`) und jedes andere Literal, das nicht als **benannte Ausnahme mit Grund** in der
  Liste steht. Ausnahmen sind Schleifen und Charakterstücke (Spinner, Pulse, Lauflicht) und ein
  paar bewusst langsamere Blenden. ⚠️ Der Equalizer (`PlayingMeter.vue`) läuft **absichtlich** mit
  vier verschiedenen Dauern, damit die Balken nie im Takt sind — nie gleichziehen.

## Klick-Feedback

**Zeilen** (Nav, Playlists, gepinnte Alben, Ordner-Köpfe, Track-Zeilen) bekommen die
`v-wave`-Welle. **Buttons** bekommen das Press-Feedback ihrer Rolle und **keine** Welle — sonst
kämpfen zwei Effekte um dasselbe Element. Farbe und Dauer stehen **einmal** in `main.ts`
(`var(--mem-line)`, 0,35 s), nicht pro Aufrufstelle.

v-wave setzt `overflow: hidden` auf einen **inneren** Container und erbt den Radius vom Wirt —
Zeilenradius und absolut positionierte Drop-Marken bleiben also heil.

### ⚠️ Der Zeiger hat EINE Farbe, und sie ist keine Farbe: `--mem-hover` (#422)

Jede Hover-Fläche der App liest **ein** Token. Vorher waren es drei Quellen, von denen **zwei das
Token ignorierten**, das genau dafür da war: `candy-row-hover` und `btn-action` schrieben
`$mem-blush` von Hand, nur `btn-quiet` las `--mem-hover`. Die Zeigerfarbe zu ändern hieß also,
alle drei zu finden — und auf die Frage „ist Hover zentralisiert?" lautete die ehrliche Antwort
„halb".

Das Token ist die **Kontrastfläche**: Ink im hellen, Paper im dunklen Theme. Keine Akzentfarbe,
und zwar weil keine übrig ist — Blush ist die **Etikettenfarbe** (der LIBRARY-Sticker), die sechs
Navigationsfüllungen verbrauchen die Palette, Teal heißt Wiedergabe und Gelb heißt „läuft". Ink
als *Fläche* gibt es sonst nirgends, deshalb liest es sich als Zustand statt als weitere Farbe.

**Zwei Tokens wandern zwingend mit der Füllung** — und das helle Theme verbirgt eines davon:

| Token | wofür |
|---|---|
| `--mem-hover` | die Fläche |
| `--mem-hover-text` | **alles darauf.** Die Fläche ist im hellen Theme dunkel; Ink darauf ist unsichtbar |
| `--mem-hatch-hover` | die Textur: Paper-Striche auf der Ink-Platte, Ink-Striche auf der Paper-Platte |

⚠️ **Wer Ink auf gefüllten Zeilen pinnt, muss den Hover-Fall ausnehmen.** `SongItem.vue` hatte
einen Block „Filled row states", der `:hover`, `.current` und `.contexton` gemeinsam auf Ink
setzte — richtig, solange alle drei Füllungen hell waren. Seit die Hover-Füllung die dunkle ist,
steht `:hover` in einem eigenen, gespiegelten Block.

**Und was lauter sein will als der Hover, rückt nach.** `.songlist-item.contexton` („diese Zeile
besitzt das offene Kontextmenü") nimmt jetzt Blush, das der Hover freigemacht hat: Es schlägt
„der Zeiger ist hier" weiterhin in **Dauerhaftigkeit** — es überlebt, dass der Zeiger weggeht —,
nicht mehr in Lautstärke.

Der Zensus ist getestet (`src/components/__tests__/hoverToken.test.ts`): Er lässt keine
Hover-Regel durch, die eine Füllung aus einem Akzent statt aus dem Token malt, und kein
Hover-Mixin, das die Fläche tauscht ohne die Textfarbe. Beim allerersten Lauf fand er
`btn-pill` — Modal- und Dialog-Buttons hoverten auf `$candy-pink-deep`, was auf **`$mem-yellow`**
zeigt: ein Dialog-Button war für die Dauer des Zeigers ein „läuft"-Signal.

**Hover für Listenzeilen ist zentralisiert:** `candy-row-base` + `candy-row-hover` in
`_candy.scss`. Die Base-Hälfte ist Pflicht (reservierter transparenter Rand in `$candy-border-w`)
— ohne sie springt der Inhalt beim Hover, und genau deshalb hatten die Folder-Zeilen
(`border: none`) gar keinen Rahmen. „Flach" heißt bei Sidebar- und Queue-Zeilen **kein
Offset-Schatten**, nicht „kein Rahmen": gehoverte Zeilen sind überall gerahmt.

**Beide Hälften werden als Mixin genommen, nie von Hand ausgeschrieben.** Eine Zeile, die den
transparenten Rand selbst deklariert, behält zwar die Reservierung, verliert aber den Hinweis,
dass da ein Rahmen kommt — und das danebenstehende handgeschriebene
`&:hover { background-color: … }` sieht dann vollständig aus, obwohl es keinen Rahmen malt. Genau
so blieb der **Ordner-Kopf der Sidebar** die einzige Bibliotheks-Zeile ohne Rahmen, nachdem
Nav-Zeilen und Playlist-Zeilen schon gefixt waren — auffällig nur im direkten Vergleich mit der
Zeile eine Reihe darüber. Der Zensus dazu ist getestet
(`src/components/__tests__/rowHover.test.ts`): Er kennt jede Zeile, die eines der beiden Mixins
benutzt, verlangt für jede **beide** Hälften, und lässt in der Sidebar keine Hover-Regel durch,
die eine Zeilen-Fläche (`$candy-pink-soft`, `$mem-panel-static`, `$mem-blush-soft-static`) ohne
`candy-row-hover` setzt.

### ⚠️ Der Zeigerwechsel ist ein SCHNITT, kein Fade

Seit die Hover-Füllung die Kontrastfläche ist, wechseln Füllung und Text beim Hovern in
**entgegengesetzte Richtungen** (Fläche hell→dunkel, Text dunkel→hell). Eine Farb-Transition hat
deshalb zwingend einen Mittel-Frame, in dem **beide grau** sind: der Kontrast bricht kurz
zusammen, und der Wechsel liest sich, „als legte sich das Schwarz an zwei Stellen
unterschiedlich über die Farbe" (so der Nutzerbericht wörtlich). Die Schraffur kann ohnehin
nicht faden — sie ist ein Bild-Tausch — und lief daher immer sichtbar neben jedem Fade her.

**Die Regel:** Farbe (Füllung, Rahmen, Glyphe, Textur) schaltet in **einem Frame** um; nur die
**Bewegung** bleibt weich (`box-shadow $motion-shadow`, `transform $motion-press`) — der Knopf
hebt sich fühlbar, aber die Farbe ist sofort da. In einer `transition`-Liste der Rollen und
Zeilen-Mixins hat keine Farb-Eigenschaft etwas verloren. Der Fade stammte aus der Zeit, als
Hover eine **gleichsinnige** Blush-Tönung war — dort gab es kein Kreuzen. Gleichsinnige Tönungen
abseits des Zeiger-Tokens (z. B. das Gelb des Kontextmenü-Eintrags) dürfen weiter faden.

Der Zensus dazu steckt in `hoverToken.test.ts` („the pointer flip is a cut"): In `_candy.scss`
und `Global/_buttons.scss` darf keine `transition` eine Farb-Eigenschaft nennen. Entschieden in
der Mockup-Runde `Desktop\AivinNet\mockups\hover-sync\` (vier Timing-Varianten, Zeitlupe): der
harte Schnitt schlug 0,07-s-Fade und Stufen-Timing.

## ⚠️ `:hover` latcht auf Touch — nie zum Verstecken nutzen

Auf dem Handy bleibt der Hover-Zustand nach dem ersten Tap hängen. Die mobile Seek-Bar hatte
genau das: `.b-bar:hover #progress::-webkit-slider-thumb { display: none }` — der Knopf verschwand
also, sobald man ihn anfasste. Für Drag-Controls gilt: sichtbarer Knopf, Touch-Größe
(`range-geometry` auf dem Wrapper) und **`touch-action: none`** auf dem Input, sonst frisst der
Page-Scroll die horizontale Geste.

### ⚠️ Ein Zeilen-Hover wird an der QUELLE gegatet, nicht per Breite neutralisiert (#457)

Die Track-Zeile trug beides gleichzeitig: in `app-grid.scss` eine breiten-gekoppelte
Halb-Maßnahme (`„disable hover on mobile"`, `background-color: unset`, Spezifität 0,3,0) und in
`SongItem.vue` den unveränderten Text-Flip. Die erste schlug damit auch die **gelbe Füllung der
laufenden Zeile** (0,2,0), die zweite malte weiter weiß — nach einem Tap stand die laufende Zeile
transparent da, mit weißer Künstlerzeile auf hellem Grund (gemessen: `bg rgba(0,0,0,0)`,
`artist rgb(255,255,255)`).

**Die Ursache ist die Achse, nicht die Zahl.** Breite ist nicht Zeigerfähigkeit — ein schmales
Desktop-Fenster verlor seinen Hover, ein Touch-Tablet behielt ihn. Und weil so eine Maßnahme
immer nur die Hälfte trifft, an die man gerade denkt (die Füllung), bleibt der Rest stehen. Also:
**`@media (hover: hover)` um die Hover-Regeln selbst**, dort wo sie stehen.

Drei Dinge, die dabei jedes Mal auffallen — und zwei davon erst beim Messen:

- **`:not(:hover)` ist ein Hover-Test in Verkleidung.** Die Inlay-Ebenen (Farbleitband,
  Perforation, Ink-Streifen) hingen daran. Sobald die Füllung gegatet ist, reißt dieses `:not`
  beim gelatchten Tap — und weil nun *nichts* mehr an ihre Stelle malt, verliert die Zeile ihre
  komplette Anatomie. Die Ausnahme gehört als **eigene gegatete Regel** hinter die Basis-Blöcke
  (sie zieht bei (0,5,0) mit der `.is-last`-Variante gleich, also entscheidet die Reihenfolge).
- **Gaten nimmt weg, was nur über den Latch erreichbar war.** `.heart-icon` ist
  `visibility: hidden` und wurde allein vom Zeilen-Hover enthüllt — auf Touch also nur, weil der
  Tap hängen blieb. Ein Gate ohne Gegenstück macht daraus ein dauerhaft unsichtbares
  Bedienelement (auf dem Tablet; Phones sind unter 460 px ohnehin `display: none`). Jedes Gate
  braucht deshalb die Frage „und wie kommt Touch da jetzt dran?" — Antwort ist ein
  `@media (hover: none)`-Zweig, wie ihn `_mixins.scss` für den Karten-Play-Button schon hat.
- **Sichtbar latchen nur Zeilen, die NICHT navigieren.** Charts- und Ordner-Zeilen wurden
  gemessen (`latched: false`): Ein Tap wechselt dort die Route, das Element rendert neu, der
  Latch ist weg. Track-Zeilen spielen in-place ab und bleiben unter dem Finger stehen — deshalb
  sind sie der Sonderfall und nicht „die erste von vielen".

Aufgezählt wird über das **gemeinsame Merkmal** („Komponente, die eine Track-Zeile auf Hover
gestaltet"), nicht über das Symptom: Zwei der fünf Wirte malen gar keine Füllung
(`TrackTitle.vue` richtet nur das gekippte Cover gerade, `app-grid.scss` die Ebenen oben) und
wären beim Suchen nach dem sichtbaren Fehler durchgerutscht. Der Zensus dazu steht in
`rowHover.test.ts` („track row hover is pointer-gated"): In den vier Track-Zeilen-Komponenten
muss jede `:hover`-Regel innerhalb eines Gates liegen.

## ⚠️ iOS feuert kein `contextmenu` — Menüs über `v-context-menu`, nie `@contextmenu` allein

iOS Safari löst für einen langen Druck **kein** `contextmenu` aus (Android schon, Desktop per
Rechtsklick und Menütaste). Die Kacheln tragen bewusst keinen ⋮-Knopf (`Global/cards.scss`) —
mit `@contextmenu.prevent` allein war auf dem iPhone also **kein einziges** Kachelmenü erreichbar,
und niemand merkte es, weil jeder Test am Desktop oder unter Android lief.

`v-context-menu="handler"` (`directives/vContextMenu.ts`) bindet beides: `contextmenu` und einen
eigenen Long-Press (500 ms ruhiger Finger; Bewegung > 10 px, Scroll, zweiter Finger oder
`touchcancel` brechen ab). Worauf es ankommt, falls jemand daran schraubt:

- **Den Klick danach schlucken.** Der gehobene Finger erzeugt sonst einen Klick, der dem Link der
  Kachel folgt und einen Moment später als Klick *außerhalb* des gerade geöffneten Menüs zählt
  (`ContextMenu.vue`) — Menü zu, Seite weg. Primär über ein abgebrochenes `touchend`, dazu ein
  Capture-Klickfilter mit **Frist** statt Flag: ein Flag bliebe stehen, wenn gar kein Klick kommt,
  und fräße den nächsten echten (Maus, Enter auf der fokussierten Kachel). „Hat geöffnet" hängt am
  Gesten-Merker (`fired`), **nicht** daran, ob die Geste noch läuft: Scrollt das Öffnen des Menüs
  (Fokus) oder rutscht der Finger danach Richtung Menü, bricht die Geste ab — der Klick beim
  Loslassen kommt trotzdem.
- **Nicht doppelt.** Android schickt ein natives `contextmenu` etwa gleichzeitig mit dem Timer,
  Chrome auf Windows-Touchscreens erst **nach** dem Loslassen. Das Menü-Store *toggelt* — der
  zweite Aufruf schlösse das Menü wieder. Wer zuerst kommt, gewinnt; der Nachzügler wird bis zum
  Ende der Klick-Frist der Geste zugerechnet. ⚠️ Headless-Chromium erzeugt aus CDP-Touch **kein**
  natives `contextmenu` (gemessen: `trusted=0`) — dieser Zweig ist nur per Unit-Test belegt.
- **Echte Koordinaten mitgeben.** Das Store verankert ein Menü ohne Zeigerposition (`x===0 &&
  y===0`) an der Kachelecke; der Long-Press dispatcht deshalb ein echtes `contextmenu` am Finger.
- Die Direktive setzt `data-context-menu`; `Global/basic.scss` hängt daran
  `-webkit-touch-callout: none` (sonst legt iOS Link-Vorschau bzw. „Bild sichern" über das Menü)
  und `user-select: none` nur unter `any-pointer: coarse` — mit der Maus bleiben Namen
  markierbar. Keine Inline-Styles: `-webkit-touch-callout` kennt außer Safari keine Engine, der
  Wert ließe sich also nirgends sonst prüfen, und ein `:style`-String würde ihn überschreiben.

Der Zensus in `cardAnatomy.test.ts` verlangt `v-context-menu` auf der Wurzel **jeder** Kachel und
verbietet `@contextmenu` darin; bewusst menülose Kacheln stehen mit Begründung in `NO_MENU`.
Außerhalb der Kacheln nutzt es bisher nur die Ordner-Zeile (`FolderItem.vue`). Mit
`@contextmenu` allein stehen noch `SongItem` (hat einen ⋮-Knopf), `SidebarPlaylistItem` und die
Ordner-/Album-Zeilen in `LeftSidebar/index.vue` — wer dort anfasst, stellt um.

## Der Bearbeiten-Modus der Playlist ist eine eigene, NICHT virtualisierte Liste

`components/PlaylistView/EditList.vue` (Griff zum Umsortieren, Knopf zum Entfernen) rendert alle
Tracks ohne `DynamicScroller`: Eine Zeile, die gerade am Finger hängt, darf beim Scrollen nicht
recycelt werden. Die Zeilen tragen trotzdem `.songlist-item` — Platte, Band, Perforation und
Rahmen kommen aus derselben Quelle wie die Songliste, nur das Grid ist eigenes (entfernen · Cover
· Titel · Griff, **keine** Dauer-Spalte; `songlistDurationColumn.test.ts` nimmt `.edit-row`
deshalb aus). Drei Dinge dazu:

- **⚠️ Das Ziehen schreibt die Offsets direkt an die Zeilen, nicht in reaktiven Zustand.** Ein
  Finger feuert bis zu 60 Moves pro Sekunde, und mit den Offsets im State rendert jeder davon die
  **ganze** Liste neu — hier sind das bis zu rund tausend Zeilen. Vue hört vom Drag genau zweimal
  (Anheben, Ablegen); dazwischen schreibt `followFinger()` nur die Zeilen zwischen alter und neuer
  Landestelle. `EditList.test.ts` zählt die Renders über einen Spion auf `trackBandFade`.
- **Griff und Minus nehmen die Farbe der Zeile** (`color: inherit` nach `btn-quiet`). Die Rolle
  pinnt `$mem-content-text`; auf einer gehoverten Zeile ist die Fläche aber die Ink-Kontrastfläche,
  und der Griff verschwand genau dann, wenn der Zeiger nach ihm griff.
- **Der Griff hat `touch-action: none`, die Zeile nicht.** Sonst frisst entweder der Seiten-Scroll
  die Ziehgeste, oder die ganze Liste lässt sich mit dem Finger nicht mehr scrollen.
- **Auf dem Handy tritt die Player-Leiste zur Seite** (`#app-grid.editing-playlist`,
  `app-grid.scss`), der Scroller reserviert dann keine Bar, nur den Home-Indikator. Die Klasse
  setzt `App.vue` aus `playlist.editing`; beim Verlassen der Route wird der Modus **sofort**
  beendet, nicht mit dem verzögerten `resetAll()` — sonst öffnete die nächste Seite ohne Leiste.
- **Die Kopfleiste („Edit order · N" + „Done") klebt oben** — „Done" muss in einer langen Liste
  überall einen Tipp entfernt sein. Sie klebt um ihr eigenes `padding-top` über der Kante, damit
  der Balken selbst an der Kante sitzt. Sie wohnt **in** `EditList`, nicht in der Seite: Sie zählt
  die Zeilen auf dem Schirm (eine Löschung im Undo-Fenster ist dort schon weg), und „Done" muss
  diese Löschung abschließen, bevor der Modus zugeht.
- **Der Wechsel zwischen den Modi behält die Scroll-Position** (`PlaylistView/index.vue`): Kopf,
  Leiste und 72-px-Zeile sind in beiden gleich, ein Offset meint also dieselbe Stelle. Sonst warf
  „Done" in einer langen Playlist an den Anfang zurück.

## ⚠️ Regler-Geometrie hat EINE Quelle

`range-geometry($h, $thumb)` in `_candy.scss` setzt `--range-h` (Leistenhöhe), `--range-thumb`
(Knopfdurchmesser) und das daraus abgeleitete `--range-track`. Die Zentrierung wird **berechnet**,
nicht geraten — ein fester `margin-top` kann nur zu genau einem Paar aus Leiste und Knopf passen,
und es gab vier.

Die Variablen gehören auf den **Wrapper** (`.progress-wrap`), nicht auf den `input`: der
Textur-Overlay ist ein *Geschwister* des Inputs und sieht dort gesetzte Werte nie.
`ProgressBar.scss` liest nur noch, immer mit Fallback.

⚠️ **Eine Knopf-Messung ist blind für Geschwister-Overlays.** Ein `margin-top` auf dem
Regler-`input` bläht den Wrapper auf (Inline-Block: die Margin-Box zählt zur Zeilenbox), ohne die
Mitte des Inputs mitzubewegen → Knopf und Overlay 7 px auseinander, während jede Knopf-Messung
±0,00 px meldet. **Abstände gehören auf den Wrapper.**

Und eine Stufe höher dasselbe Prinzip: Steht der Wrapper selbst in einer Zeile (seit #154 flankieren
die Zeit-Pillen die Leiste im Now-Playing-Kopf), gehört der Abstand an die **Zeile**. Auf dem
Wrapper würde er die Leiste aus der Mittellinie ihrer Nachbarn schieben.

## ⚠️ `space-between` verteilt nur POSITIVEN Freiraum — Abstände in einer gedeckelten Zeile ableiten

Eine Steuergruppe, die zentriert mit einem festen Abstand stehen soll, baut man **nicht** aus
`gap` + `justify-content: space-between`. Ein `gap` ist eine feste Länge: Wird die Zeile schmaler
als der Inhalt, bleibt er stehen und die Reihe **läuft über** — `space-between` kann keinen
negativen Freiraum verteilen. Real passiert (#157): vier 44-px-Controls mit `gap: $bar-gap` =
236 px in einer 212-px-Zeile auf einem 320-px-Gerät; der letzte Button lag 24 px außerhalb und
wurde von der Kartenkante abgeschnitten. `docOverflow` war dabei **0** — die Kante clippt, das
Dokument scrollt nicht, kein Overflow-Check schlägt an.

Stattdessen den Abstand **ableiten**: Gruppe auf ihre Cluster-Breite deckeln, `gap: 0`, und
`space-between` genau diesen Rest verteilen lassen.

```scss
.right-group {
    $controls: 4; // was die Zeile hier wirklich rendert

    width: 100%;
    max-width: calc(#{$controls} * #{$bar-control} + #{$controls - 1} * #{$bar-gap});
    margin: 0 auto;
    gap: 0;
    justify-content: space-between;
}
```

Damit steht die Gruppe dort, wo sie passt, exakt `$bar-gap` auseinander (gemessen: 20 px bei
430/390/360) und darunter enger (12 px bei 320) — die **44-px-Touch-Ziele** bleiben ganz, und das
ist die richtige Reihenfolge: Nachgeben soll die Luft, nicht das Ziel für den Finger.

Zwei Dinge, die dazugehören: Die Anzahl im Deckel ist eine **Kopplung an das, was die Zeile
rendert** — sie gehört als benannte Variable mit Kommentar dorthin, nicht als nackte Zahl. Und
geprüft wird das an den **Button-Rechtecken**, nicht am Gruppenkasten: Der Kasten meldete brav
212 px Breite, während seine Kinder bei 290 px endeten.

## ⚠️ Eine Trennlinie gehört der Textseite, nicht der Medienzelle

Ein `border-right` auf einem Element mit `border-radius` wird **entlang dieses Radius gezeichnet** —
auf einem runden Element also als Bogen, nicht als gerade Linie. In der Now-Playing-Quelle
(`PlayingFrom.vue`) trägt das Vorschaubild auf der **Artist**-Quelle `.circular`
(`border-radius: 10rem`), auf der Album-Quelle `rounded-sm` und beim Playlist-Fall gar keinen —
dieselbe Regel ergab drei verschiedene Bilder, und ausgerechnet der geprüfte Fall (Playlist,
eckiges Glyph-Feld) sah richtig aus.

Die Regel: **Die Linie zwischen zwei Zellen gehört an die Kante, deren Form man kennt.** Als
Geschwister-Paar formuliert (`img + .from-text, .from-icon + .from-text`), damit sie nur erscheint,
wenn wirklich etwas davorsteht — bei leerer Queue rendert `playingFrom()` weder Bild noch Glyph.

Allgemeiner: Eine Medienzelle kann ihre Form von einer Utility-Klasse bekommen, die die View gar
nicht setzt. Wer eine Kante auf so eine Zelle legt, prüft **jede** Quelle einzeln — Element-
Screenshot pro Variante, nicht nur die, die man gerade offen hat.

⚠️ **Die Beschriftung dieser Platte kommt aus `playingFrom()`, nicht aus dem Enum** (#508). Sie
stand als `tracklist.from.type` im Template, also druckte `text-transform: uppercase` bei zwei
von acht Quellen dasselbe zweimal (`SEARCH` über `Search for: …`) und bei einer den Bezeichner
(`PLAYLISTFOLDER`). Bei der Suche kostet das mehr als ein Wort: Beschriftung + `Search for:` +
Lupe sind zusammen die Anatomie des **Suchfelds** (`RightSideBar/SearchInput.vue`), und auf dem
Handy ist diese Platte das oberste Element des Now-Playing-Schirms — ohne Top-Bar daneben, an der
man den Unterschied ablesen könnte. Gemeldet als „warum ist beim Song oben ne Suche?". Beschriftung
und Name stehen jetzt nebeneinander in derselben Funktion und lassen sich gegeneinander lesen;
`playingFrom.test.ts` verbietet, dass die eine in der anderen vorkommt.

## ⚠️ Ein Kind im Scroller deckt den Scrollbar-Gutter NICHT

Ein absolut positioniertes Kind spannt die **Padding-Box** seines Containing Blocks. Der Gutter,
den die Content-Scroller auf beiden Seiten reservieren (`scrollbar-gutter: stable both-edges`,
dort für die zentrierte Spalte), liegt **außerhalb** davon. `left: 0; right: 0` heißt in einem
Scroller also **nicht** „volle Breite" — es fehlt je `$scrollbar-w` links und rechts.

So verlor der Seiten-Verlauf auf Playlist, Album und Artist einen 12-px-Streifen nacktes
Rasterpapier an jeder Kante, über die volle Höhe des Kopfbands (#483). Sichtbar für den Nutzer,
unsichtbar in jeder einzelnen Datei: das Decor sagte `0` und meinte „ganz", der Gutter stand drei
Regeln weiter oben aus einem anderen Grund, und die 12 px selbst lebten als Literal in einer
dritten Datei.

**Und Zurückgreifen reicht nicht** — das war der zweite Anlauf (#540). Der rechte Gutter ist
kein leerer Platz, er trägt die **echte Scrollbar**, und Chrome clippt gescrollten *Inhalt* am
Scrollport, während es die Scrollbar in einer eigenen Ebene darüber malt. Kein `left`/`right`
erreicht diese Pixel: sie gehören der Scrollbar, nicht dem Inhalt. Nach #483 blieb der Streifen
rechts deshalb stehen — links verschwand er, weil dort nur reservierter Leerraum liegt. „Links
passt, rechts nicht" ist die Signatur genau dieses Fehlers.

Was die Fläche erreicht, ist eine Ebene **hinter** dem Scroller (dessen Elternteil), die der
transparente `::-webkit-scrollbar-track` durchscheinen lässt. Gemessen auf der laufenden App
(Playlist 11, 3399 px, Rinnen gegen die Mitte):

| Träger | linke Rinne | Mitte | rechte Rinne |
| --- | --- | --- | --- |
| Kind des Scrollers | 90,88,118 | 90,88,118 | 244,242,237 ❌ |
| Scroller-Hintergrund, `local` | 244,242,237 ❌ | 90,88,118 | 244,242,237 ❌ |
| Hintergrund von `.v-scroll-page` | 90,88,118 | 90,88,118 | 90,88,118 ✅ |

⚠️ `background-attachment: local` ist **keine** Abkürzung: Chrome clippt auch diesen Hintergrund
am Scrollport und verliert damit *beide* Rinnen. `repeat-x` heilt das nicht — geclippt wird die
Malfläche, nicht die Positionierungsfläche. Ein Hintergrund hinter dem Scroller scrollt dafür
nicht von selbst mit; die Kopplung macht `--veil-scroll`, geschrieben vom globalen Scroll-Handler
in `App.vue` — und der muss auf den Seiten-Scroller eingegrenzt sein, weil horizontale Karussells
dauerhaft `scrollTop === 0` melden und den Schleier sonst nach oben zurückschnappen lassen.

⚠️ **Headless kann diesen Fehler nicht sehen**: Chromium malt dort überhaupt keine Scrollbar,
selbst ein deckend roter Track ändert am Screenshot nichts. Der Streifen misst sich headless
immer sauber — so wurde #483 abgenommen. Alles, was die äußersten `$scrollbar-w` betrifft, gehört
in einen echten Browser (Preview-Build auf eigenem Port). Die Stellen hängen am Token
`$scrollbar-w` und werden von `scrollbarGutter.test.ts` zusammengehalten.

## ⚠️ Eine halbe Kante ist keine Kante — und ein sticky Kopf ist eine Platte

Eine einzelne `border-bottom` liest sich nur als Kante, wenn sie an **beiden** Enden in einen
Rahmen einläuft. Im Scroller tut sie das nie: er trägt `$alt_layout_pad` seitliches Padding, also
hörte die Linie des Ordner-Kopfbands 44 px vor dem Ink-Rahmen der Content-Karte auf und schwebte —
3 px über dem eigenen Rahmen der Ordner-Platte, zusammen als 6-px-Doppelstrich. Der Nutzer meldete
es als „bei /music oben fehlt der Rand" (#489).

**Ein sticky Kopf über einer scrollenden Liste ist Chrome, also eine Platte:** `candy-box` +
`candy-shadow(3px, 3px)`, opak (`$mem-panel`, siehe die Veil-Regel oben), Rahmen auf **allen vier**
Seiten. Vorbild ist `LyricsView/Head.vue`. Halbe Kanten gibt es in diesem Design nicht.

Drei Mechanismen, die daran hängen — jeder hat beim Bauen einen Anlauf gekostet:

- **Der Scope muss der Render-Bedingung folgen.** Der Kopf sitzt im Scroller, wenn
  `is_alt_layout || isMedium || isSmall` (der `#before`-Slot). Auf `.is_alt_layout` allein gescoped
  hatten die Medium- und Phone-Layouts einen Kopf **ohne jede Fläche** — Text direkt auf dem
  Doodle-Grund. Bedingung im Template und Selektorliste im Style sind EIN Paar; der Zensus
  `folderHeadPlate.test.ts` liest die `v-if` und verlangt für jedes Flag eine Regel.
- **Abstände im Scroller-Slot gehören in die CONTENT-Box.** `vue-virtual-scroller` misst den Slot
  per ResizeObserver (Content-Box) und setzt die Zeilen direkt dahinter: `padding` am Slot ist für
  ihn unsichtbar (gemessen: Zeilen starteten 8 px *innerhalb* des Paddings), eine Margin am Kind
  kollabiert hindurch. `display: flow-root` am Slot + Margin am Kind zählt — und die Margin
  **wandert mit**, wenn die Platte klebt.
- **`top` bleibt 0.** Ein Offset schiebt das sticky Element nach unten von seiner Flow-Position,
  während die Zeilen liegenbleiben — er frisst also genau den Abstand darunter. Luft über einer
  sticky Platte deshalb **nie** als `padding-top` des Scrollers: Blink zieht dessen Padding von der
  Klebekante ab, die Spec nennt den Scrollport. Als Margin an der Platte ist es engine-egal
  (gemessen Chromium **und** Firefox: 8 px oben, im Ruhe- wie im Klebezustand).

## ⚠️ Ein zentriertes Fenster mit Tabs braucht EINE Höhe

Ein Dialog, dessen Höhe dem Inhalt folgt, **wandert mit jeder Auswahl** — und weil er zentriert
sitzt (`place-items: center`), bewegen sich alle vier Kanten, nicht nur die untere. Beim
Settings-Fenster hieß das (gemessen bei 1440×900, vor #492): Appearance bei `y=32 h=836`, jeder
andere Bereich bei `y=113 h=674` — der Schließen-Knopf und die ganze Navigationsliste sprangen um
81 px zwischen zwei Klicks. Der Nutzer meldete es als „das Fenster springt hin und her".

Die Regel: **Höhe aus einem Token (`$settings-modal-h`), gedeckelt vom Fenster**
(`height: min($token, calc(100% - Xrem))`) — und der Inhalt scrollt in dem stehenden Rahmen. Ein
`max-height` ist kein Ersatz: es ist genau die inhaltsabhängige Größe, die das Springen erzeugt.

Zwei Stellen hängen dran, beide leicht zu übersehen:

- **Das Kind braucht `flex: 1`.** Sobald der Rahmen eine eigene Höhe hat, hört ein inhaltsgroßes
  Kind vorher auf — der Rahmen der Seitenliste hängt dann in der Luft.
- **`100dvh` neben `100vh`** auf dem Modal-Wrapper (Reihenfolge wie bei `body`). Eine feste Höhe ist
  nur richtig, wenn der Wrapper der **sichtbare** Viewport ist; `100vh` rechnet die Browser-Leiste
  des Handys nicht ab, und die unteren Zeilen liegen dann darunter — erreichbar per Scroll, aber
  nie sichtbar. Headless bei 390/360 fällt das **nicht** auf.

Der Zensus `settingsModalHeight.test.ts` hält beide Stellen. ⚠️ Ein Zensus über eine Regel mit
Breakpoint-Override braucht **beide** Vorkommen: die erste Fassung zählte einen Treffer, und eine
Mutation der Desktop-Regel auf `max-height` blieb grün, weil der Phone-Override das Muster erfüllte.
Solche Tests gegen Mutationen prüfen, nicht nur gegen den Ist-Zustand.

## Weitere Fallen

- **Abstand nie als INHALT schreiben** (`<br>`, `&nbsp;`). Was als Text im Markup steht, sieht keine
  Regel und kein Rhythmus kann es einschließen — und es driftet garantiert von den Nachbarn weg. Im
  About-Bereich standen beide Varianten (#495): `<br /><br />` vor der Links-Gruppe und vier
  `&nbsp;` als Polster im „Reset client"-Label, obwohl `btn-pill` seit immer `padding: 0 $medium`
  trägt (der Knopf war dadurch 138 statt 114 px breit). Symptom war ein anderes: die Reihen der
  Link-Pillen hatten 16 px Abstand, der Reset-Knopf **0** — der Offset-Schatten stieß an den Knopf
  darunter. Ein Pane bekommt **einen** Schritt, Gruppen setzen sich mit dem doppelten ab.
- **CSS-Spezifität statt `!important`.** `.b-bar .with-time button{background:transparent}` (0,2,1)
  schlug `.hotkeys .play` (0,2,0) → weißer Play-Kreis wurde transparent. Fix an der Quelle:
  `button:not(.play)`. Wenn ein Style nicht greift: computed style im Headless-Browser prüfen.
- **„Kasten/Box" um einen Detail-Header ist ein `box-shadow`, nicht der Verlauf.** Der abgerundete
  Schatten-Kasten kam vom `.album-header-ambient`-Element, nicht vom Hintergrund; mehrere Anläufe
  scheiterten, weil sie am Verlauf suchten. Allgemein: ein gerundeter Rahmen oder Halo ohne
  sichtbaren Fill ist fast immer ein `box-shadow`.
- **Layout-Grid:** `#app-grid` Zeilen `max-content minmax(0,1fr) 5.125rem` — `minmax(0,...)` ist
  kritisch, sonst schiebt eine hohe Sidebar die Bottom-Bar aus dem Viewport.
- **Farbsystem:** `setColorsToStore` wählt die *dominante* Farbe (nicht die gesättigtste),
  `getTextColor` entscheidet luminanz-basiert. Der Seiten-Verlauf ist **zentral** in
  [`pageGradient()`](../../src/utils/colortools/pageGradient.ts) — nicht pro View duplizieren.
- **Brand-Farben haben eine Quelle:** `src/brand-colors.json`. Nicht hardcoden.

## ⚠️ Eine Daueranimation muss aufhören können

Nur `transform` und `opacity` laufen auf dem Compositor. Alles andere — auch eine per
`@property` registrierte Variable, die in einen Verlauf fließt (`--np-angle` → `conic-gradient`
im Lauflicht) — stößt **jedes Frame** Style + Paint auf dem Main-Thread an, solange der Tab
sichtbar ist. Das Lauflicht lief so dauerhaft in der Bottom-Bar, auch ohne Wiedergabe; es war
die einzige Endlos-Animation auf einer ruhenden Seite (Zensus per `document.getAnimations()`).
Seitdem pausiert `body.lauflicht-idle` beide Schichten, solange `queue.playing` falsch ist
(`utils/lauflicht.ts`, Test `utils/__tests__/lauflicht.test.ts`).

Wer eine neue `infinite`-Animation baut: entweder `transform`/`opacity`, oder an einen Zustand
koppeln, der auch wieder endet. **Pausieren über `animation-play-state`, nicht über
`motion-policy.scss`** — die erzwingt Dauer und Wiederholung mit `!important`, nie den
Play-State, und das muss so bleiben.
