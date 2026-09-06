# UI selbst verifizieren (Headless)

Werkzeugkiste und Befehle, um eine Änderung an der **laufenden, eingeloggten** App zu prüfen,
statt sie zu behaupten. Die Grundregeln dazu stehen in [CLAUDE.md](../CLAUDE.md); hier steht,
womit man sie einlöst.

Alles liegt auf dem Server unter `~/uitest` (Playwright mit **Chromium und Firefox**).

## Zuerst: JWT prägen

Ohne Token rendert nur die App-Shell. In `~/AivinNet`:

```bash
~/.local/bin/uv run python -c "from aivinnet.app_builder import app, config_jwt; \
from aivinnet.db.userdata import UserTable; from flask_jwt_extended import create_access_token; \
config_jwt(app); app.app_context().push(); \
print(create_access_token(identity=list(UserTable.get_all())[0].todict()))"
```

⚠️ Das Paket heißt **`aivinnet`**, nicht mehr `swingmusic` — mit dem alten Namen antwortet der
Befehl `ModuleNotFoundError` und man hat ein leeres Token, das erst beim Messen auffällt.

Dann als Cookie verwenden: `curl -H "Cookie: access_token_cookie=$TOKEN" …`

⚠️ **`sub` muss ein Dict sein, kein JSON-String** — der `user_lookup_loader` macht
`jwt_data["sub"]["id"]`. Ein `json.dumps({"id": 1})` als `sub` ergibt **HTTP 500 auf jedem
Endpoint**, während die Shell weiter rendert: Chrome und Nav sind da, aber null Playlists und
null Alben. Sieht aus wie ein kaputtes UI, ist ein kaputtes Token.

Beim Prägen mit PyJWT (Secret `serverId` aus `~/.config/aivinnet/settings.json`):

```python
pyjwt.encode({"sub": {"id": 1}, "iat": …, "nbf": …, "exp": …,
              "type": "access", "fresh": False, "jti": …}, cfg["serverId"], algorithm="HS256")
```

**Vor jedem Messlauf einmal gegenprüfen:**
`curl -H "Cookie: access_token_cookie=$T" localhost:1970/auth/user`

## Die Skripte

