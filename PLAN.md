# aioseerr — Fejlesztési terv

> Cél: a [seerr.dev](https://seerr.dev/) (Overseerr/Jellyseerr) élményéhez hasonló felület — filmek/sorozatok böngészése, watchlistre tétel, és automatikus letöltés a megadott indexeren (Jackett/Prowlarr torznab) és torrent kliensen (qBittorrent) keresztül, amint elérhetővé válik a tartalom.

Ez a dokumentum a jelenlegi állapot elemzését és a hátralévő munka fázisokra bontott tervét tartalmazza. Élő dokumentum — a fázisok haladásával a checkboxokat érdemes kipipálni, és a tervet frissíteni, ha közben új döntés születik.

---

## 1. Kezdeti állapot (2026-08-04-i felmérés)

> Ez a szakasz a munka **kezdetén** talált állapotot rögzíti, hogy látszódjon, honnan indultunk. Ami közben megoldódott, az alább jelölve van; az aktuális állapotot a 4. pont fázisai mutatják.

### Amin akkor is működött
- **Next.js 15 / React 19** app router, Tailwind + shadcn/radix UI komponensek, sidebar layout ([layout.tsx](src/app/layout.tsx), [app-sidebar.tsx](src/components/app-sidebar.tsx)).
- **Discover/Trending böngészés**: [`[discover_media_type]/page.tsx`](src/app/[discover_media_type]/page.tsx) lekéri a TMDB trending listát (`/api/discover`), 3 oldalt előre, és `MediaCard` gridben, horizontálisan scrollozható sorokban jeleníti meg.
- **Részletnézet**: [`details/[type]/[id]/page.tsx`](src/app/details/[type]/[id]/page.tsx) — backdrop, poszter, cím, leírás, és egy **"Download"** gomb.
- **Azonnali manuális letöltés**: a Download gomb a `/api/download` route-ot hívja, ami TMDB-ből kiszedi az IMDB ID-t, torznab keresést indít a Jackett/Prowlarr aggregátoron ([torrent.ts](src/lib/torrent.ts)), 1080p-re szűr, és a **első** találatot rakja be qBittorrentbe.
- **Adatbázis**: Postgres + Prisma, egyetlen `Watchlist` tábla (`tmdbid`, `type`, timestampek) — **létezik, de semmi nem írja vagy olvassa**, sem API, sem UI nincs hozzá.
- **Docker**: bun alapú image, dev módban csak Prisma Studio-t indít + `sleep infinity` (a Next dev szerver indítása nincs benne — ezt érdemes tisztázni, valószínűleg host gépen fut `bun dev` külön).

### Amit hiányosan/rosszul találtam
- ❌ **nyitott** — `bun run lint` az egész projekten hibára fut (~60 hiba), döntő részben `prefer-const` (a kód konzisztensen `let`-et használ) és `@typescript-eslint/no-explicit-any`. Lint-konfig vs. kódstílus ütközés, nem funkcionális hiba. A `tsc --noEmit` tiszta.
- ❌ **nyitott** — `/api/search` stub, csak `"kaka"`-t ad vissza (Fázis 4).
- ❌ **nyitott** — a [searchbar.tsx](src/components/searchbar.tsx) `<input>`-re `submit` eseményt regisztrál, ami sosem tüzel (`submit` a `<form>`-hoz tartozik). A keresés nem működik (Fázis 4).
- ❌ **nyitott** — a `discover` route catch-ága nem `return`-öl, csak konstruál egy `Response`-t (Fázis 7).
- ✅ **megoldva** — a `MediaCard` üres `ContextMenu`-ja (Fázis 3).
- ✅ **megoldva** — a torrentválasztás „első találat" logikája (Fázis 6: pontozás + hamis-release védelem).
- ✅ **megoldva** — a `Watchlist` modell epizód-szintű követésre alkalmatlan alakja (Fázis 1: hármas hierarchia).
- ✅ **megoldva közben, nem volt a listán** — a `layout.tsx` a defaulton kívül exportált (`SearchFormContext`), amitől a `tsc`/`next build` eltört; a `src/lib/media.ts` egy page komponensből importált típust; a Prisma 7 kliens driver adapter nélkül nem indult; a `@robertklep/qbittorrent` nem működik qBittorrent 5.2-vel.

---

## 2. Fő architekturális döntések (leegyeztetve)

| Kérdés | Döntés |
|---|---|
| Sorozatok követése | **Epizód-szintű** — a teljes sorozat kerül watchlistre, de a rendszer évadonként/epizódonként külön figyeli az indexert, és minden új epizódot/évadot önállóan, automatikusan letölt, amint torrent elérhető rá (Sonarr-szerű működés). |
| Médiaszerver integráció | **Nincs** — nem kötünk Plex/Jellyfin/Emby-t. Az "elérhető/letöltve" állapotot az app saját Postgres adatbázisa tartja számon. |
| Letöltés indítása (2026-08-05-i pontosítás) | **Egyetlen `Download` gomb** a részletnézeten, két külön viselkedéssel. **Film**: kattintásra keres; ha elérhető, azonnal letölti, ha nem, megkérdezi, hogy watchlistre tegye-e. **Sorozat**: az évadok mindig ki vannak listázva, a felhasználó kijelöli, melyeket akarja; ami elérhető (epizódonként vagy packban), az azonnal indul, a hiányzó epizódokra pedig rákérdez, hogy watchlistre kerüljenek-e (csak azok az évadok lesznek monitorozva, amikre igent mond). |
| Torrent-kiválasztás | Konfigurálható profil, ebben a sorrendben: **felbontás → nyelv → indexer-prioritás → seederek → kodek**. Jelenlegi beállítás: `1080p > 720p > 2160p` (FullHD a preferált), indexer-prioritás `ncore > limetorrents > thepiratebay`, x264/h264 előnyben (~500 seeder értékű bónusz), plusz hamis-release védelem (cím/év egyezés, minimum méret a bemondott felbontáshoz). |
| Nyelvi preferencia | **Magyar, utána angol** (`QUALITY_PREFERRED_LANGUAGES=hun,eng`), a jelöletlen release angolnak számít. A többi nyelv kizárva — kivéve, ha az a cím **eredeti nyelve** (TMDB `original_language`), így a japán/francia filmek saját nyelvű release-ei megmaradnak. A `QUALITY_LANGUAGE_FIRST=1` a nyelvet a felbontás elé emeli (720p magyar > 1080p angol); alapból `0`. |
| Metaadat tárolása | **Nem tároljuk** — a DB-ben csak `tmdbId` + `type` + letöltési állapot van, a cím/poszter/leírás mindig a TMDB-ből jön, TTL-es cache-en keresztül (`TMDB_CACHE_TTL_MINUTES`, default 12 óra). Az API réteg dúsítja fel a watchlist sorokat, a frontend ugyanazt a `Media` alakot kapja, mint a discovernél. Ára: TMDB kiesésnél nincs cím/poszter a watchlist nézetben (az állapot és a letöltés viszont megy). |
| Indexer-kezelés | **Indexerenként külön hívás, képesség-alapon** — nem a Jackett aggregate endpointján keresztül. Indexerenként `t=caps` (cache-elve), és amit az adott indexer tud, azzal keresünk (`imdbid`, egyébként `q` = eredeti cím + év/season+ep). Az indexer id-k listája env-ből (`INDEXER_IDS`), mert a Jackett admin API-ja session cookie-t kér, csak api kulccsal `400 Cookies required`. |

---

## 3. Adatmodell

Metaadat (cím, poszter) **nem** kerül a DB-be — az mindig TMDB-ből jön; a táblákban csak azonosító, letöltési állapot és a scanner döntéséhez kellő `airDate` van.

**2026-08-07: két tábla, semmi más.** Korábban a film letöltési állapota a `Watchlist` soron ült, a sorozaté a `WatchlistEpisode` sorokon — ugyanaz a négy oszlop (`status`, `torrentHash`, `searchAttempts`, `lastCheckedAt`) két helyen, két külön kódúttal. Most **minden kereshető és letölthető dolog egy `WatchlistUnit` sor: a film egy unit, a sorozat epizódonként egy.** A `Watchlist` puszta azonosítóvá vált, a `WatchlistSeason` pedig megszűnt: az egyetlen tartalma a `monitored` volt, az átkerült a unitokra.

Az évad így már nem tárolt entitás, hanem a unitok `seasonNumber` mezőjéből olvasható ki. Egy évad akkor „figyelt", ha a unitjai azok; az évad-szintű kapcsoló egy `updateMany`. Amit ez elvesz: **egy olyan évadhoz, aminek a TMDB-n még egy epizódja sincs, nem tárolható monitorozási beállítás** (a Severance S3 pont ilyen) — nincs mihez kötni. Amint megjelenik az első epizódja, az `inheritedMonitored` szabálya dönt.

```prisma
enum ContentType {
  MOVIE
  TV
}

enum WatchStatus {
  PENDING       // watchlisten, még nincs hozzá torrent
  SEARCHING     // aktív keresés van rá ütemezve/folyamatban
  DOWNLOADING   // qBittorrentben fut a letöltés
  DOWNLOADED    // kész, elérhető
  FAILED        // sok próbálkozás után sem található / hiba
}

// csak azonosság; minden más a unitokon él
model Watchlist {
  id        Int         @id @default(autoincrement())
  tmdbId    Int
  type      ContentType @default(MOVIE)
  addedAt   DateTime    @default(now())
  updatedAt DateTime    @updatedAt

  units WatchlistUnit[]

  @@unique([tmdbId, type])
}

// egy kereshető/letölthető dolog: a film egy unit, a sorozat epizódonként egy
model WatchlistUnit {
  id          Int       @id @default(autoincrement())
  watchlistId Int
  watchlist   Watchlist @relation(fields: [watchlistId], references: [id], onDelete: Cascade)

  // filmnél mindkettő null
  seasonNumber  Int?
  episodeNumber Int?
  // nem megjelenítési adat: ez alapján dönti el a scanner, hogy érdemes-e már keresni
  airDate       DateTime?

  // egy évad akkor figyelt, ha a unitjai azok
  monitored Boolean @default(true)

  status         WatchStatus @default(PENDING)
  torrentHash    String?
  searchAttempts Int         @default(0)
  lastCheckedAt  DateTime?

  @@unique([watchlistId, seasonNumber, episodeNumber])
  @@index([status])
}
```

Amit az egységesítés hozott:
- A `syncDownloads()` két majdnem azonos hurka **egy** hurokká olvadt, ami hash szerint csoportosít — egy season pack ezzel magától egyszerre zárja le az összes érintett epizódot, film és epizód megkülönböztetése nélkül.
- A `deriveStatus()` már nem ágazik el típus szerint: minden elem annyira van kész, amennyire a unitjai. Filmnél egy unit van, tehát ugyanazt adja, mint eddig.
- Új oszlopot (pl. a táblázatos nézethez a kiválasztott release neve/mérete, vagy a stall-detektáláshoz idő+progress) **egy** helyre kell felvenni, nem kettőbe.
- Az évad-monitorozás egy `updateMany` a unitokon, a `scanEpisodes` szűrője pedig sima oszlop lett reláció-join helyett.
- Ára: a film unitja `seasonNumber = null, episodeNumber = null`, és mivel a NULL az egyedi indexben soha nem ütközik, az „egy film = egy unit" szabályt kód tartja (`ensureMovieUnit`), nem a DB.
- Szintén ára: az évad már nem tárolt entitás, tehát egy epizód nélküli (bejelentett, de üres) évadhoz nem tapad monitorozási beállítás.

**Öröklési szabály (`inheritedMonitored`)** — ez pótolja a `WatchlistSeason.monitored @default(true)`-t. Egy új unit létrehozásakor:
1. ha az évadnak már van unitja → azt követi;
2. ha nincs, de a sorozatnak van → a legmagasabb sorszámú meglévő évadot követi;
3. ha a sorozatnak egyáltalán nincs unitja → `true`.

A 2. pont egy régi furcsaságot is javít: eddig egy később bejelentett évad `monitored = true`-val jött létre akkor is, ha a sorozat csak egyetlen kézi letöltés miatt került a listára (ilyenkor minden évada `monitored = false`). Mostantól az ilyen sorozat új évada sem indul el magától.

---

## 4. Fázisokra bontott terv

### Fázis 1 — Watchlist backend alapok ✅
- [x] Prisma schema átírása a fenti modellre + migráció (`prisma/migrations/20260805190413_watchlist_hierarchy`).
- [x] `POST /api/watchlist` — film: egy `Watchlist` sor létrehozása; sorozat: `Watchlist` + TMDB-ből lekért évad/epizód lista alapján `WatchlistSeason`/`WatchlistEpisode` sorok generálása (csak a már bemutatott + jövőbeli epizódok, `airDate` mentésével).
- [x] `DELETE /api/watchlist/:id` — leiratkozás (cascade törli a season/episode sorokat is).
- [x] `GET /api/watchlist` — lista státusszal, a Library nézethez.
- [x] `PATCH /api/watchlist/:id/seasons/:seasonNumber` — évad monitorozás ki/bekapcsolása (pl. ha valaki csak az új évadokat akarja, a régieket nem).

Ami elkészült / eltérés a fenti tervtől:
- [src/lib/watchlist.ts](src/lib/watchlist.ts) tartalmazza az üzleti logikát (`addToWatchlist`, `removeFromWatchlist`, `getWatchlist`, `syncTvSeasons`, `setSeasonMonitored`), a route-ok csak vékony wrapperek — a Fázis 2 háttérjobja ugyanezeket hívja majd.
- [src/lib/media.ts](src/lib/media.ts): új `fetchTvSeasons(id)` — a `/tv/{id}` évadlista alapján évadonként lekéri a `/tv/{id}/season/{n}`-t (párhuzamosan), `air_date`-tel. **A 0-as évad (specials) kimarad**, azt nem követjük.
- `syncTvSeasons` upsertel, és a meglévő epizódok `status`/`monitored` értékét nem írja felül — csak az `airDate`-et frissíti, így periodikusan újrafuttatható (TMDB epizód-frissítő, Fázis 2).
- **TMDB metadata cache** ugyanitt: `getMediaMetadata(type, id)` és `getTvSeasons(id)` TTL-es, globalra kötött Map-en keresztül (hot reload nem dobja el, hibát/üres választ nem cache-el). A `getMediaMetadata` az eredeti címet és az évet is visszaadja — ezt használja majd az indexer-keresés. Mért hatás: hideg hívás ~280ms, cache-találat 0ms, egy 2 elemű watchlist listázása 5ms.
- Az API a DB sorokat `media` kulcs alatt dúsítja fel (`withMedia` / `getWatchlistWithMedia`); ha a TMDB nem elérhető, `media: null` jön vissza, de az állapot látszik.
- Extra mezők a tervezett modellhez képest: `searchAttempts` (Watchlist + WatchlistEpisode) a Fázis 2-es retry/`FAILED` logikához.
- `POST` body formátum: `{ tmdbId: number, type: "movie" | "tv" }` (nem a `/api/download`-nál használt `{ data: {...} }` burkolás). A `DELETE` válasza `{ id, tmdbId, type }` — címet nem tud visszaadni, a toast szövegét a frontend teszi ki.
- **Prisma 7 gotcha**: a generált kliensnek futásidőben kötelező driver adapter — ezért került be a `@prisma/adapter-pg` + `pg`, és a [src/lib/prisma.ts](src/lib/prisma.ts) `new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) })` alakra. A `prisma.config.ts`-ben lévő datasource url csak a CLI-nek szól.
- Két kis takarítás, ami blokkolta a típusellenőrzést: a `Media` típus átkerült a page komponensből a [src/types/media.ts](src/types/media.ts)-be, a `SearchFormContext` pedig a `layout.tsx`-ből a [src/context/search-form.ts](src/context/search-form.ts)-be (a Next nem engedi, hogy egy layout mást is exportáljon a defaulton kívül — emiatt a `tsc`/`next build` hibára futott).

### Fázis 2 — Indexer réteg + háttérfolyamat (scheduler)

Mért tények az nCore-ról (Jackett `t=caps` + éles próbahívások, 2026-08-05):
- `movie-search: q,imdbid,genre` — filmnél az **imdb id működik** (`t=movie&imdbid=tt0137523` → 13 találat; a mostani `t=search&imdbid=…` ugyanazt adja).
- `tv-search: q,season,ep,genre` — **imdbid nincs**: `t=tvsearch&imdbid=…` → `HTTP 400, error 203: imdbid is not supported for TV search by this indexer`.
- Sorozatnál a cím kötelezően az **eredeti**: `q=House of the Dragon&season=1&ep=1` → 92 találat, `q=Sárkányok háza` → **0 találat**.
- A seederek megvannak a válaszban (`<torznab:attr name="seeders" …>`, pl. 331 / 1619), de a mostani `XMLParser` `ignoreAttributes` miatt eldobja őket.

- [x] **[src/lib/indexer.ts](src/lib/indexer.ts)** — torznab réteg, indexerenként külön hívással:
  - `INDEXER_IDS` env (vesszős Jackett indexer id lista, default `all`), `getCaps(indexerId)` 6 órás cache-sel (`INDEXER_CAPS_TTL_MINUTES`), a `movie-search`/`tv-search` `supportedParams` kiparsolásával.
  - Képesség-alapú lekérdezés: `imdbid`, ha az adott indexer tudja arra a módra, egyébként `q` = eredeti cím (+ év filmnél, + `season`/`ep` sorozatnál). Ha a `tv-search` egyáltalán nincs, `t=search` + `Cím S01E02`.
  - Ha az indexer mégis elutasítja az `imdbid`-t (a caps hazudik), egyszer automatikusan újrapróbál cím alapú kereséssel.
  - `XMLParser({ ignoreAttributes: false })` + seeder/peer a `torznab:attr`-ból, és a `jackettindexer` id-ból tudjuk, melyik indexer adta a találatot aggregate módban is.
  - `dedupe`: normalizált cím + méret alapján, a több seederes példányt tartja meg.

  **Mérés (2026-08-05)**, ami igazolta, hogy indexerenként kell hívni: a Jackettben **három** indexer van (`ncore`, `limetorrents`, `thepiratebay`), és csak az nCore tud `imdbid`-t (`movie: q,imdbid,genre`; a másik kettő csak `q`). Az aggregate endpointon imdbid-vel keresve **16** találat jött (a másik két indexer csendben nulla), indexerenként, képesség szerint keresve **147** — ugyanarra a filmre. Epizódnál 91 találat (`ncore=1, limetorrents=40, thepiratebay=50`), tehát az nCore-on kívüli indexerek adják a sorozat-találatok többségét.
- [x] **Release-pontozás** ([src/lib/release.ts](src/lib/release.ts)) — a „vedd az elsőt" helyett:
  - Env-ből konfigurálható profil: `QUALITY_RESOLUTIONS` (prioritási sorrend, **most `1080p,720p,2160p`** — FullHD a preferált), `QUALITY_PREFERRED_CODECS` (`x264,h264,avc`) + `QUALITY_CODEC_BONUS` (500), `QUALITY_EXCLUDE`, `QUALITY_MIN_SEEDERS`, `QUALITY_MAX_SIZE_GB` (0 = nincs limit), `QUALITY_MIN_SIZE_MOVIE` / `QUALITY_MIN_SIZE_EPISODE`.
  - `score = felbontás_rangja * 1e9 + indexer_rangja * INDEXER_PRIORITY_BONUS + seederek + kodek_bónusz`. Sorrend: **felbontás → indexer-prioritás → seederek → kodek**.
  - **Indexer-prioritás**: az `INDEXER_IDS` sorrendje egyben a prioritás (most `ncore` az első), felülírható `INDEXER_PRIORITY`-vel, a súly `INDEXER_PRIORITY_BONUS` (default 100000, azaz azonos felbontáson az előbb álló indexer gyakorlatilag mindig nyer; kisebb értékkel a seeder-szám átveheti a döntést). Ha a prioritásosnál nincs elfogadható találat, a következő indexer jön — nem kizárólagos.
  - **Hamis release-védelem** (valós eset: The Odyssey-re egy „2160p" nevű, 1.07GB-os, 158 seederes torrent indult el, ami nem is film volt):
    - **Cím- és év-ellenőrzés**: a release nevéből kiparsolt cím normalizálva egyeznie kell az eredeti vagy a lokalizált címmel, film esetén az év ±1 éven belül. Ez szűrte ki pl. a `The Odyssey The Making Of An Epic` dokumentumfilmet, a filmzenét és egy cosplay videót.
    - **Minimum méret a bemondott felbontáshoz**: film `2160p:8GB, 1080p:2GB, 720p:0.8GB, 480p:0.3GB`, epizódnál kisebb táblázat, packnél epizódszámmal skálázva. Ismeretlen felbontásnál a legkisebb küszöb érvényes.
    - `exe,msi,apk` bekerült a kizáró kulcsszavak közé.
    - Mérve: The Odyssey → mind a 32 találat kiesik (7 méret miatt, 10 cím miatt, 15 TS/HDTS miatt), tehát a UI a watchlist-kérdést hozza fel. Dune: Part Two → 1080p AMZN WEB-DL **H.264**, 8.42GB, 1470 seeder.
  - Kizáró kulcsszavak szóhatárral illesztve (a `ts` nem talál bele random szavakba), a nem kívánt felbontás kiesik, az **ismeretlen** felbontás bent marad utolsó esélyként.
  - `filterEpisodeReleases`: csak a kért epizód marad (PTT `season`+`episode` egyezés) — az évad-packek egyelőre kiesnek, ez a Fázis 6 tétele.
  - Élesben mérve (Dune: Part Two, 147 találat): default profillal 2160p/512 seeder a nyertes, 18 találat kiszórva (`hdts` 12, `ts` 2, `hdcam` 2, 576p 1, kevés seeder 1). `QUALITY_RESOLUTIONS=1080p` + `QUALITY_MAX_SIZE_GB=10` profillal az nCore 1080p/1572 seeder/8.4GB release nyer, 84 kiesik. House of the Dragon S01E01-re 82 jelölt, a nyertes 2160p.
- [x] **[src/lib/torrent.ts](src/lib/torrent.ts) tisztán qBittorrent**: hozzáadás `aioseerr` kategóriával (létrehozza, ha nincs) + egyedi taggel, és a hash visszaolvasása tag alapján, mert a `torrents/add` csak `"Ok."`-t ad vissza. Emellett `listManagedTorrents`, `getTorrentStatus`, `removeTorrent`, és `isComplete`/`isFailed` állapot-leképzés a syncnek.
  - A `@robertklep/qbittorrent` csomag **kikerült**: a te qBittorrentod (v5.2.2, WebAPI 2.15.1) `204`-et ad az `/auth/login`-ra, a lib pedig minden nem-200-at hibának vesz, így a kliens használhatatlan volt. Helyette egy vékony axios-alapú kliens van a fájlban (login 200/204 kezelés, SID cookie, 401/403-ra újralogin).
- [x] **Évad-pack támogatás** (a „csak az egész évad tölthető" esetre):
  - `findSeasonReleases` ([indexer.ts](src/lib/indexer.ts)): `t=tvsearch&season=N`, `ep` nélkül — így a packek is bejönnek.
  - `parseNumbering` ([release.ts](src/lib/release.ts)): **saját** évad/epizód-parser, mert a PTT a csupasz `S01`-et nem ismeri fel évadként (csak `S01E01`-et vagy kiírt `Season 1`-et), tehát a pack számozás nélkülinek látszott. Kezeli: `S01E01`, `S01E01-E10`, `1x05`, `S01`, `S01-S02`, `Season(s) 1-3`. A PTT maradt a felbontásra.
  - `filterSeasonReleases` / `selectSeasonRelease`: pack = a kért évad, epizódszám nélkül; a `QUALITY_MAX_SIZE_GB` limit packnél epizódszámmal felskálázva érvényes.
  - Mérve: House of the Dragon 1. évadra 85 találatból **37 pack** (a régi PTT-alapú felismeréssel 0), Ted Lasso 1. évadra 54-ből 15. A default (felbontás-elsőségű) profil 2160p packet választ, ami 89–189GB is lehet — ezért érdemes `QUALITY_MAX_SIZE_GB`-t állítani.
  - **A scanner ladder-e** (a scheduler lépésben): 1) epizódonként keresünk; 2) ha egy monitorozott, már bemutatott epizód `searchAttempts >= PACK_AFTER_ATTEMPTS` után sincs meg egyedileg, akkor évad-pack keresés; 3) a pack egyetlen torrentként kerül be, és a hash ráíródik az évad **összes** érintett (monitorozott, bemutatott) epizódjára — több évadot fedő packnél mindegyik érintett évadra. Így nem kell séma-módosítás: a közös `torrentHash` a kapcsolat, és a qBittorrent-sync egyszerre viszi `DOWNLOADED`-be az összeset.