| Skript | wofür |
|---|---|
| `shot.js` | Screenshot: `TOKEN=… CLIP=x,y,w,h OUT=…png node shot.js` |
| `shot2.js` | die flexible Variante: `ROUTE=/playlist/3 MOBILE=1 W=390 H=844 OUT=… node shot2.js`; kennt `BASE`, läuft also auch hinter dem Preview-Proxy. **`THEME=` wirkt nicht mehr — für Dark `darkshot.js` nehmen**, siehe unten |
| `darkshot.js` | Dark-Mode-Screenshots über den **echten** Toggle: `ROUTES="name=/route\|name2=/route2" node darkshot.js`. Klickt `button.theme-toggle` und bricht ab, wenn `body.theme-dark` fehlt |
| `debug.js` | computed styles auslesen — für „warum greift mein CSS nicht" |
| `rangeshot.js` + `rangemeasure.py` | Regler-Geometrie in **Pixeln**, Chromium und Firefox |
| `wavecheck.js` | welches Element beim Klick eine `v-wave`-Welle wirft, mit Farbe und Dauer |
| `popcheck.js` | liest die **laufende** Transform-Matrix aus, statt der Keyframe-Deklaration zu glauben |
| `coldpop.js` | **welche Buttons ploppen wirklich**, pro Route kalt geladen: `TOKEN=… [MOBILE=1] node coldpop.js "#/albums" "#/playlist/60"` |
| `popaudit.js` | derselbe Befund über alle Routen in **einer** SPA-Sitzung, plus Staffel-Soll/Ist je Header-Reihe; kennt `REDUCED=1` |
| `popframes.js` | tastet die laufende Skalierung **aller** Buttons einer Reihe ab (0,82 → 1,05 → 1,00) und schneidet einen Filmstreifen |
| `btnaudit.js`, `bordermeasure.js`, `audit-shadows.js`, `mobile-audit.js` | Computed-Style-Audits über Routen × Themes |
| `topbar-audit.js` | eine **Reihe** als Ganzes: Box, Glyph, Rahmen, Schatten je Bauteil — plus Hover und Press als **laufende** Matrix (echtes `hover()` und `mouse.down()`, nicht die Deklaration) und die Pops beim Boot. `ROUTE=`, `MOBILE=1`, `BASE=` |
| `clipfind.js` | **wer schneidet den Schatten ab?** Läuft die Vorfahren-Kette eines Elements hoch und listet je Ebene Box, `overflow` und `padding`. `SEL=`, `ROUTE=`, `BASE=` |
| `tokencensus.js` | **Design-Token-Zensus**: gruppiert Rahmenbreite, Radius, Schriftgröße und Schatten-Versatz über 12 Routen × hell/dunkel — siehe unten |
| `scripts/overflow-check.js` (**im Repo**, nicht in `~/uitest`) | **Mobile-Overflow-Gate**: rendert `/` und die Suche über 320/360/390/412/430 px und schlägt fehl, sobald der Layout-Viewport breiter wird als der Bildschirm. Läuft automatisch am Ende von `scripts/deploy-client.sh`; für Branch-Builds von Hand mit `BASE=<proxy>` |
| `scripts/edge-audit.js` (**im Repo**) | **Kanten-Gate**: misst jede Sticker-Überschrift gegen den Block, den sie beschriftet, und meldet Versatz sowie schiefes Chip-Padding. Zweites Gate am Ende von `scripts/deploy-client.sh`. `TOKEN=`, `BASE=`, `WIDTH=`, `ROUTES=`, `MIN_COMPARED=`. ⚠️ Beide Gates teilen einen Vertrag: **0 sauber · 1 Fund · 2 Harness kaputt** — „nicht gelaufen" darf nie wie „sauber" aussehen, und ein Fund nie wie ein Harness-Fehler |
| `scripts/menu-label-fit.js` (**im Repo**) | **Label-Gate**: öffnet alle acht Kontextmenüs und misst jedes Label mit Canvas-`measureText` gegen die Box, die es tatsächlich bekommen hat. Drittes Gate am Ende von `scripts/deploy-client.sh`, gleicher Vertrag. `TOKEN=`, `BASE=`. ⚠️ **Nicht** `scrollWidth` — an einem bereits gekappten Element meldet der die gekappte Breite, ein abgeschnittenes Label misst sich also als passend. Ein Menü, das nicht aufgeht, druckt `HARNESS:` und zählt als nichts gemessen, nie als bestanden |
| `pixelprobe.js` | **welche Farbe steht wirklich an dieser Stelle?** Tastet eine waagerechte Linie im Bild ab (Clip → Canvas), statt Element-Rechtecken zu glauben. `ROUTE=`, `BASE=`, `ENGINE=` |
| `previewproxy.js` + `run*.sh` | Branch-`dist` über einen Proxy servieren und messen |
| `queueseams.js`, `verify3.js` | E2E für Queue-Seams und Group-Sync |
| `shuffleverify.js`, `endlessverify.js`, `groupshuffle.js` | E2E für die Zufallswiedergabe: wiederholt sie einen Song, stoppt sie auf der letzten Zeile, würfelt die Gruppe? |

**Für Mobile-Befunde immer `MOBILE=1`** — erst mit `hasTouch` greifen die
`@media (hover: none)`-Zweige, und genau dort stecken die Touch-Bugs.

## Drift finden, ohne zu wissen wonach man sucht

Die Audits oben prüfen je **eine** bekannte Regel. Für die Frage „wo driftet das Design
überhaupt?" taugen sie nicht, und ein `grep` erst recht nicht: Er findet nur die Schreibweise,
die man vermutet.

`tokencensus.js` dreht das um — er liest, was der Browser **tatsächlich malt**, und gruppiert es:

```bash
TOKEN=… node tokencensus.js > /tmp/census.json
```