- [x] [src/instrumentation.ts](src/instrumentation.ts) + [src/lib/scheduler.ts](src/lib/scheduler.ts) — periodikus job négy szakasszal:
  - **qBittorrent-sync**: a mentett hash-ek állapota alapján `DOWNLOADED`, hibás torrentnél vissza `PENDING`-be `searchAttempts+1`-gyel; ha a torrent eltűnt a kliensből, szintén újra keresésre kerül. A packnél az egy hash-hez tartozó összes epizód egyszerre lép át.
  - **Film-scanner**: `PENDING`/`SEARCHING` film, keresés → találatnál qBittorrentbe + `DOWNLOADING`, egyébként `searchAttempts+1`, `MAX_SEARCH_ATTEMPTS` után `FAILED`.
  - **Epizód-scanner**: monitorozott évad + `airDate <= most` + `PENDING`/`SEARCHING` epizódok, **évadonként egy** kereséssel, majd a pack-ladder.
  - **TMDB frissítő**: monitorozott sorozatok évad/epizód adatai (új évad, dátum-pontosítás) — a TMDB cache miatt gyakorlatilag a cache TTL ütemében.
- [x] Env-változók: `WATCHLIST_SCAN_INTERVAL_MINUTES` (15), `SEARCH_BACKOFF_MINUTES` (30), `MAX_SEARCH_ATTEMPTS` (10), `PACK_AFTER_ATTEMPTS` (2), `SCAN_DISABLED`, `SCAN_DRY_RUN`.
- [x] `searchAttempts`-alapú retry + `lastCheckedAt`-alapú backoff (egy jövőre megjelenő film nem kerül keresésre minden körben).
- [x] Csak `NEXT_RUNTIME === "nodejs"` alatt indul, globális flag (nem indul kétszer hot reloadnál) + futás-mutex (átfedő tick kimarad), és 15 másodperc késleltetéssel az első kör.
- [x] **`SCAN_DRY_RUN=1`**: a scanner csak logolja, mit töltene le — semmit nem ad a qBittorrenthez és semmit nem ír a DB-be. A `.env`-ben **ez az induló beállítás**, hogy az első éles kör ne indítson váratlanul tucatnyi letöltést. `POST /api/scan` kézzel is lefuttat egy kört.
- [x] Epizód elsődlegesen egyedileg, `PACK_AFTER_ATTEMPTS` (default 2) sikertelen kör után évad-pack.
- [x] `/api/download` átírva a fenti egy-gombos logikára: film → `{ started, missingMovie }`, sorozat → `{ started, missing: [{ seasonNumber, episodeNumbers }] }`. A hiányzókra a UI kérdez rá, és a válasz csak a kijelölt évadokat monitorozza (`POST /api/watchlist` + `seasons`).
- [x] **[src/lib/grab.ts](src/lib/grab.ts)** — a keresés → pontozás → qBittorrent → DB lánc egy helyen, ezt használja a UI és a scheduler is:
  - `planMovieGrab` / `planSeasonGrab`: az évad-keresés a **packhez** és tartalék-jelöltlistának kell, a konkrét epizód-választás viszont **epizódonkénti keresésből** jön. Mérés, ami ezt kikényszerítette: az évad-keresés House of the Dragon 1. évadra 85 találatot ad, de abból epizódonként csak ~1-et (37 pack + `{E1:1, E2:1, …, E7:25}`), míg egy dedikált S01E01 keresés **91** találatot. Emiatt az E1-re egy 2160p/15 seederes release nyert volna; epizódonkénti kereséssel 1080p/126 seeder lett. Párhuzamosság: `EPISODE_SEARCH_CONCURRENCY` (default 3, egy 10 részes évad terve ~5s), a scanner pedig csak az épp esedékes epizódokra futtat egyedi keresést.
  - Pack csak akkor jön szóba, ha legalább egy már bemutatott epizód egyedileg nem elérhető. Packnél az évad összes bemutatott epizódja egy közös hash-t kap.
  - `planGrabs`: a több-epizódos release-t (`S03E01-E06`) **egyszer** adja be és mindegyik érintett epizódot megjelöli — dry-runban ez konkrét hiba volt (S3E1 és S3E4 külön beadta volna ugyanazt a torrentet, a második tag-visszaolvasás pedig hash nélkül maradt volna).
  - Csak `PENDING`/`SEARCHING`/`FAILED` epizódot indít újra, tehát a már letöltött vagy épp töltődő epizódokat nem kezdi újra (ez is dry-runban derült ki).
  - Letöltés-indításnál a watchlist sor **monitorozás nélkül** jön létre: a torrentet a hash tartja nyilván, monitorozás csak akkor kapcsol be, ha a felhasználó a hiányzókra igent mond.
  - Az azonnali letöltés így is felkerül a watchlistre, **rögtön `DOWNLOADING` állapottal**. A származtatott státusz ezért nem csak a monitorozott unitokat veszi (`trackedUnits`): egy monitorozás nélküli évad töltődő epizódjai is látszanak, különben egy azonnali sorozat-letöltés „Watchlisted"-nek mutatkozott volna.

### Fázis 3 — Watchlist frontend UX ✅

(A Fázis 2 elé került: a backend addig csak curl-lel volt elérhető, így a scanner most már saját felületről feltöltött watchliston fejleszthető.)

- [x] Gomb a részletnézeten. **2026-08-05-i átalakítás után egyetlen `Download` gomb** (ld. 2. pont): filmnél azonnali letöltés vagy watchlist-kérdés, sorozatnál évad-kijelölés checkboxokkal.
- [x] Sorozatnál évad-szintű lista a részletnézeten. Az évad-`Switch`-ek (kézi monitorozás-váltás) helyére **checkbox-os kijelölés** került; a monitorozás a hiányzó tartalomra adott „Add to watchlist" válaszból következik, kézzel egyelőre nem állítható a felületről (a `PATCH /api/watchlist/:id/seasons/:n` API megvan hozzá).
- [x] Állapot-badge-ek: `Watchlisted` / `Not out yet` / `Waiting for release` / `Downloading` / `Available` / `Not found` ([watchlist-badge.tsx](src/components/watchlist-badge.tsx)); sorozatnál `X/Y`. A `Not out yet` (`UPCOMING`) 2026-08-08-án került be, lásd a lenti alfejezetet. A százalékos „Letöltés 42%" a Fázis 2-es qBittorrent-syncre vár.
- [x] `MediaCard` jelezze a watchlist-állapotot a discover/trending rácsban is.
- [x] A `ContextMenu` kitöltése a MediaCardon: jobb klikk → Watchlistre/Watchlistről le, és **filmnél** „Download now" (nem elérhető film esetén a toast ad egy „Add to watchlist" gombot). Sorozatnál a rácsból nincs gyors-letöltés, mert évad-kijelölés kell — ott a részletnézetre kell menni.
- [x] Sidebar "LIBRARY" szekció valódi tartalommal: `/watchlist` és `/watchlist/downloaded`.

Ami elkészült / döntések:
- **`GET /api/watchlist?slim=1`** — TMDB-dúsítás nélküli lista (`id, tmdbId, type, status, episodeCount, downloadedCount`). Erre épül a kliens „rajta van-e már?" kérdése, hogy a rács ne indítson metaadat-lekérést.
- **`WatchlistProvider`** ([src/context/watchlist.tsx](src/context/watchlist.tsx)) — egyszer lekéri a slim listát, `getEntry(type, tmdbId)` / `add` / `remove` optimista frissítéssel és toasttal. A layoutban van bekötve, tehát a rács és a részletnézet ugyanazt az állapotot látja.
- **Származtatott státusz** ([src/lib/watchlist.ts](src/lib/watchlist.ts) `deriveStatus`): nincs „elem állapota" oszlop, a listákon megjelenő státusz a unitokból jön (bármelyik letöltés alatt → `DOWNLOADING`, mind kész → `DOWNLOADED`, mind hibás → `FAILED`, minden még megszerzendő rész csak jövőben jelenik meg → `UPCOMING`). A `trackedUnits` a monitorozott évadok unitjait **és** minden nem-`PENDING` unitot számolja, hogy egy azonnali (monitorozás nélküli) letöltés is `DOWNLOADING`-nak látszódjon. A film egyetlen unitja mindig benne van, így ugyanez a szabály filmre is a saját állapotát adja vissza.
- `/api/details` tv-nél visszaadja az évadlistát is (cache-elt `getTvSeasons`), így a részletnézeten watchlistre tétel **előtt** is látszanak az évadok — a togglék csak felvétel után aktívak.
- `Switch` komponens hozzáadva (`@radix-ui/react-switch` + [src/components/ui/switch.tsx](src/components/ui/switch.tsx)).
- A részletnézet tartalma `absolute`-ból normál folyamba került, különben a hosszú évadlistával nem lehetett scrollozni (a backdrop maradt absolute alatta).
- A hardcode-olt `http://localhost:3000` fetchek relatív URL-re cserélve a részletnézeten és a discover oldalon.
- A sidebar `isActive` a `useParams` helyett `usePathname`-re váltott, különben a `/watchlist` alatt is az "All" menüpont világított volna.

### Fázis 4 — Keresés ✅
- [x] `GET /api/search?q&page` — TMDB `search/multi` (`TMDB_LANGUAGE`, `include_adult=false`), a `person` találatok kiszűrve, a meglévő `Media` típusra mappelve. Nincs cache-elve: egy frissen felvitt cím azonnal jelenjen meg.
- [x] Searchbar bekötése: kontrollált input, 350 ms debounce → `/search?q=…`, `Enter` azonnali keresés, `Escape` ürítés, `/` billentyűvel fókusz. A `/search` oldalon `router.replace` megy `push` helyett, hogy a gépelés ne töltse tele a history-t; a keresősáv más oldalra lépve kiürül, megosztott linken visszatöltődik.
- [x] `/search?q=…` oldal ugyanazzal a `MediaCard` griddel (badge, jobbklikk-menü, azonnali letöltés), skeleton töltés közben, `Load more` a lapozáshoz.
- [x] TMDB → `Media` mappelés egy helyre (`toMedia`) — eddig három helyen volt duplikálva. Poszter nélküli találatnál eddig `…/w500null` URL keletkezett; most üres string + `no poster` placeholder a kártyán (keresésnél ez valós eset, kb. minden 20. találat).
- [x] Elhalt kód eltávolítva: `SearchFormContext` (a törött `submit` listener miatt létezett) és a discover oldal üres „Search results" ága.
- [ ] *Opcionális:* dropdown gyors-előnézet a keresősáv alatt. Szándékosan kimaradt — a `MediaCard` context menüje nem férne el benne, és a teljes oldal ugyanazt adja.

### Fázis 5 — Discover bővítése ✅
- [x] **Több sáv, oldalanként külön kategóriákkal.** A régi működés 3 oldalnyi *ugyanolyan* trending listát töltött be három sorba; most minden sor másik TMDB végpont.
  - `/` → Downloading now, Ready to watch, On your watchlist, Trending today, Popular movies, Popular series, On the air, Coming soon, All time favourites
  - `/movies` → Trending, Popular, Coming soon, All time favourites
  - `/series` → Trending, Popular, Airing today, On the air, All time favourites
- [x] **Genre-szűrők** a `/movies` és `/series` oldalon (vízszintesen görgethető chipek). A `/`-on szándékosan **nincs**: a TMDB genre id-k típusonként eltérnek (film `28:Action`, sorozat `10759:Action & Adventure`), egy közös lista hazugság lenne. Genre kiválasztásakor a sávok helyett egy szűrt rács jön.
- [x] **Végtelen scroll** a genre-szűrt rácson (`IntersectionObserver`, 400px `rootMargin`), duplikátum-szűréssel: a TMDB ugyanazt a tételt visszaadhatja két oldalon is, ha közben változik a népszerűségi sorrend.
- [x] `GET /api/discover?type&category&genre&page` — a régi „3 oldal egyben" válasz helyett egy lapnyi eredmény + `totalPages`. Érvénytelen type/category kombó (`tv/upcoming`, `all/popular`) üres listát ad, a sor egyszerűen nem jelenik meg.
- [x] `GET /api/genres?type` — TMDB genre lista, cache-elve.
- [x] Ismeretlen útvonal (`/valami`) mostantól **404** — eddig a discover oldalt rajzolta ki bármilyen egyszegmenses URL-re.
- [x] Külön, rövidebb cache a discover soroknak (`DISCOVER_CACHE_TTL_MINUTES`, default 60) — a 12 órás metaadat-TTL a trendinghez túl hosszú.

#### Főoldal-átépítés streaming minta alapján (2026-08-06)

Az első verzió sorai erősen ismételték egymást. **Mérve:** 6 sor × 20 hely = 120 helyen mindössze **85 különböző cím**, 35 ismétlés; a `now_playing` a `popular` filmek **15/20**-át megismételte, a `trending` pedig 8-at. Ugyanez a `/movies` oldalon is fennállt.

Két forrást néztem meg:
- **Netflix Page Generation** — a lapösszeállító *kiszűri a duplikációkat a sorok között*, és a hasonló műfajú sorok ismétlődését is kerüli, hogy megmaradjon az oldal változatossága.
- **Overseerr `DiscoverSliderType`** — az alapértelmezett sorrend a saját könyvtár tartalmával kezd (`RECENTLY_ADDED`, `RECENT_REQUESTS`, `PLEX_WATCHLIST`), és csak utána jön `TRENDING`, `POPULAR_MOVIES`, `UPCOMING_MOVIES`, `POPULAR_TV`, `UPCOMING_TV`. **Sem `now_playing`, sem `top_rated` nincs az alapértelmezett sorok között.**

Amit ebből átvettem:
- [x] **Sorok közötti dedup**, a sorrend egyben prioritás is: amit egy feljebbi sor megmutat, az lejjebb nem ismétlődik ([src/lib/sections.ts](src/lib/sections.ts)). Soronként 2 TMDB oldalt (40 tételt) kérünk le, hogy a 20-as sor a dedup után is tele maradjon. **Eredmény: 122 hely / 122 különböző cím, 0 ismétlés** (`/movies` 80/80, `/series` 100/100).
- [x] **Személyes sorok legelöl** (Overseerr mintája): `Downloading now`, `Ready to watch`, `On your watchlist` — a watchlist DB-ből, TMDB metaadattal. Üres sor nem jelenik meg.
- [x] **Hero/billboard** a lap tetején ([src/components/media-hero.tsx](src/components/media-hero.tsx)): backdrop kép, cím, leírás, Download / Watchlist / Details gombok. A `backdrop_img` eddig le volt kérve, de sehol nem használtuk. A hero címe a dedupban elsőként foglalt, tehát nem ismétlődik lejjebb.
- [x] **`Now playing` sor törölve** (kérésre és a mérés alapján is), a `top_rated` viszont maradt: a mérés szerint 0–1 átfedése van a többi sorral, tehát valódi változatosságot ad.
- [x] A dedup a `/movies` és `/series` nézetre is érvényes, mert ott is fennállt ugyanez.
- [x] `GET /api/discover/sections?view=home|movies|series` — a kész, dedupált sorok egy kérésben. A sorok kliens oldali, egymástól független letöltése nem tudna dedupálni.
- [x] A `useDownload` hook kiemelve ([src/hooks/use-download.ts](src/hooks/use-download.ts)), mert a kártya és a hero is használja.

### Fázis 6 — Torrent-kiválasztás finomítása
- [x] Konfigurálható felbontás-prioritás, kodek-preferencia, indexer-prioritás, méret-küszöbök, kizáró kulcsszavak (env-ben; DB-s Settings a Fázis 8-ban).
- [x] Pontozó függvény + hamis-release védelem (cím/év egyezés, minimum méret a bemondott felbontáshoz).
- [x] **Cím-egyezés javítása: a season packek nagy része hibásan kiesett** (2026-08-07, a pack-szabály mérése közben derült ki). A `PTT.parse()` bent hagyja az évad-jelölőt a címben, ha nem követi olyasmi, amit metaadatnak ismer fel: a `Ted Lasso S01 1080p` címe `"Ted Lasso S01"` lett, ami nem egyezett a `"Ted Lasso"`-val, tehát „más sorozatnak" számított. Most a záró évad-jelölő (`S01`, `S01-S02`, `Season 1`, opcionális `COMPLETE`) levágásra kerül a összehasonlítás előtt.
  - Mérés a saját indexereiden, pontozásig eljutó jelöltek száma **előtte → utána**: Ted Lasso S1 **2 → 12** (54 találatból), Severance S1 **4 → 16** (62-ből), Game of Thrones S1 **1 → 15** (153-ból).
  - A védelem megmaradt: a `The Odyssey The Making Of An Epic` és az `A Game of Leopard Thrones` továbbra is elutasításra kerül. A maradó cím-eltérések is jogosak (idegen nyelvű dupla címek, filmzene-album, félrecímkézett epizódok).
  - Az epizód-keresést nem érintette (ott a `S01E01` alakot a PTT eddig is helyesen bontotta), tehát ez kifejezetten a pack-ág vakfoltja volt — pont azé, amelyikre az új szabály most sokkal többször támaszkodik.