Ein Design mit drei Radius-Tokens sollte drei Radien zeigen. Zeigt es zehn, sind die seltenen
Werte die Drift — und die **häufigen ohne Token** sind ein zweites System, das niemand beschlossen
hat. Genau so gefunden (#354): `8px` war mit 2100 Vorkommen der zweithäufigste Radius der App und
gehörte keinem Token, sondern der Utility-Klasse `.rounded-sm` aus der Zeit vor dem Redesign. Der
Verteilungs-Anteil ist dabei das Werkzeug, nicht die absolute Zahl.

Zwei Dinge beim Lesen der Ausgabe:

- **Ein seltener Wert ist ein Kandidat, kein Befund.** `50%` auf einem Avatar ist richtig, `40%`
  daneben nicht — das entscheidet der Blick auf das Element, nicht die Statistik.
- **Zähle nur, was gezeichnet wird.** Ein `border-width` ohne `border-style` oder mit
  transparenter Farbe ist keine Kante (die halbe App reserviert genau so ihren Hover-Rahmen) —
  der Zensus filtert das, wer selbst misst, muss es auch tun.

Die Routen sind Hash-Routen: `http://localhost:1970/#/<route>`.

⚠️ **Now Playing ist `/nowplaying/home`, und nur das.** Die Route ist `/nowplaying/:tab`, aber
`main.vue` rendert ihren Inhalt hinter `v-if="$route.params.tab == 'home'"` — jeder andere Tab
liefert eine **leere Seite mit gültiger URL**. Kein 404, keine Konsolenmeldung: Titelleiste und
Bottom-Bar stehen, der Messcode findet null Elemente und meldet, das Feature fehle. `/nowplaying`
ohne Tab ist dagegen ehrlich und zeigt „404! Page Not Found!".

## ⚠️ Fallen beim Messen

- **⚠️ EINE Phone-Breite ist keine Mobile-Verifikation.** Ein Layout, dessen Min-Content zufällig
  knapp unter der Messbreite liegt, ist bei 390 px grün und bei 360 px (häufigste Android-Breite)
  kaputt — real passiert: die Bottom-Bar maß nach dem 533-px-Fix exakt 383 px Min-Content, der
  390er-Check meldete `docScrollW == 390`, und auf dem Telefon des Nutzers (360) lief die Seite
  wieder über. Mobile-Layout-Befunde deshalb immer über das Spektrum fahren —
  `scripts/overflow-check.js` (320/360/390/412/430) tut genau das und läuft seitdem als Gate am
  Ende jedes Deploys.
- **⚠️ `THEME=dark` in `shot2.js` schaltet das Theme NICHT mehr — und meldet das nicht.** Das
  Skript schreibt `theme`/`auto_theme` in das persistierte `settings`-Objekt im localStorage und
  lädt neu; die App kommt trotzdem hell zurück. Der Lauf endet mit `SHOT_DONE`, die Datei ist da,
  sie zeigt nur das falsche Theme — real passiert: ein erstes Paar „Dark"-Aufnahmen war
  **pixelgleich** mit den hellen und wäre so in die README gewandert.
  `darkshot.js` geht deshalb den echten Weg: es klickt `button.theme-toggle` (den Mond in der
  Topbar) und **prüft vor jeder Aufnahme `document.body.classList.contains("theme-dark")**, mit
  Abbruch bei fehlender Klasse. Die Assertion ist der Punkt — sie unterscheidet „sieht dunkel
  aus" von geprüft. Wer ein Theme misst, prüft die Klasse, nicht den localStorage.
- **Gegen `master` kontrollieren, immer.** Eine Null beweist ohne Kontrolllauf nur, dass man
  nicht misst.
- **⚠️ Ein Element-Rechteck ist kein Beweis, dass etwas GEMALT wird.** `getBoundingClientRect()`
  meldet die volle Box auch dann, wenn ein Vorfahre sie wegclippt — bei allem, was über eine
  Kante hinausreicht (`overflow`, `clip-path`, Scroller-Ränder), misst man damit die Absicht,
  nicht das Ergebnis. Dann die **Farbe an der fraglichen Stelle** abtasten: schmalen Clip
  screenshotten und per Canvas auslesen (`~/uitest/pixelprobe.js`). Bei #483 war genau das der
  Unterschied zwischen „das Decor spannt 259…1437" und „an x+3 steht Papier `244,242,237` statt
  Schleier `86,85,116`".
- **⚠️ Das Queue-Panel rendert in der Standard-Umgebung GAR NICHT.** `RightSideBar/Main.vue`
  hängt an `settings.use_sidebar && xl` (`xl` = **> 1280 px**, `composables/useBreakpoints.ts`),
  und ein frischer Playwright-Kontext hat weder das Setting noch zwangsläufig die Breite. Ein
  `document.querySelector(".track-item.currentInQueue")` liefert dann `null` — was wie ein
  falscher Selektor oder ein kaputtes Feature aussieht, obwohl es nur die Layout-Bedingung ist
  (real passiert beim Nachmessen der Now-Playing-Markierung: `NO_QUEUE_PANEL` bei 1440 px).
  Beides also im `addInitScript` bzw. im Kontext setzen:

  ```js
  await c.addInitScript(() => {
    const s = JSON.parse(localStorage.getItem("settings") || "{}")
    s.use_sidebar = true
    localStorage.setItem("settings", JSON.stringify(s))
  })
  const c = await b.newContext({ viewport: { width: 1600, height: 950 } })   // > 1280
  ```

  Dasselbe gilt für alles andere im rechten Panel (Suche, Dashboard). Wer nur die Songliste
  misst, hat die **zweite** Hälfte eines Zeilen-Zustands nicht geprüft: `.track-item` in der
  Queue und `.songlist-item` in der Liste sind zwei verschiedene Komponenten.
- **Ob eine Animation LÄUFT, weiß nur `document.getAnimations()`.** Ein computed `animation-name`
  sagt bloß, dass eine laufen *dürfte* — die Chrome-Buttons in Nav und Sidebar tragen `btn-pop`
  dauerhaft und feuern trotzdem nur beim App-Start. Wer die Deklaration misst, hält jeden
  Seitenwechsel für ein Ploppen. `getAnimations()` liefert zusätzlich `getComputedTiming()` mit dem
  **effektiven** Delay, also die Staffelung als Zahl statt als Absicht.
- **⚠️ Ein Skript ohne `BASE` misst die LIVE-App, egal welchen Proxy man startet.** Der Proxy
  läuft, die Startzeile im Log stimmt, das Skript geht trotzdem auf `:1970` — und dann vergleicht
  man seinen Branch mit sich selbst. Aufgefallen bei #414: der Screenshot (über `BASE`) zeigte den
  Fix, die Vorfahren-Messung daneben (hartes `:1970`) meldete den alten Zustand, und das sah nach
  „Fix wirkt nicht" aus. Vor einem Branch-Messlauf einmal prüfen, dass das Skript `process.env.BASE`
  überhaupt liest — und im Zweifel am **gebauten Artefakt** gegenlesen
  (`grep -o '<markup>' dist/assets/*.js`), das lügt nicht.
- **⚠️ Wer eine GRÖSSE misst, nimmt den Computed Style — nicht `getBoundingClientRect()`.** Der
  Rect enthält laufende Transforms, und `btn-action`/`btn-pill` bringen den Mount-Pop mit, dessen
  erster Keyframe `scale(0.82)` ist. Ein Zensus, der beim Booten misst, liest deshalb Größen, die
  **in keinem Stylesheet stehen**: der Favoriten-Toggle im Now-Playing-Header kam als 36×36 mit
  19,7-px-Glyph zurück (44 × 0,82 = 36,1 · 24 × 0,82 = 19,7) und sah aus wie eine Regression, die
  es nicht gab. Gegenprobe ist `getComputedStyle(el).width` neben dem Rect: weichen sie ab, misst
  man eine Animation. `ctlcensus.js` liest deshalb den Computed Style, `whereis.js` noch den Rect
  — dort also länger warten oder gegenprüfen.
- **Ein zu kurzes Messfenster liest sich wie „ploppt gar nicht".** Auf einer kalt geladenen
  Detailseite steht die Header-Reihe erst nach 500–1000 ms; ein 2-Sekunden-Fenster, das vor dem
  Rendern beginnt, meldet sauber „0 Pops" (real passiert: mobile Album-, Artist- und
  Playlist-Seite gleichzeitig „kaputt", alle drei in Ordnung). Den Collector per
  `addInitScript` **vor** dem Boot setzen und mindestens 8 s messen.
- **Außerhalb des Viewports gibt es kein `elementFromPoint`.** Ein `page.mouse.down()` auf den
  Koordinaten eines Elements unterhalb der Falz landet auf **nichts** — der Test meldet „kein
  Effekt", der Code ist in Ordnung (real passiert: Ordner-Kopf bei y≈1044 in einem 900-px-
  Viewport). Vor jeder Zeiger-Interaktion `scrollIntoViewIfNeeded()`, danach mit
  `elementFromPoint` prüfen, dass die Mitte wirklich das Ziel trifft.
- **⚠️ Wer eine Reihe der Reihe nach DRÜCKT, ändert dabei den Zustand.** Ein Messlauf, der jedes
  Element hovert und presst, klickt in der Top-Bar irgendwann den **Theme-Toggle** — alles danach
  Gemessene steht im anderen Theme. Der Befund sieht dabei nicht falsch aus, sondern nur
  unerklärlich: der Avatar meldete `--mem-hover` als `#222226`, den Dark-Wert, während der Rest der
  Leiste sauber hell gemessen war. Zustandsändernde Bedienelemente also zuletzt drücken, einzeln
  messen oder den Zustand nach jedem Klick zurücksetzen.
- **Preview-Proxy-Ports kollidieren.** Alte `previewproxy.js`-Prozesse liefern womöglich ein
  **veraltetes `dist`** aus; der neue Proxy stirbt still mit `EADDRINUSE`, und man diagnostiziert
  am falschen Build (real passiert: „Button fehlt" an master-CSS gemessen). Immer die Startzeile
  `preview proxy on <port> serving <dist>` im Log prüfen, frischen Port nehmen, mit `kill $PROXY`
  aufräumen (nicht `pkill -f previewproxy`).
- **⚠️ `~/preview` gehört niemandem — für einen Messlauf einen eigenen Checkout nehmen.** Das
  Verzeichnis wird von mehreren Sitzungen benutzt: eine andere kann es mitten im Lauf auf ihren
  Branch zurücksetzen und neu bauen, und dann misst man deren Code. Real passiert: erste Messung
  gelb, zweite gegen dasselbe `dist` wieder teal — `git log` in `~/preview` stand auf einem
  fremden Commit.

  ```bash
  git clone -q --shared ~/preview ~/preview-<thema>
  cd ~/preview-<thema> && git remote set-url origin <fork-repo>
  git fetch origin <branch> && git checkout FETCH_HEAD
  ln -s ~/preview/node_modules node_modules
  yarn build
  ```

  Danach **am gebauten Artefakt** prüfen, dass die eigene Änderung wirklich drin ist:
  `grep -o "<selektor>{[^}]*}" dist/assets/index.*.css` — und zwar gegen die CSS-Datei, die
  `dist/index.html` auch tatsächlich lädt (es liegen mehrere `index.*.css` herum).
- **Dienste nie per `ssh host '… &'` detachen** — das hängt die Sitzung. Die `run*.sh` bündeln
  deshalb Proxy (Hintergrund) + Messung (Vordergrund) + `kill` in **einer** Sitzung.
- **Die Queue im NowPlaying ist virtualisiert** — Zeilen zählen misst den Scroller, nicht die
  Queue. Stattdessen den persistierten Store lesen
  (`JSON.parse(localStorage['tracklist']).tracklist.length`).
- **Group-Sync nur über echte UI-Klicks verifizieren**, ohne `--autoplay-policy`-Flag: Der erste
  E2E jointe per API und umging damit genau die Pfade, die im Alltag brechen — grün, während das
  Feature kaputt war.
- **Eine Gruppe entsteht über „Invite" auf der Zeile des ANDEREN Geräts.** Die eigene Zeile bietet
  „Join" erst an, wenn schon eine Gruppe läuft — ein E2E, der blind das eigene „Join" sucht,
  findet nichts und meldet „nicht beigetreten" (real passiert, `verify3.js` stammt aus der Zeit
  davor). Ablauf: A klickt *Invite* in der Fremdzeile (A tritt implizit bei), B beantwortet den
  `.gesture-overlay`-Prompt mit `button.accept` — der Klick ist zugleich die Autoplay-Geste.
- **Ein Gruppen-Seek direkt nach einem Track-Wechsel wird verschluckt.** Er ist ein Broadcast,
  kein lokaler Sprung: im Fenster, in dem der geplante `track_change` noch aussteht, bewegt sich
  der Playhead nicht (gemessen: `t=5.6` von `247.6` beim ersten Versuch, Sekunden später
  gelandet). Also **bestätigen statt annehmen** — nach dem Seek die Restzeit lesen und
  gegebenenfalls wiederholen (Muster `seekAndConfirm` in `groupshuffle.js`).
- **Für ein reproduzierbares Track-Ende den Playhead über den persistierten Store parken.** Ein
  bestimmter Queue-Index (z. B. „die letzte Zeile") ist über die Oberfläche mühsam zu treffen:
  `Queue` aus `localStorage` lesen, `currentindex` setzen, zurückschreiben, neu laden — die
  Wiedergabe danach mit einem **echten Klick** starten (Muster in `endlessverify.js`).
- **node löst `localhost` hier zuerst nach `::1` auf, wo nichts antwortet.** Beobachter-Polls aus
  dem Skript heraus (`fetch`) sterben dann mit „fetch failed", während der Browser dieselbe URL
  problemlos lädt. Für node-seitige API-Aufrufe `http://127.0.0.1:1970` nehmen.
- **`waitUntil: 'networkidle'` läuft ins Timeout, sobald etwas spielt.** Der Audio-Stream hält eine
  Verbindung offen; jede Navigation *nach* dem ersten Play braucht `domcontentloaded` plus eine
  feste Wartezeit. Symptom sonst: „Seite lädt nicht", obwohl sie längst da ist.
- **Erst scrollen, bis die Liste nicht mehr wächst.** Ein einzelnes `scrollTop = scrollHeight`
  triggert den Infinite-Scroll-Sentinel, der nachlädt und den Boden verschiebt — die „letzte"
  Zeile ist dann gar nicht die letzte. In einer Schleife scrollen, bis `scrollHeight` stabil ist.
  Und weil der Scroller recycelte Zeilen im DOM stehen lässt, ist die letzte Zeile die mit der
  **größten Unterkante**, nicht der letzte Knoten.
- **Die Now-Playing-Queue liegt unter der Falz.** Ihr Header füllt fast den ganzen Viewport, die
  erste Zeile beginnt bei y≈738 von 900. Ohne vorheriges Scrollen des Scrollers gibt es genau eine
  sichtbare Zeile — ein Drag darauf hat kein Ziel und meldet „Feature kaputt".
- **Ein Test-Schritt kann die Vorbedingung des nächsten zerstören.** Ein Queue-Reorder bringt die
  Queue absichtlich aus dem Tritt mit der Playlist-Seite; der Spiegelungs-Wächter verweigert dann
  **korrekt**. Rot heißt hier „falsche Reihenfolge im Test", nicht „Bug". Schritte so ordnen, dass
  jeder seine Vorbedingung selbst herstellt.
- **Nach einem `play()` neu rendern, bevor gezogen wird.** `playFromPlaylistPage` lädt die
  vollständige Tracklist nach und baut den Scroller neu auf; ein Drag in eine noch wackelnde Liste
  landet zwischen zwei wandernden Zeilen und geht verloren.