- [x] **Epizód-torrent vs. season pack** (átdolgozva 2026-08-07). A régi `PACK_AFTER_ATTEMPTS` (előbb N sikertelen egyedi próbálkozás, csak utána pack) megszűnt. Az új szabály (`shouldUsePack`) két esetben választ packot:
  1. az adott rész **egyedileg nem elérhető** — akár a kézi letöltés, akár a scanner kéri;
  2. az évad **teljes egészében megjelent, és még egyetlen részét sem töltöttük le** — ilyenkor egy torrent jobb, mint tíz külön keresés, ami mind sikerülhet vagy nem.
  - Ha az évadból már van letöltött vagy töltés alatti rész, a pack kiesik: azokat a fájlokat másodszor is lehúzná.
  - Ehhez a `planSeasonGrab` **mindig** megkeresi a packot (eddig csak akkor, ha valami egyedileg hiányzott), különben a 2. eset sosem tudna lefutni.
  - A pack mostantól az évad **összes még megszerzendő** epizódját megjelöli, nem csak azokat, amelyek ebben a körben esedékesek voltak — egy torrent úgyis mindet hozza. (Ez a Fázis 6-os „több-epizódos átfedés" gond pack-ágát megszünteti; a nem teljes évadot lefedő `S01E01-E06` típusú release-ekre továbbra is nyitott.)
  - A döntés egy közös függvényben van ([src/lib/grab.ts](src/lib/grab.ts) `planSeasonGrabs`), amit a scanner és a `/api/download` is hív, tehát a kettő nem tud eltérni.
- [x] **Nyelvi preferencia** — `QUALITY_PREFERRED_LANGUAGES=hun,eng` (sorrendezett bónusz), `QUALITY_EXCLUDE_LANGUAGES` (33 nyelv alias-táblával: `ITA` / `Italian` / `italiano`), `QUALITY_DEFAULT_LANGUAGE=eng` a jelöletlen release-ekre, `QUALITY_LANGUAGE_BONUS`, és `QUALITY_LANGUAGE_FIRST=0|1` — utóbbi dönti el, hogy a nyelv a felbontás fölé vagy alá kerül a pontozásban. Sorrend alapból: `felbontás → nyelv → indexer → seeder → kodek`.
  - A kizárás a TMDB `original_language`-hez képest működik: egy japán vagy francia film **saját nyelvű** release-e sosem esik ki, csak a szinkron/dub verziók. Enélkül egy fix kizárólista a nem angol eredetijű filmeket teljesen ellehetetlenítené.
  - A nyelv-tag csak a **cím utáni** részben számít (év / felbontás / `S01E01` után), különben a `Dan in Real Life` dán release-nek látszana. Élőben ellenőrizve: `Dan.in.Real.Life`, `Danish.Girl`, `Indiana.Jones` → nincs találat, `…ITA`, `…HUN`, `…JPN` → helyes.
  - A záró release-group levágását megmértem: 1099 valós release-ből **egyszer** számított, és ott egy igazi `HuN` tag veszett volna el (`…DoVi-HDR.HEVC.HuN.TRiNiTY`), hamis pozitív nulla — ezért nincs levágás.
  - Mérés a saját indexereiden: Dune Part Two 147 találatából 6 német/francia esett ki, Ted Lasso S01E01 50 találatából 2 francia; a magyar release-ek a jelöletlenek elé kerültek. `QUALITY_LANGUAGE_FIRST=1`-gyel a 720p HUN megelőzi az 1080p jelöletlent.
- [x] **Meg nem jelent tartalmat ne keressen** (2026-08-07-i kérés). Epizódnál ez eddig is így volt (`scanEpisodes`: `airDate` ismert és múltbeli), **filmnél viszont nem** — egy még be sem mutatott film 30 percenként keresésre került, és `MAX_SEARCH_ATTEMPTS` után `FAILED`-re állt volna. Most a film unitjának `airDate`-je a TMDB megjelenési dátuma, a `scanMovies` pedig ugyanúgy szűr rá. Ismeretlen dátum nem blokkol (a film kereshető marad).
  - A dátumot a `refreshMetadata()` (a régi `refreshShows`) tartja frissen, mert a TMDB tologatja a megjelenéseket; ez a kör a `runScan`-ben előre került, hogy a scanner már friss dátumból döntsön. A `syncDownloads`-hoz hasonlóan **dry-runban is ír**: nem indít semmit, csak követi a TMDB-t — és pont ezekre a dátumokra támaszkodik a visszatartás.
  - Élőben ellenőrizve: a három meglévő film dátuma magától kitöltődött, egy jövőbeli dátumú filmet (`The Last Sunrise`, 2026-08-26) felvéve a `scanMovies` átugrotta, a két megjelentet feldolgozta.
  - Ez a *mozis* bemutató dátuma, tehát egy már bemutatott, de trackeren még nem elérhető film (mint a The Odyssey) továbbra is keresésre kerül. Ez viszont a **növekvő várakozással** (Fázis 7) már nem probléma: napi egy ellenőrzésre ritkul, és soha nem adja fel — így nem kell a TMDB `release_dates` digitális dátumát behúzni.
- [x] **Több évadot fedő pack** (`S01-S03`) (2026-08-08). A hash eddig csak a keresés évadára íródott rá, a többi évad epizódja `PENDING` maradt és külön letöltésre kerülhetett — ugyanaz az anyag kétszer. Most a `packUnitIds()` a release nevéből (`parseNumbering().seasons`) kiolvassa az összes lefedett évadot, és a `GRABBABLE_STATUS`-ú unitjaikat is a pack hashére jelöli. A már letöltött/letöltés alatti epizódokhoz nem nyúl.
- [x] **Több-epizódos release átfedése** (2026-08-08). Egy `S01E01-E06` release akkor is mind a hatot lehozza, ha csak egy epizódra lett kiválasztva. A `planGrabs` mostantól minden release-re ráírja azt is, amit a neve alapján egyébként is hoz (a `claimable` halmazból, azaz amire az évadnak még szüksége van), és **átfedésnél a szélesebb release nyer** — a szűkebb grab kiesik.
  - Ellenőrizve eldobható adatokon: `E01`-hez saját release, `E02–E06`-hoz az `S01E01-E06` → korábban 2 torrent (a range + még egyszer az E01), most **1 torrent, E01–E06**. Csak `E02–E03`-at kérve is az egész range-et foglalja le, tehát a maradék négy epizódra nem indul második letöltés. Az `S01-S03` pack a 2. és 3. évad unitjait is megjelölte, a már letöltött `S02E01`-et kihagyva.
- [x] **Pack méret-plafon** (2026-08-07) — `QUALITY_MAX_PACK_SIZE_PER_EPISODE_GB=5`, alapból bekapcsolva, a `QUALITY_MAX_SIZE_GB`-tól függetlenül (az 0, tehát eddig egyáltalán nem volt felső korlát). A kettő közül a szigorúbb érvényesül. Azért kellett, mert az új pack-szabállyal egy teljesen megjelent, még el nem kezdett évadnál alapból a pack nyer.
  - Mérés a Ted Lasso S1-en (54 találat, 10 rész, 50GB-os plafon): a plafon **2 release-t utasít el** (a legnagyobb 54,8GB), de a **választást nem változtatja meg** — az 1080p-s 12,5GB-os pack egyébként is nyer. Vagyis ez biztosíték, nem napi hatás.
- [x] **Hamis tartalom letöltés közben** (2026-08-08) — a release nevére épülő védelem elvi határa, hogy a nevet a hamisítvány pontosan lekopírozhatja. A `syncDownloads` ezért a fájllistát is megnézi (`payload.ts`), és a megjelenési dátumot már egyetlen hívó sem kerülheti meg. Részletek és mérés: lásd a lenti „Meg nem jelent rész letöltése" alfejezetet.
- [x] **Stall-kezelés** (2026-08-08). Eddig csak az `error`/`missingFiles` állapot és az eltűnt torrent számított hibának — egy órákig 0 B/s-en álló letöltés a végtelenségig `DOWNLOADING` maradt, és mivel a unit már nem `PENDING`, a scanner sem kereste újra. Ez volt az utolsó mód, ahogy egy elem némán elveszhetett.
  - **Mikor számít elakadtnak** ([src/lib/stall.ts](src/lib/stall.ts)): a torrent nem kész és nem hibás, **és** a qBittorrent szerint `stalledDL` vagy `metaDL` (magnet, aminek sosem jött meg a metaadata), vagy 0 a letöltési sebessége — **és** a `progress` a teljes `STALL_MINUTES` (default 60) alatt egyszer sem mozdult. Bármilyen haladás nullázza az órát, tehát egy lassú letöltés soha nem esik áldozatul.
  - **Mi történik**: a torrent a fájljaival együtt törlődik (`STALL_DELETE_FILES=1`, egy félkész fájl nem érték), a release neve **feketelistára** kerül, a unitok `PENDING`-re állnak `lastCheckedAt: null`-lal (tehát azonnal esedékesek) és eggyel több próbálkozással.
  - **A feketelista** a `rateRelease`-ben szűr (`already tried and dropped` — 2026-08-08 óta a hamis tartalmú torrentek is ide kerülnek, ezért lett általánosabb a szöveg), normalizált release-név alapján — a qBittorrent a release nevén nevezi el a torrentet, ezért ez összeér. Memóriában él, a folyamat élettartamára: egy újraindítás után egy dead release újra kipróbálható, ami elfogadható ár azért, hogy ne kelljen hozzá tábla.
  - **Az óra is memóriában van** (hash → `{ progress, since }`), így nincs migráció; egy újraindítás annyit jelent, hogy a számláló újraindul, ami egyórás küszöbnél nem számít.
  - **Dry-runban csak logol**: a torrent-törlés valódi, fájlokat érintő művelet, azt a dry-run szándéka szerint nem szabad megtennie.
  - Ellenőrizve: 61 perc mozdulatlanság után elakadtnak jelöl, közben 0.30 → 0.31 haladásra újraindítja az órát; a **`stalledUP`** (kész torrent, akinek nincs kihez seedelnie — a te két torrented pontosan ilyen) két óra után sem elakadt; feketelistázás után ugyanaz a release `picked=false`, `reason="already tried and dropped"`.

### Fázis 7 — Robusztusság / üzemeltetés
- [x] A scanner retry/backoff-ja megvan (`searchAttempts`, `lastCheckedAt`), az indexer-hívások hibái nem dobnak, csak logolnak és üres listát adnak, a torznab `error` válasz (pl. `203`) fallbackot indít.
- [x] **Növekvő várakozás, plafon nélküli újrapróbálkozás** (2026-08-07-i kérés). Eddig `MAX_SEARCH_ATTEMPTS=10` és fix 30 perc volt: egy elem **5 óra alatt** elérte a 10 próbálkozást, `FAILED` lett, és a `dueFilter` (`searchAttempts < MAX`) **soha többé nem vette elő** — vagyis az app pont azokat adta fel, amiket figyelnie kellett volna (még meg nem jelent, vagy trackeren még nem fent lévő tartalom). Most a várakozás duplázódik (`SEARCH_BACKOFF_MINUTES=30` → 1h → 2h → 4h → … `SEARCH_MAX_BACKOFF_HOURS=24`), és nincs feladás.
  - A `dueFilter` a lekérdezésben csak durva előszűrő (a legrövidebb lehetséges várakozás), a soronkénti backoffot az `isDue` alkalmazza JS-ben. Így a `.env` átírása azonnal hat, nem fagy bele egy tárolt `nextCheckAt` oszlopba — és nem kell hozzá migráció sem.
  - A `MAX_SEARCH_ATTEMPTS` és a `PACK_AFTER_ATTEMPTS` env-változó ezzel **kikerült a kódból**; ha a `.env`-edben bent maradtak, egyszerűen figyelmen kívül maradnak.
  - A `WatchStatus.FAILED`-et így **semmi nem állítja be automatikusan**. Az enum benne marad (a `deriveStatus`, a badge és a `GRABBABLE_STATUS` kezeli), későbbi kézi „feladom" funkcióhoz.
  - Élőben ellenőrizve: `attempts=5` + „1 órája nézve" → a scanner kihagyta (a backoff ekkor 16h); „20 órája nézve" → feldolgozta, és `attempt 6, next in 24h` került a logba.
- [x] A háttér-job logol minden döntést (`[scheduler] …`: mit talált, mit indított, mi hibázott, hányadik próbálkozás).
- [x] `discover` route hibakezelése: a catch-ág nem `return`-ölt, csak konstruált egy eldobott `Response`-t — most logol, és a hibás oldal egyszerűen kimarad az eredményből.
- [x] **`entrypoint.sh` dev módja** (2026-08-07) — korábban csak a Prisma Studio-t indította, a Next dev szervert kézzel kellett elindítani a konténerben. Mivel a `startScheduler()` az `instrumentation.ts`-ből, **a Next szerverrel együtt** indul, ez azt jelentette, hogy alapból semmilyen háttérkör nem futott — a 2026-08-06-i „kész letöltés nem került át" hiba részben ebből jött. Most a Studio a háttérbe kerül, a dev szerver pedig `exec bun run dev`-vel a fő processz.
  - Következmény: a konténer a dev szerver élettartamáig él. Ha a dev szerver kilép, a konténer is leáll (`docker compose up -d aioseerr_app` hozza vissza) — cserébe egy néma, nem futó szerver nem maradhat észrevétlen.
  - A `[ $APP_ENV == … ]` idézőjelbe került: beállítatlan `APP_ENV` mellett a script eddig szintaktikai hibára futott volna.
  - Az `entrypoint.sh` a Dockerfile-ba van másolva, tehát a módosítása **image-újraépítést igényel**: `docker compose up -d --build aioseerr_app`.
  - Nyitva marad: a dev ág nem futtat `bun install`-t és `prisma generate`-et (a prod ág igen), tehát egy friss klón nem indulna magától — az első indítás előtt ezeket kézzel kell lefuttatni.
- [x] **Git repo** — `git init -b main`, első commit 76 fájllal (8094 sor). A `.gitignore` javítva: a generált Prisma kliens `prisma/generated` alatt van, de a `.gitignore` a `/src/generated/prisma` halott útvonalat zárta ki, így 4,9 MB generált kód került volna be. Bekerült még a `/.claude/settings.local.json` és a `/.verify-*.ts` is.
  - Commit előtt ellenőrizve: a `.env`, `node_modules`, `.next`, `prisma/generated` egyike sincs staged-elve, és a `.env` egyetlen valós értéke (TMDB / Jackett / qBittorrent / DB) sem fordul elő a commitolt 76 fájl egyikében sem.
  - **Remote nincs** és push sem történt — az a te döntésed. Előtte érdemes újra lefuttatni ugyanezt az ellenőrzést.
- [x] **`.env.example`** — mind a ~40 env-változó értékek nélkül, kommentelve. A `.env` gitignore-olt, enélkül egy friss klón nem lenne indítható.
- [x] **Duplikált `prisma.config.ts`** (2026-08-08) — a `prisma validate` kiírja, melyiket tölti be (`Loaded Prisma config from prisma.config.ts`, a repo gyökeréből, mert a CLI a munkakönyvtárból indul). A `prisma/prisma.config.ts` halott volt, törölve; a `validate` és a `migrate status` utána is hibátlan.
- [x] **CRLF sorvégek** — `.gitattributes` (`* text=auto eol=lf`), 2026-08-07.
- [x] **Lint** (2026-08-08) — 78 találatról nullára. A többsége gépies volt (`prefer-const`), egy valódi elgépelés is kijött: a `tooltip.tsx`-ben egy magányos `1` állt utasításként a provider után. A keresősáv debounce-effektje mostantól a `navigate`-re hivatkozik (`useCallback`), nem megy el mellette. A maradék 35 `any` mind a három külső formátumot olvasó fájlban volt (TMDB, torznab, qBittorrent) — ott a szabály fájl-szinten kikapcsolva, indoklással az `eslint.config.mjs`-ben; máshol továbbra is hiba.
- [x] **Letöltési mappák** (2026-08-08) — `TORRENT_MOVIE_PATH` és `TORRENT_SERIES_PATH`; ha üresek, minden marad a kategória saját könyvtárában (a régi viselkedés). A qBittorrent `add` hívás `savepath` mezőjét használja, a kategória nem változik, tehát a sync és a `listManagedTorrents` szűrése érintetlen.
- [x] **Kattintás → adatlap várakozása** (2026-08-08) — `loading.tsx` boundary, szerver oldalon renderelt adatlap, a dupla sections-kérés és a provider-újrarenderelések megszüntetése. Mérésekkel: lásd a lenti „Kattintás → adatlap" alfejezetet.
- [ ] **Seedelés/utómunka**: nincs semmilyen kezelés arra, hogy egy kész torrent meddig seedeljen, és a fájlok átnevezése/rendezése sem történik meg (médiaszerver-integráció nélkül ez a kliens dolga marad).

### Fázis 8 — Későbbi, opcionális
- [ ] Settings UI (indexer/torrent/TMDB/minőségi profil DB-ből szerkeszthetően, ne csak `.env`) — ide tartozik az indexer-prioritás és a minőségi profil felületről állítása is.
- [ ] Értesítések (böngésző push / Telegram / Discord webhook), amikor egy watchlist-elem letöltésre készen áll.
- [ ] Több felhasználó / auth, ha nem csak személyes használatra kell.
- [ ] Médiaszerver-integráció, ha később mégis felkerül Plex/Jellyfin/Emby.
- [x] **Epizód-szintű nézet és választás** — lásd a lenti alfejezetet (2026-08-07).
- [x] **Évad-monitorozás kézi váltása a felületen** — ugyanott; a régi, sosem hívott `PATCH /api/watchlist/:id/seasons/:n` végpont helyére a `PATCH /api/watchlist` lépett.
- [x] **`Stop watching` vs. `Delete` szétválasztva** (2026-08-07-i kérés) — lásd a lenti alfejezetet.

#### „Figyelem" és „megvan a lemezen" szétválasztása (2026-08-07-i kérés) ✅

Eddig egyetlen művelet volt: a watchlistről levétel **törölte a sort**, amivel a letöltött film egyszerre eltűnt a `Downloaded` listáról is, a torrent pedig ott maradt a kliensben. Mostantól két különböző dolog:

| művelet | mit csinál |
|---|---|
| **Stop watching** (`/watchlist`, kártya-menü, részletnézet) | csak leveszi a figyelést (`monitored = false`). A torrenthez **nem nyúl**. Ami már letöltött, az megmarad és továbbra is látszik a `Downloaded` alatt. Ha nincs mit megőrizni (semmi nem letöltött és nem fut), a sor kikerül. |
| **Delete** (`/downloaded`) | a torrentet **kiveszi a qBittorrentből is**, és rákérdez, hogy a fájlok mehetnek-e vele. Utána a sor eltűnik, és nem tölti le újra. |

- A `/watchlist` mostantól nem mutatja azt, ami letöltött és már nem figyelt — az a `Downloaded` alá tartozik. Ehhez a DTO-ba bekerült a `monitored` flag.
- **Ha a torrentet a qBittorrentben törlöd**, a `syncDownloads` észreveszi, és egy *már befejezett* letöltésnél ezt „megnézve és törölve"-ként értelmezi: a unit elfelejtődik (`monitored=false`, `PENDING`, hash nélkül) és a sor kiürülve törlődik — **nem** indul újra a letöltés. Egy *félbemaradt* letöltésnél a régi viselkedés marad (visszaáll `PENDING`-re és újra keres), mert ott az eltűnés jellemzően megszakadt/hibás torrentet jelent. Ha ezt is „nem kérem"-ként kell értelmezni, az egy sor.
- A „felejtés" szándékosan nem sortörlés: egy sorozatnál a `syncTvSeasons` visszahozná az epizód-unitot, és az évad beállítását örökölve **újra letöltené**. Így viszont a unit megmarad nem figyeltként, tehát a scanner nem nyúl hozzá.

**Élő ellenőrzés** (eldobható sorokon, a te adataidhoz nyúlás nélkül): letöltött elem `Stop watching` után megmaradt `DOWNLOADED`/`monitored=false` állapotban; letöltés nélküli elem sora eltűnt; a kliensből eltűnt kész torrent a `movie 13: removed from the client after finishing, treated as watched and deleted` sorral takarításra került; a `Delete` a torrent-eltávolítással együtt lefutott.

- **Nyitva:** egy részben letöltött sorozat (pl. 1/30 epizód) nem jelenik meg a `Downloaded` alatt, mert a származtatott státusza nem `DOWNLOADED`. Ha a `Downloaded` inkább „mi van a lemezen" nézet, akkor ott epizód-szinten kellene listázni.

#### Epizódonkénti választás és élő watchlist-pipák (2026-08-07-i kérés) ✅

Két kérés, egy felület: (a) évadon belül epizódonként is lehessen választani, (b) egy watchlisten lévő sorozat adatlapján látszódjanak a watchlistelt részek, és a pipa ki/bevétele módosítsa is a watchlistet.

**A pipa jelentése egységes lett: a pipa *maga* a watchlist.** Nincs külön „kijelölés" és „watchlist" állapot — egy epizód bepipálása azonnal felveszi (és ha a sorozat még nincs a listán, létrehozza a sort), a kiszedése levéve. Ha az utolsó pipa is kikerül, és nincs se letöltés alatti, se letöltött epizód, akkor **a sorozat egésze lekerül a watchlistről** (`pruneWatchlistItem`) — különben egy „semmit sem figyelünk" sor maradna a listán.

- A művelet `tmdbId` alapján megy (`PATCH /api/watchlist`), nem sor-azonosító alapján: az első pipánál még nincs sor, amire hivatkozni lehetne.
- A `GET /api/watchlist/:id` mostantól epizódonkénti állapotot is ad (`monitored`, `status`, `airDate`); a **lista-végpont szándékosan nem**, mert ott minden sorozat minden epizódja fölöslegesen utazna.
- A `Download` gomb a bepipált epizódokat tölti (`planSeasonGrab` / `executeSeasonGrab` `episodeNumbers`-e eddig is tudta ezt, csak a felület nem használta). Ha egy évad összes epizódja ki van pipálva, üres epizódlista megy — az a szerveren „teljes évadot" jelent, így a season pack útja megmarad.
- A „nem elérhető" dialógus is pontosabb lett: már csak a *ténylegesen hiányzó* epizódokat teszi figyelt állapotba, nem az egész évadukat.
- Új komponens: [src/components/season-picker.tsx](src/components/season-picker.tsx) — lenyitható évadok, félig kipipált évadnál `indeterminate` állapot (ehhez a shadcn `Checkbox` kapott egy `MinusIcon`-os ágat, eddig üres keretben mutatott pipát), epizódonként cím, dátum és letöltési állapot.
- **Az az évad, amiben van watchlistelt rész, alapból nyitva van.** A nyitott halmaz az első kattintásig a watchlistből származik, utána a felhasználó döntése viszi — és minden pipa-váltás előtt „befagy", különben az évad utolsó pipájának kiszedése becsukná az évadot a kurzor alatt.

**Élő ellenőrzés:** nem watchlistelt sorozat `S1E3`-át bepipálva létrejött a sor egyetlen figyelt epizóddal (`episodeCount=1`), a teljes `S2`-t bepipálva 10/10 lett, visszavéve újra 1, az utolsó pipa kiszedésekor pedig a sor eltűnt. A watchlist a teszt előtti állapotában maradt, a te `#17`-es sorozatod érintetlen.

#### Bejelentés: a kész letöltés nem került át a „letöltöttek" közé (2026-08-06) ✅ javítva 2026-08-07

**Tünet:** a Mortal Kombat II letöltése lement a qBittorrentbe, be is fejeződött, de az aioseerr továbbra is `DOWNLOADING`-ot mutat.

**Csak olvasó diagnózis (2026-08-06), az élő rendszeren:**
```
DB  #15 tmdb 931285 DOWNLOADING hash=b8029ac0…8246 updated=2026-08-06T20:57:02
qB  b8029ac0…8246  100.0%  stalledUP  isComplete=true  tags=[aioseerr-movie-15]
    Mortal.Kombat.II.2026.1080p.MA.WEBRip.DDP5.1.Atmos.x264.HUN-FULCRUM
->  a syncDownloads() logikája szerint ez DOWNLOADED lenne
```
Tehát **a torrent, a tag és a hash is stimmel, és a `syncDownloads()` helyesen ismeri fel késznek** — a párosítás nem hibás. A státusz azért nem változik, mert a sync **soha nem fut le**, két egymástól független ok miatt:

1. **A scheduler nem indult el.** A `src/instrumentation.ts` a jelenleg futó dev szerver indulása *után* jött létre, tehát a `startScheduler()` abban a processzben soha nem hívódott meg. Ezt közvetve az is alátámasztja, hogy a #14-es sor (The Devil Wears Prada 2) hash-e **már nincs benne** a qBittorrent listájában — egy futó scheduler ezt régen `PENDING`-re állította volna.
2. **`SCAN_DRY_RUN=1`.** Ez nem csak a letöltés-indítást tiltja: a `syncDownloads()` **összes** DB-írása is `if (! isDryRun())` mögött van. Vagyis még ha a scheduler futna is, dry-run módban a kész letöltés akkor sem kerülne át.

*(Megjegyzés a kiválasztáshoz: a választott release `1080p … x264 … HUN` — pontosan az, amit a mostani minőségi profil preferál. A kiválasztás tehát jól működött, csak a visszaolvasás nem.)*

**Javítás (2026-08-07)** — [src/lib/scheduler.ts](src/lib/scheduler.ts):

- [x] **A `syncDownloads()` kikerült a dry-run tiltás alól.** A dry-run szándéka az, hogy *ne induljon letöltés* — a sync viszont semmit nem indít, csak visszaírja azt, amit a kliens már megtett. Ezt elrejteni azt jelentette, hogy egy kész letöltés örökre `DOWNLOADING`-ban ragad. A `scanMovies` / `scanEpisodes` / `refreshShows` továbbra is néma dry-runban.
- [x] **A log-marker szétvált.** A sync sorai `[scheduler]` előtaggal mennek, a ténylegesen szimulált scan soroké maradt `[scheduler] [dry-run]`. Enélkül a marker azt sugallta volna, hogy a sync sem írt semmit — pont az a félreértés, ami ehhez a hibához vezetett.
- [x] **`resolveTorrent()`: hash szerinti ellenőrzés a „torrent eltűnt" döntés előtt.** A `listManagedTorrents()` a `TORRENT_CATEGORY`-ra szűr, tehát egy kategóriát vesztett (de élő) torrent „eltűntnek" látszott, a sor visszaesett volna `PENDING`-be, és **duplikált letöltés indult volna**. Most a kategóriás listából való hiányt egy `getTorrentStatus(hash)` hívás erősíti meg, ami nem szűr kategóriára.

**Élő ellenőrzés (2026-08-07, végig `SCAN_DRY_RUN=1` mellett):**
```
--- before ---
#14 tmdb=1314481 MOVIE DOWNLOADING hash=1718aa59
#15 tmdb=931285  MOVIE DOWNLOADING hash=b8029ac0
[scheduler] movie 1314481: torrent is gone from the client, queued for a new search
[scheduler] movie 931285: downloaded (Mortal.Kombat.II.2026.1080p…x264.HUN-FULCRUM)
--- after ---
#14 tmdb=1314481 MOVIE PENDING    hash=-
#15 tmdb=931285  MOVIE DOWNLOADED hash=b8029ac0
```
A második futás már nem csinál semmit (idempotens), és a kör alatt egyetlen letöltés sem indult. A `resolveTorrent()` negatív ága (#14: a hash-lekérdezés is `false`) élesben lefutott; a pozitív ága (létezik, csak kategórián kívül) nincs élesben tesztelve, mert ahhoz a kliensben kellene kategóriát váltani.

**#14 (The Devil Wears Prada 2):** a kategóriára nem szűrő ellenőrzés is `existsInClient=false`-t adott, a fájl pedig nincs meg a lemezen — a torrent tényleg félbemaradt. A sor helyesen esett vissza `PENDING`-be; a scanner újra fog keresni rá, amint a dry-run kikapcsol.

**Ami ebből nyitva maradt:** a sync csak akkor fut, ha fut a Next dev szerver, azt pedig kézzel kell indítani (lásd az `entrypoint.sh` tételt a Fázis 7-ben). Ez most a legfontosabb következménye ennek a hibának.

#### Közös `WatchlistUnit` tábla (2026-08-07-i kérés) ✅

A táblázatos nézet első fele: előbb a séma egységesítése, hogy a nézet már egységes adatra épüljön. A modell és az indoklás a **3. pontban**. Két lépésben, két migrációval:

1. `20260807180000_unified_watchlist_units` — a `WatchlistEpisode` és a `Watchlist` állapot-oszlopai egyetlen `WatchlistUnit` táblává olvadtak.
2. `20260807190000_drop_watchlist_season` — a `WatchlistSeason` is megszűnt, a `monitored` és a `seasonNumber` átkerült a unitokra. Így **két tábla maradt: `Watchlist` és `WatchlistUnit`.**

Mindkét migráció kézzel írt, nem a `prisma migrate dev` generálta: a generált változat előbb dobta volna el az oszlopokat, mint hogy az adat átkerül — az elsőnél a Mortal Kombat II `DOWNLOADED` állapotával együtt, a másodiknál az évadok `monitored` értékével együtt. Így mindkettő a régi oszlop eldobása **előtt** másol.

Érintett fájlok: [prisma/schema.prisma](prisma/schema.prisma), [src/lib/watchlist.ts](src/lib/watchlist.ts), [src/lib/scheduler.ts](src/lib/scheduler.ts), [src/lib/grab.ts](src/lib/grab.ts). A `markMovieDownloading` + `markEpisodesDownloading` egyetlen `markUnitsDownloading(unitIds, hash)`-re, a `getSeasonEpisodes` `getSeasonUnits`-ra cserélődött. **A DTO (`WatchlistEntry` / `WatchlistItem`) szándékosan változatlan**, így a UI-hoz egyáltalán nem kellett hozzányúlni — azt majd a táblázatos nézet alakítja át, egy külön lépésben.

**Élő ellenőrzés (2026-08-07).** Mindkét lépés után, ideiglenesen felvett és utána törölt teszt-sorozatokkal (a DB mindkétszer pontosan az eredeti állapotába állt vissza):

- A 3 meglévő film unitja hiánytalanul átjött, a #15 `DOWNLOADED` állapotával és hash-ével együtt.
- Egy 3 unitot lefedő pack-hash **egyetlen** log-sorban, együtt állt vissza `PENDING`-be — ez a `syncDownloads` új, hash szerint csoportosító hurka.
- `deriveStatus`: 3/5 késznél `PENDING`, 5/5-nél `DOWNLOADED`.
- Évad kikapcsolása után a `scanEpisodes` lekérdezése pontosan az érintett unitokat hagyta ki, a **film unitjaihoz nem nyúlt** (3 monitorozott film unit maradt).
- Öröklés: kikapcsolt évadba visszakerülő epizód `monitored=false`-szal jött vissza; törölt és újra létrehozott évad a legmagasabb meglévő évadot követte, mindkét irányban.
- Törléskor a kaszkád minden unitot elvitt.
- Közben te felvettél a felületen egy 8 részes sorozatot (`#17`) — az a teszteket végig érintetlenül átvészelte, és egyben élő bizonyíték rá, hogy a felületi felvétel is jól működik az új sémán.

A `tsc --noEmit` tiszta, az újraindítás utáni scan-kör a régivel azonosan futott le, és a `GET /api/watchlist` ugyanazt a szerkezetet adja vissza, mint a refaktor előtt.

#### Táblázatos watchlist és downloads nézet (2026-08-06-i kérés)

A `/watchlist` és a `/watchlist/downloaded` ma ugyanaz a poszter-rács ([src/components/watchlist-grid.tsx](src/components/watchlist-grid.tsx)), egyetlen státusz-badge-dzsel. Kérés: **mindkettő legyen táblázat**, több információval — mikor lett felvéve, mikor ellenőrizte utoljára az elérhetőséget, letöltés közben hány százalékon áll, stb. (A discover/keresés marad rácsos, ott a poszter a lényeg — a könyvtár-nézetek viszont adatnézetek, mint a Sonarr sorozatlistája.)

**Mi van már meg, csak nincs kiadva a UI-nak** (`WatchlistEntry` / `WatchlistItem` ma ezeket eldobja):
| Mező | Hol van | Megjegyzés |
|---|---|---|
| `addedAt` | már kiadva | csak nincs megjelenítve |
| `lastCheckedAt` | `WatchlistUnit` oszlop | sorozatnál a max()-ot kell venni a unitokon |
| `searchAttempts` | ugyanott | „hányadik próbálkozás / `MAX_SEARCH_ATTEMPTS`" |
| `updatedAt` | `Watchlist` oszlop | |
| `torrentHash` | `WatchlistUnit` oszlop | a qBittorrenthez való összekötéshez kell |
| `airDate` | `WatchlistUnit` oszlop | „következő epizód dátuma" számolható belőle |

**Amit a qBittorrentből kell élőben olvasni** — a `TorrentStatus` ma csak `hash`, `name`, `progress`, `state`, `tags`, `isComplete`, `isFailed`. A `/torrents/info` válasz ezen felül ad `dlspeed`, `eta`, `size`, `downloaded`, `num_seeds` mezőket is, ezeket a mappelésbe fel kell venni.
- **A százalékot nem szabad DB-be írni** — másodpercenként változik. A tábla végpontja olvassa be a DB sorokat, és `listManagedTorrents()` hívással, `torrentHash` alapján kösse hozzá az élő állapotot. Egy qBittorrent-hívás az egész táblára.
- Ha a qBittorrent nem elérhető, a tábla a DB-állapottal jelenjen meg, százalék nélkül (ne dőljön el az oldal).

**Amit sehol nem tárolunk, és el kell dönteni, kell-e** (ez az egyetlen pont, ami sémamódosítást igényelne): a kiválasztott release **neve, mérete, seeder-száma, felbontása, indexere**. Amíg a torrent él a kliensben, a `name` proxyként használható, de egy befejezett/eltávolított letöltésnél elveszik. Ha a `downloaded` oldalon látni akarod, hogy *melyik* release jött le, akkor kell pár oszlop — a `WatchlistUnit` egységesítése óta **egy** helyre, nem kettőbe.

**Tervezett oszlopok** (`/watchlist`): poszter-bélyeg + cím · típus · státusz · haladás (film: %; sorozat: `X/Y epizód` + %) · felvéve · utoljára ellenőrizve · próbálkozások · műveletek (Details / Stop watching).
**`/downloaded`**: poszter-bélyeg + cím · típus · epizódszám · elkészült (`updatedAt`) · felvéve · release neve (ha eltároljuk) · műveletek.

**Eldöntött kérdések (2026-08-07) és a megvalósítás ✅**
- **Rendezés/szűrés kliens oldalon** — egyetlen lekérés, az oszlopfejlécre kattintás és a státusz-szűrő azonnal hat.
- **Poszter-bélyeg a sor elején** (Sonarr-módra), poszter nélküli elemnél kis „no img" keret.
- **Mobilon vízszintes görgetés** — a shadcn `Table` konténere `overflow-x-auto`, tehát egy implementáció. Kártyás nézet később, ha zavaró lesz.
- **Automatikus frissítés**, amíg van `DOWNLOADING` sor: 5 mp-es polling, ami magától leáll, ha nincs aktív letöltés.

Megvalósítás: [src/components/watchlist-table.tsx](src/components/watchlist-table.tsx) egy közös komponens `columns` tömbbel; a `/watchlist` és a `/watchlist/downloaded` ugyanazt használja, utóbbi `onlyStatus="DOWNLOADED"`-del (ott a státusz, az utolsó ellenőrzés és a próbálkozás-oszlop kimarad). A `WatchlistGrid` törölve. A shadcn `table` primitív kézzel került be ([src/components/ui/table.tsx](src/components/ui/table.tsx)).

- A `GET /api/watchlist?live=1` **egyetlen** `listManagedTorrents()` hívással köti hozzá az élő állapotot a `torrentHash` alapján; a `?live` nélküli hívás (pl. a főoldal személyes sorai) nem fizeti meg. Ha a qBittorrent nem elérhető, a lista attól még megjön, csak százalék nélkül.
- A `TorrentStatus` kiegészült: `size`, `downloadSpeed`, `eta`, `seeds`. A qBittorrent 100 napot (`8640000`) ad, ha nincs becslése — az `eta` ilyenkor `null`.
- Több torrent (több epizód egyszerre) esetén a sor összesít: százalék átlag, sebesség összeg, `eta` a leglassabbé.
- A DTO-ba bekerült a `lastCheckedAt` (a unitok közül a legfrissebb) és a `searchAttempts` (a legnagyobb).
- **Nincs „mikor készült el" oszlop**: azt sehol nem tároljuk, és az `updatedAt` a `Watchlist` soron nem mozdul, amikor egy unit állapota változik. Ha kell, egy `completedAt` oszlop lenne rá a válasz.

**`Scan now` gomb (2026-08-07-i kérés) ✅** — a `/watchlist` fejlécében (a `/downloaded`-en nincs, ott értelmetlen). A `POST /api/scan` `{ force: true }`-szal megy, ami **a növekvő backoffot kapcsolja ki**, hogy semmi ne várja ki a saját következő időpontját. A `monitored` és a státusz-feltétel megmarad — a gomb „nézd meg most, amit figyelek", nem „nézz meg mindent".

> **2026-08-08-i javítás:** eredetileg a `force` a **megjelenési dátum szerinti szűrést is** kikapcsolta („kérdezze meg most, akkor is, ami még nem jelent meg"). Ez a döntés visszavonva — pontosan ez engedett be egy kártevőt, lásd a lenti „Meg nem jelent rész letöltése" alfejezetet. A dátumot **semmilyen hívó nem hagyhatja figyelmen kívül.**

- A `force` a `planSeasonGrab`-ig lemegy, tehát a még nem sugárzott epizódokra is elindul a keresés. Az `aired` mező viszont **továbbra is a TMDB szerinti valóságot mondja**, csak a keresés kényszerített — így a pack-döntés (`shouldUsePack`, `allAired`) nem torzul el egy kézi scan miatt.
- A gomb dry-runban is használható, a toast ilyenkor kiírja, hogy valójában nem indult letöltés.
- Élő ellenőrzés: backoffba tett elem (`attempts=5`, 1 perce nézve) + egy még meg nem jelent film (2026-08-26) mellett a **normál** kör egyiket sem vette elő, a **kényszerített** mindkettőt:
```
[scheduler] [dry-run] movie 1314481: grabbing The.Devil.Wears.Prada.2…HUN-FULCRUM
[scheduler] [dry-run] manual scan: every monitored item, backoff and release dates ignored
[scheduler] [dry-run] movie 1314481: grabbing The.Devil.Wears.Prada.2…HUN-FULCRUM
[scheduler] [dry-run] movie 1368337: nothing suitable found (attempt 6, next in 24h)
[scheduler] [dry-run] movie 1516698: nothing suitable found (attempt 1, next in 1h)
```

#### Kiadásválasztó ablak minden letöltésnél (2026-08-08-i kérés) ✅

Kérés: a letöltés ne dönthessen egyedül — mutassa a legjobb 5 találatot, alapból kijelölve azt, amit a szűrő választana; ha nincs találat, kérdezze meg, mehet-e watchlistre.

Eldöntött kérdések: **egy ablak, soronként egy letöltendő torrent** (nem sorozat-ablakok egymás után), és a lista **csak a szűrőn átment találatokat** tartalmazza, a kiszűrtek darabszámával.

- Új végpont: `POST /api/download/preview` — keres, de nem tölt. A válasz soronként (`GrabChoice`) a film / a season pack / az egyes epizódok, mindegyikhez max. 5 kiadás (`DOWNLOAD_OPTION_COUNT`), és hogy hány találatot dobott el a minőségi profil.
- **A terv szerveroldalon marad** (`DOWNLOAD_PLAN_TTL_MINUTES=15`), a `POST /api/download` pedig `planId` + a választott kiadások `guid`-jai alapján tölt. Így egy keresés nem fut le kétszer (10–60 mp), és a torrent-linkek nem járják meg a böngészőt. Lejárt terv → `410`, az ablak magától újrakeres.
- A választás **átírja a tervet**, nem kerüli meg: onnantól ugyanaz a `planGrabs` → `executeSeasonGrab` lánc fut, tehát a pack- és az átfedés-szabály érvényes marad a kézi választásra is.
- A `planSeasonGrabs` `watchlistId`-ja `null` is lehet: egy még watchlisten nem lévő sorozat előnézete így nem hoz létre sorokat mellékhatásként.
- Az adatlap régi, utólagos „Not available yet" dialógusa megszűnt — ez a kérdés most ugyanennek az ablaknak az alja (`Nothing found for … — tedd watchlistre`), és részleges találatnál a letölthető sorok mellett jelenik meg.
- Új: [src/lib/download-plan.ts](src/lib/download-plan.ts), [src/components/release-picker.tsx](src/components/release-picker.tsx), [src/context/download.tsx](src/context/download.tsx) (a `useDownload` hook helyére lépő provider, a kártya és a hero is ezt hívja).

#### Adatlap-átépítés (2026-08-08-i kérés) ✅

Kérés: az adatlap mutasson meg mindent, ami TMDB-ről megkapható és érdemes, Overseerr/Jellyseerr-mintára.

- **Egy TMDB-kérés** hozza az egészet (`append_to_response`: credits / aggregate_credits, videos, external_ids, recommendations, similar, release_dates vagy content_ratings), a meglévő cache-be.
- Blokkok: hero (backdrop, poszter, cím+év, tagline, korhatár, ★ értékelés szavazatszámmal, játékidő, műfajok, leírás) → Download / Trailer / Stop watching → évadválasztó (sorozat) → szereplők → `Details` rács (státusz, következő epizód, rendező/alkotó/író, dátumok, évad- és epizódszám, eredeti cím és nyelv, hangsávok, csatorna, stúdió, ország, büdzsé, bevétel, TMDB/IMDb/honlap link) → ajánlások és hasonlók.
- Sorozatnál a stáb **csak az alkotókat** listázza: az `aggregate_credits` minden epizódrendezőt felsorol, ami semmit nem mond arról, ki csinálta a sorozatot.
- Stúdió- és csatornanevek szövegként, nem logóként: a TMDB logói átlátszó hátterű sötét PNG-k, sötét témában eltűnnének.
- A korhatár országfüggő: `TMDB_REGION`, alapból a `TMDB_LANGUAGE` régiója (`en-US` → `US`). `HU`-ra állítva magyar besorolás jön (`R` helyett `18`).
- A „Where to watch" (JustWatch-szolgáltatók) rövid ideig szintén szerepelt rajta, de **kérésre kikerült**, a lekérdezéssel és a típusokkal együtt.

#### Bejelentett hibák és javításuk (2026-08-07 → 08)

| Bejelentés | Ok | Javítás |
|---|---|---|
| „A The Odyssey `Searching…`-en ragad" | Nem hiba: 33 találat, mind kamerás felvétel vagy más tartalom. | A státusz felirata **`Waiting for release`** lett — a `SEARCHING` nem folyamatban lévő keresés, hanem a „megnéztem, még nincs" állapot. |
| „Nem tudom törölni a watchlistről" | A `pruneWatchlistItem` minden `PENDING`-nél előrébb tartó unitot megőrzendőnek vett, és a `SEARCHING` ilyen — vagyis amint a scanner egyszer rákeresett, a sor kitörölhetetlenné vált. | Sort csak **valódi letöltés** tart életben (`DOWNLOADING`/`DOWNLOADED`); a már nem figyelt unitok keresési állapota nullázódik. |
| „Törlés után csak oldalfrissítésre tűnik el" | A tábla újratöltése az `entries.length`-hez volt kötve, a letöltött elem sora viszont megmarad, csak a `monitored` billen — a darabszám nem változott. | A hatás a lista **teljes állapotára** figyel; a betöltések sorszámot kapnak (a régebbi válasz nem írja felül az újat), és a művelet a szerver visszaigazolása után tölt újra. |
| „Vízszintes görgetés az oldalon" | A kártya posztere `w-auto` volt `width={250}`-nel, tehát fix 250 px — egy hatoszlopos rács ebből szélesebb, mint az ablak. | `w-full`; a `SidebarInset` kapott `min-w-0`-t és `overflow-x-clip`-et, a `ScrollArea` gyökere `overflow-hidden`-t. |
| „A progress `not yet`, miközben megy a letöltés" | A film ága csak `DOWNLOADED`-et és „még nem"-et ismert. | Futó letöltésnél a százalék, alatta sáv és sebesség. |
| „100%-on áll, de sokáig `Downloading`" | A `syncDownloads` csak a 15 perces scan-körben futott. | Saját, rövid intervallum (`DOWNLOAD_SYNC_INTERVAL_MINUTES=1`), **és minden `?live=1` watchlist-lekérés** lefuttatja ugyanabból a torrent-listából, amiből a sorok készülnek — így a néző 5 mp-en belül látja az átbillenést. |

Kérésre a `Downloaded` oldalból **`Library`** lett (`/library`), és ott a haladás-oszlop helyére a státusz került: minden sor kész, a haladása semmit nem mond. Mobilon a kártyák ~30%-kal kisebbek (sorokban 250 → 175 px, rácsban 2 → 3 oszlop).

#### Meg nem jelent rész letöltése, és egy `.scr` a torrentben (2026-08-08-i bejelentés) ✅

Bejelentés: „Silo 3. évad 7–10. részt watchlistre raktam, elvileg egyik sem jelent még meg, viszont a 7. részt letöltötte, és rossz is, valami `.scr` fájlt töltött le."

**Amit a napló és a kliens mutatott:**

```
[scheduler] manual scan: every monitored item, backoff and release dates ignored
[scheduler] show 125988 S3 E7: grabbing Silo S03E07 MULTI 1080p WEB H264 HiggsBoson
```

A torrent egyetlen fájlja: `Silo S03E07 MULTI 1080p WEB H264-HiggsBoson.scr`, **1,2 GB** — Windows screensaver-futtatható, hihető epizód-méretre felfújva. Az S3E7 `airDate`-je **2026-08-13**, tehát a rész 5 nap múlva jelenik meg.

**Miért ment át minden meglévő védelmen:** a release *neve* hibátlan volt — a cím egyezik, az `S03E07` egyezik, `1080p`, létező group. A cím-ellenőrzés, az év-ellenőrzés, a felbontás-küszöb és a méret-küszöb mind jogosan engedte át. A `scr` **benne van** a kizáró kulcsszavakban (`DEFAULT_EXCLUDES`), de a `.scr` nem a release nevében volt, hanem a torrenten *belüli* fájlban — a névre nézve semmi nem látszott. Egyetlen jel volt: a rész még nem jelent meg.

**A gyökérok:** a `Scan now` gomb `{ force: true }`-ja a 2026-08-07-i döntés szerint a megjelenési dátum szerinti visszatartást is kikapcsolta. Az időzített kör soha nem tette volna meg — a `scanEpisodes` szűrője `airDate <= most`. Vagyis nem a scanner hibázott, hanem az a szabály, ami a kézi gombnak megengedte, hogy átnyúljon a dátumon.

**Javítás, két rétegben:**

| réteg | mi lett |
|---|---|
| **Dátum, kivétel nélkül** | A `force` mostantól **csak a backoffot** kapcsolja ki. Az `airDate` szűrő a `scanMovies`-ban és a `scanEpisodes`-ben mindig érvényes, és a `planSeasonGrab` `force` opciója (ami az `aired` ellenőrzést kerülte meg) **megszűnt** — nem hívó dönti el, hanem nincs rá lehetőség. Egy még meg nem jelent tartalomra illeszkedő release definíció szerint hamis, és a neve tetszőlegesen jó lehet: ez az egyetlen ellenőrzés, ami elkapja. |
| **A hasznos tartalom ellenőrzése** ([payload.ts](src/lib/payload.ts)) | Az indexer csak nevet ad, a torrent tartalma viszont lebuktatja a hamisítványt. A `syncDownloads` **még letöltés közben**, a „kész" megállapítása *előtt* megnézi a fájllistát (`getTorrentFiles`). Rossznak számít, ha **a legnagyobb fájl futtatható**, vagy ha **egyetlen videófájl sincs benne**. Ilyenkor a torrent a fájljaival törlődik (`PAYLOAD_DELETE_FILES=1`), a release neve a stall-feketelistára kerül, a unitok `PENDING`-re állnak azonnali esedékességgel. Dry-runban csak logol. A három kiterjesztés-lista **kizárólag env-ből** jön (`PAYLOAD_VIDEO_EXTENSIONS`, `PAYLOAD_ARCHIVE_EXTENSIONS`, `PAYLOAD_EXECUTABLE_EXTENSIONS`) — lásd alább. |

**A listák csak env-ből jönnek** (2026-08-08-i kérés, nincs kódba írt tartalék). Ennek két következménye van, és mindkettő szándékos:
- **Beállítatlan lista = az a szabály ki van kapcsolva.** Az üres listát *nem* értelmezi „semmi nem videó"-ként, mert az minden torrentet törölne — egy hiányzó konfiguráció nem bizonyíték arra, hogy a letöltés rossz. A `startScheduler` ezért kiírja, ha a védelem nem él: `payload check is OFF: set PAYLOAD_EXECUTABLE_EXTENSIONS / PAYLOAD_VIDEO_EXTENSIONS to turn it on` — egy néma, nem működő biztosíték rosszabb, mint a semmi.
- **`*` = minden elfogadott**, vagyis az a lista semmit nem utasít el. Így egy szabály kikapcsolható anélkül, hogy a listát ki kellene ürítened (és később visszaírnod). A `PAYLOAD_EXECUTABLE_EXTENSIONS=*` tehát *nem* azt jelenti, hogy minden futtathatónak számít — hanem hogy ez a szabály nem szól bele.
- Mivel nincs default, a három sor bekerült a **`.env`-edbe** is (eddig ott csak az alapértéktől eltérő beállítások voltak) — enélkül az ellenőrzés nem futott volna.
- A `.r00`–`.r99` nem külön lista: a `rar` bejegyzést követi az archív listában, tehát ha kiveszed a `rar`-t, a többrészes archívum sem számít annak.

**Csak biztos esetben avatkozik be** — a vakriasztás itt drágább lenne, mint egy átcsúszó hamisítvány:
- **Archívumos scene-release** (`.rar` + `.r00`…) nem tartalmaz videókiterjesztést, de nem is megítélhető → átmegy.
- **Magnet, aminek még nincs metaadata** → üres fájllista → nem ítél, azt a stall-óra kezeli.
- A qBittorrent **`.!qB` végű, félkész fájljait** és a `.pad/` kitöltő bejegyzéseit levágja/kihagyja.
- A „kis igazi sample + nagy kártevő" trükk miatt a **legnagyobb** fájl dönt, nem az, hogy van-e valahol egy videó.

**Mérés a valódi adatokon** (a kliensben lévő három torrent + szintetikus esetek):

```
=== real torrents in the client
  BAD Silo S03E07 MULTI 1080p WEB H264-HiggsBoson | its largest file is a .scr
  ok  Obsession.2025.1080p.BluRay.DDP7.1.Atmos.x264.HUN-FULCRUM
  ok  Mortal.Kombat.II.2026.1080p.MA.WEBRip.DDP5.1.Atmos.x264.HUN-FULCRUM

  BAD the actual fake        its largest file is a .scr
  BAD sample + malware       its largest file is a .exe
  BAD nfo and subs only      there is no video file in it
  BAD apk padded             its largest file is a .apk
  ok  plain episode / season pack / rar scene release / still downloading (.!qB)
  ok  metadata not in yet / padding plus video / iso release
```

A dátumszűrő ugyanezen az adaton: egy **erőltetett** scan most `0` epizódot vesz elő, a dátumot figyelmen kívül hagyva `3`-at vett volna (S3E8 `2026-08-20`, S3E9 `2026-08-27`, S3E10 `2026-09-03`).

**Takarítás:** a kártevő torrent a fájljával együtt törölve a qBittorrentből, az S3E7 unit vissza `PENDING`-re (`hash=null`, `searchAttempts=1`). Mind a négy rész figyelt marad, és egyiket sem keresi a scanner a saját megjelenési dátuma előtt.

**Nyitva marad:** a feketelista memóriában él (a PLAN korábbi döntése szerint, tábla helyett), tehát egy szerver-újraindítás után ugyanaz a hamis release újra kipróbálható. A dátum-védelem miatt viszont ez csak a megjelenés után fordulhat elő, és akkor a tartalom-ellenőrzés letöltés közben megint kiveszi, plusz egy próbálkozást számol — vagyis a kör önmagát javítja, csak nem első próbálkozásra. A **már `DOWNLOADED`** unitok tartalmát a sync szándékosan nem nézi újra (különben minden könyvtárbeli torrent fájllistája lekérésre kerülne minden körben, és egy rossznak ítélt film unitja a „letöltéskor levett” `monitored` miatt némán kiesne a keresésből).

#### „Nem írja, hogy megjelenésre várnak" (2026-08-08-i bejelentés) ✅

Bejelentés: a Silo 47 perce felkerült a watchlistre, de „még egyszer sem lett ellenőrizve" — és a felület ezt nem magyarázta meg.

**A viselkedés helyes volt:** mind a négy rész (S3E7–E10) `2026-08-13` és `2026-09-03` között jelenik meg, tehát a `scanEpisodes` mindet visszatartja. A `lastCheckedAt = never` ennek a *következménye*: a scanner meg sem nézi a meg nem jelent részt, így nincs mit feljegyeznie. Élesben ellenőrizve: egy erőltetett kör lefutott (`manual scan: every monitored item that is out, backoff ignored`) és 0 elemet vett elő, a unitokhoz nem írt semmit.

**A hiba a megjelenítésben volt.** Az elem `PENDING`-nek számított, tehát `Watchlisted` badge-et kapott, mellette `Last checked: never` és `Attempts: —` — ez pontosan úgy néz ki, mint egy nem működő scanner. A `Waiting for release` felirat pedig már foglalt volt a `SEARCHING`-re, ami **mást jelent**: azt, hogy kerestünk és nem találtunk semmi használhatót.

Ezért bekerült egy **új, származtatott állapot**: `UPCOMING` („nincs még mit keresni"). Nem DB-érték és nem is kell hozzá migráció — a `WatchStatus` (tárolt, unit-szintű) marad az öt eredeti, és mellé jött a `WatchlistStatus = WatchStatus | "UPCOMING"` az **elem**-szintű, mindig számolt státuszra. Az epizód-sorok továbbra is a szűkebb típust hordozzák, tehát a `season-picker` nem kap egy sosem előforduló kulcsot.

**Mikor `UPCOMING`:** ha egy elemnek nincs se letöltés alatti, se keresett unitja, és **minden még megszerzendő (`PENDING`) unitja jövőbeli `airDate`-tel bír**. Ismeretlen dátum nem számít jövőbelinek — az kereshető, tehát `PENDING` marad. A DTO-ba bekerült a `nextAirDate` is (a legkorábbi dátum, amire még várunk), különben az állapot nem lenne megmagyarázható.

Amit ez a szabály mellékesen megjavít: **egy sorozat, amivel utol vagy érve**, eddig `Watchlisted`-nek látszott (a letöltött részek mögötte, a következő még nincs kész) — most `Not out yet`, a következő rész dátumával.

| ág | eredmény |
|---|---|
| minden rész még csak jövőben jelenik meg (a Silo esete) | `UPCOMING`, next=2026-08-13 |
| utol vagy érve, a következő még nem jelent meg | `UPCOMING`, next=2026-08-13 |
| egy rész megjelent és még nem kerestünk rá | `PENDING` (esedékes, nem „upcoming") |
| egy részre kerestünk és nem találtunk | `SEARCHING` nyer |
| még be nem mutatott film | `UPCOMING` |
| bemutatott film, keresésre vár | `PENDING`, next=– |
| film ismeretlen dátummal | `PENDING`, next=– |
| bármi letöltés alatt | `DOWNLOADING` nyer |

Felületen: `Not out yet` badge (a kártyákon is), a `/watchlist` haladás-oszlopában alatta halványan `out 13 Aug, in 5 days`, és egy új `Not out yet` szűrő-chip. A főoldal `On your watchlist` sora is számolja az `UPCOMING`-ot, különben egy ilyen elem eltűnt volna onnan.

#### „Ami letöltött, az lekerül a watchlistről" (2026-08-08-i kérés) ✅

Eddig egy elkészült letöltés a watchliston maradt, amíg valaki kézzel rá nem nyomott a `Stop watching`-ra — pont az a lépés, amire a felhasználónak semmi oka nincs. Mostantól **a sikeres letöltés maga viszi le a listáról**, két, egymást kiegészítő szabállyal:

| hol | mi történik |
|---|---|
| `syncDownloads`, `isComplete` ág ([scheduler.ts](src/lib/scheduler.ts)) | **filmnél** a `monitored` is `false`-ra vált a `DOWNLOADED`-del együtt. Egy filmnél nincs mit tovább figyelni, tehát a flag onnantól hazugság lenne. |
| a watchlist-tábla szűrője ([watchlist-table.tsx](src/components/watchlist-table.tsx)) | a `/watchlist` **állapot alapján** szűr (`status !== "DOWNLOADED"`), nem a `monitored` alapján. Így egy teljesen letöltött **sorozat** is lekerül, pedig a figyelése megmarad. |

Miért nem elég az egyik:
- Csak a `monitored` törlése **sorozatnál nem járható**: az epizód-unit `monitored` flagje az egyetlen nyoma annak, hogy az évadot kértük, és az `inheritedMonitored` ebből dönt egy később bejelentett epizódról/évadról. Ha a letöltött epizódokról letörölnénk, egy végig letöltött, futó sorozat **csendben abbahagyná az új évad követését** — épp az a működés esne ki, amiért az app létezik. (Az „ami letöltött, azt kértük" heurisztika sem jó pótlék: a *kézi* letöltés is `DOWNLOADED`-et hagy, és azt a PLAN korábbi döntése szerint kifejezetten nem szabad monitorozásnak érteni.)
- Csak a szűrő átírása **filmnél félmunka**: a `monitored` maradna `true`, tehát a kártyán ott lenne a könyvjelző, az adatlapon a `Stop watching`, és a `MediaCard` menüje „Stop watching"-ot ajánlana valamire, ami már megvan.

Következmények, amiket végigvettem:
- **A scanner nem tölti le újra**: `scanMovies` / `scanEpisodes` `monitored: true` **és** `PENDING`/`SEARCHING` státuszt kér — egy `DOWNLOADED` unit már a státusza miatt is kiesik.
- **A sor nem törlődik**: a `pruneWatchlistItem` minden `DOWNLOADING`/`DOWNLOADED` unitot megőrzendőnek vesz, tehát a film a `Library`-ban marad.
- **A `deriveStatus` nem változik**: a `trackedUnits` a nem-`PENDING` unitokat is számolja, tehát egy monitorozás nélküli, letöltött unit továbbra is `DOWNLOADED`-et ad.
- **A főoldal személyes sorai** (`Ready to watch`, `On your watchlist`) eddig is státusz alapján válogattak, nem `monitored` alapján — ott nem kellett hozzányúlni.
- **A kliensből eltűnt kész torrent** útja változatlan: `forgetUnits` + `pruneWatchlistItem`, a sor kiürülve törlődik, újra letöltés nincs.
- A `/watchlist` **`Downloaded` szűrő-chipje törölve** — az új szabály mellett sosem adhat találatot.

**Ellenőrzés** eldobható sorokon (fake tmdb id 9000000x, utána törölve; a valódi adatokhoz nem nyúlt):

```
MOVIE
  downloading   : status=DOWNLOADING monitored=true  | /watchlist=true  /library=false
  downloaded    : status=DOWNLOADED  monitored=false | /watchlist=false /library=true
  prune keeps the row: true
SHOW (1 of 2 aired episodes)
  E1 downloaded : status=PENDING    monitored=true  | /watchlist=true  /library=false
  both done     : status=DOWNLOADED monitored=true  | /watchlist=false /library=true
  episode monitored flags kept: [{"episodeNumber":1,"monitored":true},{"episodeNumber":2,"monitored":true}]
```

Plusz a „kész torrent eltűnt a kliensből" ág egy már monitorozás nélküli filmen: a sor **törlődik**, unit nem marad.

#### Kattintás → adatlap: a várakozás okai (2026-08-08-i bejelentés) ✅

Bejelentés: „a kártyákra kattintva hosszú várakozás van, mire elkezd betölteni az adatlap". **Mérve a futó dev szerveren**, és a szerver nem volt lassú: az adatlap RSC-válasza melegen **50 ms**, a `/api/details` 175 ms (hidegen 560), 24 poszter a `/_next/image`-en 6 párhuzamos szálon 1,1 s. Ami lassú volt, az a kattintás és az **első pixel** közti szakasz:

- **Nem volt `loading.tsx`** az adatlap route-ján. Loading boundary nélkül az App Router navigációja *blokkoló*: a kattintás után semmi nem történik, amíg a szerver le nem rendereli az oldalt — dev-ben ehhez jött a route első fordítása (**+780–1200 ms**). Ugyanezért volt használhatatlan a `<Link>` prefetch is: a Link csak a legközelebbi boundary-ig melegíti a route-ot, és ha nincs boundary, nincs mit prefetchelni.
- **Az adatlap teljesen kliens oldali volt.** A sorrend így nézett ki: route-chunkok letöltése (**475 KB** csak erre a route-ra, dev) → skeleton → `/api/details` → `/api/watchlist/:id` → tartalom. Négy egymásra épülő várakozás, mielőtt bármi látszik.
- **Dupla kérések.** A `DiscoverSections` effektje az `entries.length`-től függött, így a watchlist megérkezésével **még egyszer** lekérte a teljes sections-választ (~1,3 s szerveroldali munka feleslegesen, minden főoldal-látogatásnál).

Amit ez alapján átírtam:
- [x] **`loading.tsx` az adatlapra** — a kattintás azonnal skeletont ad, és ezzel a kártyák linkjei prefetchelhetővé válnak (prodban; dev-ben a Next nem prefetchel).
- [x] **Az adatlap szerver komponens lett**: a [page.tsx](src/app/details/[type]/[id]/page.tsx) `getMediaDetails` + `getTvSeasons`-t hív (ugyanazt a TTL-es cache-t, amit a régi API route), és a kész adatot adja át a [details-view.tsx](src/components/details-view.tsx)-nek. A tartalom így **az első válaszban benne van** — ellenőrizve: a `/details/movie/550` HTML-jében ott a cím, a `/details/tv/108978`-ban az évadok és az epizódszámok. A `/api/watchlist/:id` (epizódonkénti pipák) maradt kliens oldalon, de már nem tart vissza semmit.
- [x] **`GET /api/details` törölve** — az adatlap volt az egyetlen hívója.
- [x] **A dupla sections-kérés megszűnt**: a `WatchlistContext` kapott egy `revision` számlálót, amit csak a valódi műveletek (`add` / `remove` / `destroy`) növelnek, és a `DiscoverSections` erre figyel a lista tartalma helyett.
- [x] **Provider-értékek memoizálva** (`useMemo`) mindkét contextben. Eddig minden renderben új objektum került a `value`-ba, tehát a provider bármelyik állapotváltozása újrarenderelte az **összes** fogyasztót — egy főoldalon 122 `MediaCard`-ot. A `DownloadProvider` ilyen szempontból a legrosszabb volt: a kiadásválasztó ablak saját `isLoading`/`preview`/`picks` állapota a mögötte lévő egész oldalt újrarenderelte, miközben az indexer-keresés futott. A `getEntry` egyúttal lineáris keresésből `Map`-lookup lett.
- [x] `images.domains` → `images.remotePatterns` (a Next minden kérésnél kiírta a deprecation figyelmeztetést).

**Ára / ami nyitva marad:** a `loading.tsx` streaming boundary-t csinál, tehát a válasz feje (200) már elment, mire a TMDB-lekérés kiderítené, hogy nincs ilyen id — az ismeretlen `/details/movie/999999999` és `/details/person/550` **helyesen a 404-es oldalt rajzolja ki, de HTTP 200-as státusszal**. Böngészőből ez nem látszik, a felhasználó a 404-es lapot kapja (eddig egy örök skeletont kapott, tehát ez így is javulás); ha a státuszkód is fontos lesz, a boundary és a 404 közül kell választani.

---

## 5. Javasolt sorrend

A Fázis 1 → 2 → 3 a lényegi új funkció (watchlist → automatikus letöltés), ez adja a legtöbb értéket, ezért ezekkel érdemes kezdeni. A Fázis 4 (keresés) és 5 (discover bővítés) UX-javítás a meglévő böngészésen, ezek függetlenek és bármikor közbeilleszthetők. A Fázis 6 (torrent-kiválasztás) érdemben a Fázis 2 scannerére épül, azzal együtt vagy közvetlenül utána logikus. A Fázis 7-8 folyamatosan/végén.

**Állapot (2026-08-08):** Fázis 1–6 kész, a Fázis 7 üzemeltetési tételei is (lint tiszta, `.gitattributes`, `entrypoint.sh`, letöltési mappák, duplikált `prisma.config.ts`, stall-kezelés). Ami maradt: **seedelés/utómunka**, és a teljes Fázis 8 (settings UI, értesítések, auth, médiaszerver).

### Amit legközelebb kézzel meg kell tenni
1. **A Next dev szervert el kell indítani a konténerben** — a scheduler csak azzal együtt indul (`instrumentation.ts`). Ez a sor jelzi, hogy jó: `[scheduler] started, scanning every 15 minutes, reading the client back every 1`. Amíg ez nem fut, semmilyen háttérkör nincs.
2. **`SCAN_DRY_RUN=0`** a `.env`-ben, amikor a **scanner** is indíthat letöltéseket. A kézi letöltés (a kiadásválasztó ablakon keresztül) ettől függetlenül mindig valódi — 2026-08-08-án az *Obsession* így jött le, végig helyesen. Kézi kör: `POST /api/scan`, teljes kikapcsolás: `SCAN_DISABLED=1`.
3. **A watchlist 2026-08-08-án üres** (0 `Watchlist` és 0 `WatchlistUnit` sor) — vagyis a dry-run kikapcsolása önmagában semmit nem indítana el, csak azt, amit ezután felveszel.

---

## 6. Fejlesztői műveletek (jegyzet)

Az adatbázis csak a docker hálózaton belülről érhető el (`DATABASE_HOST=aioseerr_db`), ezért minden Prisma művelet a konténerben fut:

```bash
docker exec -w /home/bun/app aioseerr_app bunx prisma migrate status
docker exec -w /home/bun/app aioseerr_app bunx tsc --noEmit
```

A `prisma migrate dev` **nem használható nem-interaktív shellből** ("Prisma Migrate has detected that the environment is non-interactive"). Migráció készítése helyette:

```bash
# 1. SQL legenerálása az élő DB → új schema diffből
docker exec -w /home/bun/app aioseerr_app bunx prisma migrate diff \
  --from-config-datasource --to-schema prisma/schema.prisma --script

# 2. a kimenet mentése ide: prisma/migrations/<YYYYMMDDHHMMSS>_<nev>/migration.sql
# 3. alkalmazás + kliens újragenerálás
docker exec -w /home/bun/app aioseerr_app bunx prisma migrate deploy
docker exec -w /home/bun/app aioseerr_app bunx prisma generate
```

**`prisma generate` után a dev szervert újra kell indítani** — a turbopack nem figyeli a `prisma/generated` mappát, így a futó szerver a régi klienst tartja memóriában, és a routeok 500-al elhalnak (a régi kliens még a törölt kolumnákat kérdezi le).

Env-változók, amiket a kód használ a `.env`-ből: `TMDB_API_KEY`, `TMDB_LANGUAGE` (opcionális, default `en-US`), `TMDB_CACHE_TTL_MINUTES` (opcionális, default 720), `DISCOVER_CACHE_TTL_MINUTES` (opcionális, default 60), `DATABASE_URL`, `INDEXER_URL`, `INDEXER_API_KEY`, `INDEXER_IDS` (default `all`, most `ncore,limetorrents,thepiratebay` — a sorrend a prioritás), `INDEXER_PRIORITY`, `INDEXER_PRIORITY_BONUS`, `INDEXER_CAPS_TTL_MINUTES` (opcionális, default 360), `EPISODE_SEARCH_CONCURRENCY` (default 3), `QUALITY_RESOLUTIONS`, `QUALITY_PREFERRED_CODECS`, `QUALITY_CODEC_BONUS`, `QUALITY_EXCLUDE`, `QUALITY_MIN_SEEDERS`, `QUALITY_MAX_SIZE_GB`, `QUALITY_MIN_SIZE_MOVIE`, `QUALITY_MIN_SIZE_EPISODE`, `QUALITY_PREFERRED_LANGUAGES` (default `hun,eng`), `QUALITY_EXCLUDE_LANGUAGES`, `QUALITY_DEFAULT_LANGUAGE` (default `eng`), `QUALITY_LANGUAGE_BONUS` (default 1000000), `QUALITY_LANGUAGE_FIRST` (`1` = nyelv a felbontás előtt), `QUALITY_MAX_PACK_SIZE_PER_EPISODE_GB` (default 5), `TORRENT_URL`, `TORRENT_USER`, `TORRENT_PASS`, `TORRENT_CATEGORY` (default `aioseerr`), `TORRENT_MOVIE_PATH`, `TORRENT_SERIES_PATH` (opcionális save path-ok, üresen a kategória dönt), `TMDB_REGION` (opcionális, a korhatár országa), `WATCHLIST_SCAN_INTERVAL_MINUTES`, `DOWNLOAD_SYNC_INTERVAL_MINUTES` (default 1), `SEARCH_BACKOFF_MINUTES`, `SEARCH_MAX_BACKOFF_HOURS` (default 24), `DOWNLOAD_OPTION_COUNT` (default 5), `DOWNLOAD_PLAN_TTL_MINUTES` (default 15), `SCAN_DRY_RUN`, `SCAN_DISABLED`, `STALL_MINUTES` (default 60), `STALL_DELETE_FILES` (default `1`), `PAYLOAD_DELETE_FILES` (default `1` — a hamis tartalmú torrent fájljai is törlődnek), `PAYLOAD_VIDEO_EXTENSIONS`, `PAYLOAD_ARCHIVE_EXTENSIONS`, `PAYLOAD_EXECUTABLE_EXTENSIONS` (a tartalom-ellenőrzés három listája, vesszős; vezető pont és kisbetű/nagybetű mindegy).

A `MAX_SEARCH_ATTEMPTS` és a `PACK_AFTER_ATTEMPTS` **már nincs a kódban** (2026-08-07 óta), ha a `.env`-ben bent maradtak, figyelmen kívül maradnak.

**Nyelv:** a kód, a kommentek és a felület angol. A TMDB metaadat is angolul jön (`TMDB_LANGUAGE`, default `en-US`) — `hu-HU`-ra állítva visszakapható a magyar cím/leírás anélkül, hogy a felület nyelve változna. Ez a terv-dokumentum marad magyar.

---

## 7. Kód-térkép

| Fájl | Mit tartalmaz |
|---|---|
| [src/lib/media.ts](src/lib/media.ts) | TMDB: metaadat, évadok/epizódok, imdb id (TTL-es cache-en keresztül), multi-search és a közös `toMedia` mappelés |
| [src/lib/indexer.ts](src/lib/indexer.ts) | torznab: indexerenkénti caps + képesség-alapú film/epizód/évad keresés, seeder-parse, dedup |
| [src/lib/release.ts](src/lib/release.ts) | minőségi profil, pontozás, hamis-release szűrés, évad/epizód számozás-parser |
| [src/lib/torrent.ts](src/lib/torrent.ts) | qBittorrent kliens: hozzáadás kategóriával/taggel, hash visszaolvasás, állapot, törlés |
| [src/lib/grab.ts](src/lib/grab.ts) | keresés → pontozás → qBittorrent → DB lánc (`planMovieGrab`, `planSeasonGrab`, `planGrabs`, `execute*`) |
| [src/lib/watchlist.ts](src/lib/watchlist.ts) | watchlist CRUD, származtatott státusz, évad-monitorozás, unit-állapotok |
| [src/lib/scheduler.ts](src/lib/scheduler.ts) | periodikus job: sync, film-scanner, epizód-scanner, TMDB frissítő |
| [src/lib/stall.ts](src/lib/stall.ts) | az elakadás órája és az elakadt release-ek feketelistája |
| [src/lib/payload.ts](src/lib/payload.ts) | mi van *valóban* a torrentben: futtatható a legnagyobb fájl, vagy nincs benne videó |
| [src/instrumentation.ts](src/instrumentation.ts) | a scheduler indítása szerverindulásnál |
| [src/context/watchlist.tsx](src/context/watchlist.tsx) | kliens oldali watchlist állapot (slim lista + add/remove/destroy) |
| [src/context/download.tsx](src/context/download.tsx) | a kiadásválasztó ablak állapota, minden letöltés ezen megy keresztül |
| [src/lib/download-plan.ts](src/lib/download-plan.ts) | a keresés eredménye szerveroldalon tárolva, a választott kiadások alkalmazása |
| [src/components/searchbar.tsx](src/components/searchbar.tsx) | debounce-olt keresősáv, `/search?q=…` navigációval |
| [src/app/search/page.tsx](src/app/search/page.tsx) | keresési találatok `MediaCard` griddel + lapozás |
| [src/lib/sections.ts](src/lib/sections.ts) | a discover nézetek sorainak összeállítása + sorok közötti dedup + hero választás |
| [src/components/media-row.tsx](src/components/media-row.tsx) | egy vízszintesen görgethető sor (`See more` linkkel) |
| [src/components/media-grid.tsx](src/components/media-grid.tsx) | lapozó rács végtelen scrollal (genre-szűrt discover) |
| [src/components/media-hero.tsx](src/components/media-hero.tsx) | billboard a lap tetején: backdrop + Download / Watchlist / Details |
| [src/components/discover-sections.tsx](src/components/discover-sections.tsx) | hero + sorok kirajzolása, mindhárom discover nézethez |
| [src/app/details/[type]/[id]/page.tsx](src/app/details/[type]/[id]/page.tsx) | az adatlap **szerver** komponense: TMDB-adat lekérése (cache-en át), `notFound()` ismeretlen típusra/id-ra |
| [src/components/details-view.tsx](src/components/details-view.tsx) | az adatlap kliens fele: pipák, letöltés, trailer, watchlist-állapot |

### API végpontok

| Végpont | Leírás |
|---|---|
| `GET /api/discover?type&category&genre&page` | TMDB discover: trending / popular / top_rated / upcoming / now_playing / airing_today / on_the_air, vagy genre-szűrt lista |
| `GET /api/discover/sections?view` | a főoldal / `/movies` / `/series` kész sorai, sorok között dedupálva, hero-val |
| `GET /api/genres?type` | TMDB genre lista (`movie` / `tv`) |
| `GET /api/search?q&page` | TMDB multi-search, `person` nélkül, lapozható |
| `GET /api/watchlist` | dúsított lista (TMDB metaadattal) |
| `GET /api/watchlist?slim=1` | csak azonosítók + állapot, TMDB-hívás nélkül |
| `POST /api/watchlist` | `{ tmdbId, type, seasons? }` — `seasons` esetén csak azokat monitorozza |
| `GET`/`DELETE /api/watchlist/:id` | egy elem lekérése (epizódonkénti állapottal) / eltávolítása (cascade) |
| `PATCH /api/watchlist` | `{ tmdbId, type, monitored, seasonNumber?, episodes? }` — évad vagy egyes epizódok be/ki; felveszi a sort, ha kell, és törli, ha kiürül (`result: null`) |
| `POST /api/download/preview` | `{ type, id, seasons? }` — keres, de nem tölt: soronként a választható kiadások + `planId` |
| `POST /api/download` | `{ planId, picks }` a kiadásválasztó ablakból, vagy `{ type, id, seasons? }` a profil saját döntésével → `{ started, missing / missingMovie }` |
| `POST /api/scan` | egy scanner-kör kézi indítása; `{ force: true }` esetén a backoffot és a megjelenési dátumokat is figyelmen kívül hagyja |
