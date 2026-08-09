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
| Indexer-kezelés | **Indexerenként külön hívás, képesség-alapon** — nem a Jackett aggregate endpointján keresztül. Indexerenként `t=caps` (cache-elve), és amit az adott indexer tud, azzal keresünk (`imdbid`, egyébként `q` = eredeti cím + év/season+ep). Az indexer id-k listája beállítás (`INDEXER_IDS`), mert a Jackett admin API-ja session cookie-t kér, csak api kulccsal `400 Cookies required`. |

---

## 3. Adatmodell

Metaadat (cím, poszter) **nem** kerül a DB-be — az mindig TMDB-ből jön; a táblákban csak azonosító, letöltési állapot és a scanner döntéséhez kellő `airDate` van.

**2026-08-09: nyolc tábla, és a watchlist tulajdonost kapott.** A `User` és a `Session` az első kettő, aminek semmi köze a filmekhez: azt mondják meg, ki léphet be és melyik böngésző van bejelentkezve (ld. „Bejelentkezés, szerepkörök, Authentik"). Utána a `Watchlist` `userId`-t kapott és **mindenkinek sajátja lett**, a `Library` viszont közös maradt — ld. „Mindenkinek saját watchlistje".

**2026-08-09: hat tábla.** A watchlist és a library kettévált: ami letöltésre került, az a `LibraryItem` táblában él, és a `WatchlistUnit` már csak azt jelenti, amit még meg kell találni. Ld. a lenti „A watchlist keres, a library birtokol" alfejezetet.

**2026-08-08: öt tábla.** A `Watchlist` és a `WatchlistUnit` mellé bejött a `BlockedRelease`, a `Setting` és a `LogEntry`. A `Setting` kulcs-érték párokat tárol, kizárólag azokra a beállításokra, amiket a `/settings` oldalon tudatosan átírtak — aminek nincs sora, az a [settings.ts](src/lib/settings.ts) registryjében lévő defaultot használja, és az env-ben már nincs is ott. Ld. a lenti „Settings oldal" és „Csak a settings, env nélkül" alfejezeteket. A `BlockedRelease` és a `LogEntry` az a kettő, ami nem a watchlistről szól: egyiknek sincs relációja semmivel. A feketelista kulcsa a normalizált release-név (ld. „A feketelista tábla lett"), a `LogEntry` pedig maga a napló, amit a `/log` oldal mutat (ld. „Admin log oldal"). Mindhárom sémája itt van, a `WatchlistUnit` után.

**2026-08-07: két tábla, semmi más.** Korábban a film letöltési állapota a `Watchlist` soron ült, a sorozaté a `WatchlistEpisode` sorokon — ugyanaz a négy oszlop (`status`, `torrentHash`, `searchAttempts`, `lastCheckedAt`) két helyen, két külön kódúttal. Most **minden kereshető és letölthető dolog egy `WatchlistUnit` sor: a film egy unit, a sorozat epizódonként egy.** A `Watchlist` puszta azonosítóvá vált, a `WatchlistSeason` pedig megszűnt: az egyetlen tartalma a `monitored` volt, az átkerült a unitokra.

Az évad így már nem tárolt entitás, hanem a unitok `seasonNumber` mezőjéből olvasható ki. Egy évad akkor „figyelt", ha a unitjai azok.

**2026-08-09: unit csak arra van, amit figyelsz vagy már megvan.** Ld. a lenti „Csak a figyelt részeknek van sora" alfejezetet. Ezzel az évad-szintű kapcsoló már nem `updateMany` a meglévő sorokon, hanem sor-létrehozás és -törlés; és mivel egy hiányzó sor nem „ismeretlen", hanem „nem kell", a *show* szintű szándék külön mezőbe került (`monitorNewSeasons`).

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

// azonosság, plusz az egy dolog, amit unit nem tud hordozni: követjük-e a
// sorozatot olyan évadba is, ami még nem létezik
model Watchlist {
  id        Int         @id @default(autoincrement())
  tmdbId    Int
  type      ContentType @default(MOVIE)
  addedAt   DateTime    @default(now())
  updatedAt DateTime    @updatedAt

  // true = „ezt a sorozatot nézem", false = „ezeket az évadokat nézem"
  monitorNewSeasons Boolean @default(false)

  units WatchlistUnit[]

  @@unique([tmdbId, type])
}

// egy kereshető/letölthető dolog: a film egy unit, a sorozat epizódonként egy.
// Sor csak arra van, ami figyelt vagy már megvan — a többi epizód a TMDB dolga.
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

enum BlockReason {
  STALLED
  BAD_PAYLOAD
}

// egy release, amit egyszer már lehúztunk és el kellett dobni. A kulcs a normalizált
// release-név, mert a qBittorrent a release nevén nevezi el a torrentet.
model BlockedRelease {
  id        Int         @id @default(autoincrement())
  title     String      @unique
  reason    BlockReason
  detail    String?
  blockedAt DateTime    @default(now())
  expiresAt DateTime?   // null = soha nem jár le

  @@index([expiresAt])
}

enum LogLevel {
  DEBUG
  INFO
  WARN
  ERROR
}

// az app saját naplója, amit a /log oldal mutat. `source` = a modul, ami írta
// (scheduler, download, settings, …); a `detail` a részlet: release-név, hiba,
// régi és új érték. Titok sosem — a writeLog kiszűri.
model LogEntry {
  id      Int      @id @default(autoincrement())
  at      DateTime @default(now())
  level   LogLevel
  source  String
  message String
  detail  String?

  // az egyetlen kérdés, ami nem id szerint megy: a megőrzési időn túli sorok törlése
  @@index([at])
}
```

Amit az egységesítés hozott:
- A `syncDownloads()` két majdnem azonos hurka **egy** hurokká olvadt, ami hash szerint csoportosít — egy season pack ezzel magától egyszerre zárja le az összes érintett epizódot, film és epizód megkülönböztetése nélkül.
- A `deriveStatus()` már nem ágazik el típus szerint: minden elem annyira van kész, amennyire a unitjai. Filmnél egy unit van, tehát ugyanazt adja, mint eddig.
- Új oszlopot (pl. a táblázatos nézethez a kiválasztott release neve/mérete, vagy a stall-detektáláshoz idő+progress) **egy** helyre kell felvenni, nem kettőbe.
- Az évad-monitorozás egy `updateMany` a unitokon, a `scanEpisodes` szűrője pedig sima oszlop lett reláció-join helyett.
- Ára: a film unitja `seasonNumber = null, episodeNumber = null`, és mivel a NULL az egyedi indexben soha nem ütközik, az „egy film = egy unit" szabályt kód tartja (`ensureMovieUnit`), nem a DB.
- Szintén ára: az évad már nem tárolt entitás, tehát egy epizód nélküli (bejelentett, de üres) évadhoz nem tapad monitorozási beállítás.

**Öröklési szabály (`syncTvSeasons`, 2026-08-09-i alak).** Ami újonnan jelenik meg a TMDB-n:
1. **új epizód egy figyelt évadban** → figyelt lesz, de **csak ha a sorszáma nagyobb a benne tárolt legnagyobbnál**. Ami az alatt van, azt egyszer már felkínáltuk, és azért nincs sora, mert nem kellett;
2. **új évad** → csak akkor, ha `monitorNewSeasons` be van kapcsolva **és** az évad újabb minden tároltnál;
3. **minden más** → nem jön létre sor, csak a meglévők `airDate`-je frissül.

Az 1. és 2. pont korlátja ugyanaz: sor nélkül a „nem lett bejelentve" és a „nem kérted" egyformán néz ki, és a sorszám az egyetlen, ami megkülönbözteti őket. Ezért kellett a `monitorNewSeasons` mező — évad-szinten a sorszám nem elég, mert a régi évadok is ott vannak a TMDB listáján.

Mellékhaszon: a korábbi korlát — „egy olyan évadhoz, aminek még egy epizódja sincs, nem tárolható monitorozási beállítás" (a Silo S4 pont ilyen: `S4(0)`) — **megszűnt**. A szándék a sorozaton ül, nem az évad nem létező unitjain, tehát amikor a S4 megkapja az első epizódjait, azok maguktól figyeltek lesznek.

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
- [x] **`SCAN_DRY_RUN`**: a scanner csak logolja, mit töltene le — semmit nem ad a qBittorrenthez és semmit nem ír a DB-be. A Settings / Scanner tabon kapcsolható, egy új install a *kikapcsolt* defaulttal indul. `POST /api/scan` kézzel is lefuttat egy kört.
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
- [x] Konfigurálható felbontás-prioritás, kodek-preferencia, indexer-prioritás, méret-küszöbök, kizáró kulcsszavak (2026-08-08 óta a `/settings` Quality és Language tabján).
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
  - **A feketelista** a `rateRelease`-ben szűr (`already tried and dropped` — 2026-08-08 óta a hamis tartalmú torrentek is ide kerülnek, ezért lett általánosabb a szöveg), normalizált release-név alapján — a qBittorrent a release nevén nevezi el a torrentet, ezért ez összeér. **2026-08-08 óta tábla** (`BlockedRelease`, ld. a 3. pontot), nem memória: a korábbi „elfogadható ár, hogy ne kelljen tábla" döntés a `.scr`-es incidens napján megbukott.
  - **Az óra is memóriában van** (hash → `{ progress, since }`), így nincs migráció; egy újraindítás annyit jelent, hogy a számláló újraindul, ami egyórás küszöbnél nem számít.
  - **Dry-runban csak logol**: a torrent-törlés valódi, fájlokat érintő művelet, azt a dry-run szándéka szerint nem szabad megtennie.
  - Ellenőrizve: 61 perc mozdulatlanság után elakadtnak jelöl, közben 0.30 → 0.31 haladásra újraindítja az órát; a **`stalledUP`** (kész torrent, akinek nincs kihez seedelnie — a te két torrented pontosan ilyen) két óra után sem elakadt; feketelistázás után ugyanaz a release `picked=false`, `reason="already tried and dropped"`.

### Fázis 7 — Robusztusság / üzemeltetés
- [x] A scanner retry/backoff-ja megvan (`searchAttempts`, `lastCheckedAt`), az indexer-hívások hibái nem dobnak, csak logolnak és üres listát adnak, a torznab `error` válasz (pl. `203`) fallbackot indít.
- [x] **Növekvő várakozás, plafon nélküli újrapróbálkozás** (2026-08-07-i kérés). Eddig `MAX_SEARCH_ATTEMPTS=10` és fix 30 perc volt: egy elem **5 óra alatt** elérte a 10 próbálkozást, `FAILED` lett, és a `dueFilter` (`searchAttempts < MAX`) **soha többé nem vette elő** — vagyis az app pont azokat adta fel, amiket figyelnie kellett volna (még meg nem jelent, vagy trackeren még nem fent lévő tartalom). Most a várakozás duplázódik (`SEARCH_BACKOFF_MINUTES=30` → 1h → 2h → 4h → … `SEARCH_MAX_BACKOFF_HOURS=24`), és nincs feladás.
  - A `dueFilter` a lekérdezésben csak durva előszűrő (a legrövidebb lehetséges várakozás), a soronkénti backoffot az `isDue` alkalmazza JS-ben. Így a beállítás átírása azonnal hat, nem fagy bele egy tárolt `nextCheckAt` oszlopba — és nem kell hozzá migráció sem.
  - A `MAX_SEARCH_ATTEMPTS` és a `PACK_AFTER_ATTEMPTS` ezzel **kikerült a kódból**.
  - A `WatchStatus.FAILED`-et így **semmi nem állítja be automatikusan**. Az enum benne marad (a `deriveStatus`, a badge és a `GRABBABLE_STATUS` kezeli), későbbi kézi „feladom" funkcióhoz.
  - Élőben ellenőrizve: `attempts=5` + „1 órája nézve" → a scanner kihagyta (a backoff ekkor 16h); „20 órája nézve" → feldolgozta, és `attempt 6, next in 24h` került a logba.
- [x] A háttér-job logol minden döntést (`[scheduler] …`: mit talált, mit indított, mi hibázott, hányadik próbálkozás). **2026-08-08 óta ugyanezek a sorok a `LogEntry` táblába is mennek**, és a `/log` oldalon élőben látszanak — ld. a lenti „Admin log oldal" alfejezetet.
- [x] **Log a felületen** (2026-08-08) — `/log`: szint/forrás/szöveg szűrő, SSE-s élő követés, megőrzési idő. A fontos műveletek (scanner-döntések, kézi letöltés, beállítás-változás és -törlés, watchlist-műveletek, kifelé menő hibák) mind írnak bele.
- [x] `discover` route hibakezelése: a catch-ág nem `return`-ölt, csak konstruált egy eldobott `Response`-t — most logol, és a hibás oldal egyszerűen kimarad az eredményből.
- [x] **`entrypoint.sh` dev módja** (2026-08-07) — korábban csak a Prisma Studio-t indította, a Next dev szervert kézzel kellett elindítani a konténerben. Mivel a `startScheduler()` az `instrumentation.ts`-ből, **a Next szerverrel együtt** indul, ez azt jelentette, hogy alapból semmilyen háttérkör nem futott — a 2026-08-06-i „kész letöltés nem került át" hiba részben ebből jött. Most a Studio a háttérbe kerül, a dev szerver pedig `exec bun run dev`-vel a fő processz.
  - Következmény: a konténer a dev szerver élettartamáig él. Ha a dev szerver kilép, a konténer is leáll (`docker compose up -d aioseerr_app` hozza vissza) — cserébe egy néma, nem futó szerver nem maradhat észrevétlen.
  - A `[ $APP_ENV == … ]` idézőjelbe került: beállítatlan `APP_ENV` mellett a script eddig szintaktikai hibára futott volna.
  - Az `entrypoint.sh` a Dockerfile-ba van másolva, tehát a módosítása **image-újraépítést igényel**: `docker compose up -d --build aioseerr_app`.
- [x] **Egy friss klón magától felállna** (2026-08-08) — eddig nem: a dev ág nem futtatott `bun install`-t és `prisma generate`-et, **`prisma migrate deploy`-t pedig egyik ág sem**, tehát egy klón üres adatbázissal indult volna. Ez addig maradt észrevétlen, amíg a szerver az első kérésig nem nyúlt a DB-hez; a napló bevezetése óta viszont a boot **első művelete** egy DB-írás, tehát ez minden indulást elvitt volna. Most mindkét ág ugyanazt a `prepare()`-t futtatja: `bun install` → `prisma generate` → `migrate deploy` (soha nem `migrate dev`: az kérdez és resetelhet), és ha a migrációk 30 próbálkozás után sem mennek fel, **a konténer kiáll** — egy 500-akat válaszoló szerver rosszabb, mint egy konténer, ami megmondja, miért állt le.
  - A DB-re való várakozás nem a scriptben csúszik: a compose-ban a `aioseerr_db` kapott `pg_isready` **healthcheck**et, az app pedig `depends_on: condition: service_healthy`-t. A `prepare()` újrapróbálkozása ezen túl a tartalék.
  - Mellékhaszon: a `prisma generate` minden indulásnál lefut, tehát egy séma-változás után **elég újraindítani** — nem lehet többé régi Prisma klienssel futó szervert kapni.
  - **Mérve egy valódi friss telepítéssel**: `git clone` egy scratch könyvtárba (112 fájl, se `node_modules`, se `prisma/generated`, se `.env`), külön compose-projekt saját volume-mal és üres adatbázissal. A `fresh_db` egészségesre váltott, az app utána indult, mind a 8 migráció felment, és a dev szerver **~120 másodperc alatt** kiszolgált. A `/`, a `/settings` és a `/log` 200, a `/api/discover/sections` `setup: {"tmdb":false}`-t adott (tehát a főoldal a „add meg a TMDB kulcsot" táblát rajzolja, nem örök skeletont), az 52 beállítás mind a defaultján állt, és a naplóban ott volt a négy `WARN`, ami megmondja, mi hiányzik — plusz **egy** TMDB-figyelmeztetés a hét helyett, ahogy az összecsukás ígérte. A teszt-stack utána `down -v`-vel törölve.
- [x] **Git repo** — `git init -b main`, első commit 76 fájllal (8094 sor). A `.gitignore` javítva: a generált Prisma kliens `prisma/generated` alatt van, de a `.gitignore` a `/src/generated/prisma` halott útvonalat zárta ki, így 4,9 MB generált kód került volna be. Bekerült még a `/.claude/settings.local.json` és a `/.verify-*.ts` is.
  - Commit előtt ellenőrizve: a `.env`, `node_modules`, `.next`, `prisma/generated` egyike sincs staged-elve, és a `.env` egyetlen valós értéke (TMDB / Jackett / qBittorrent / DB) sem fordul elő a commitolt 76 fájl egyikében sem.
  - **Remote nincs** és push sem történt — az a te döntésed. Előtte érdemes újra lefuttatni ugyanezt az ellenőrzést.
- [x] **`.env.example`** — a `.env` gitignore-olt, enélkül egy friss klón nem lenne indítható. 2026-08-08 óta mindössze nyolc sor: `APP_*`, `DATABASE_*`, `SCAN_DISABLED`, `COMPOSE_*` — minden más beállítás a `/settings` oldalon van.
- [x] **Duplikált `prisma.config.ts`** (2026-08-08) — a `prisma validate` kiírja, melyiket tölti be (`Loaded Prisma config from prisma.config.ts`, a repo gyökeréből, mert a CLI a munkakönyvtárból indul). A `prisma/prisma.config.ts` halott volt, törölve; a `validate` és a `migrate status` utána is hibátlan.
- [x] **CRLF sorvégek** — `.gitattributes` (`* text=auto eol=lf`), 2026-08-07.
- [x] **Lint** (2026-08-08) — 78 találatról nullára. A többsége gépies volt (`prefer-const`), egy valódi elgépelés is kijött: a `tooltip.tsx`-ben egy magányos `1` állt utasításként a provider után. A keresősáv debounce-effektje mostantól a `navigate`-re hivatkozik (`useCallback`), nem megy el mellette. A maradék 35 `any` mind a három külső formátumot olvasó fájlban volt (TMDB, torznab, qBittorrent) — ott a szabály fájl-szinten kikapcsolva, indoklással az `eslint.config.mjs`-ben; máshol továbbra is hiba.
- [x] **Letöltési mappák** (2026-08-08) — `TORRENT_MOVIE_PATH` és `TORRENT_SERIES_PATH`; ha üresek, minden marad a kategória saját könyvtárában (a régi viselkedés). A qBittorrent `add` hívás `savepath` mezőjét használja, a kategória nem változik, tehát a sync és a `listManagedTorrents` szűrése érintetlen.
- [x] **Kattintás → adatlap várakozása** (2026-08-08) — `loading.tsx` boundary, szerver oldalon renderelt adatlap, a dupla sections-kérés és a provider-újrarenderelések megszüntetése. Mérésekkel: lásd a lenti „Kattintás → adatlap" alfejezetet.
- [x] **Seedelés** (2026-08-09) — `LIBRARY_SEED_DAYS`, alapból 3 nap. A kész letöltés addig nem törölhető, csak törlésre jelölhető, és a végén magától elmegy; a torrent utána is seedel, amíg te nem törlöd. Ld. „A watchlist keres, a library birtokol".
- [ ] **Fájlok rendezése**: az átnevezés és a `Movies/Cím (év)/…` szerkezet felépítése nem történik meg. A kézenfekvő út a **hardlink** — a letöltés a helyén marad seedelni, mellé épül egy olvasható fa, nulla plusz helyfoglalással —, aminek egy feltétele van: a letöltési és a könyvtár-mappa ugyanazon a fájlrendszeren legyen.

### Fázis 8 — Későbbi, opcionális
- [x] **Settings UI** (2026-08-08) — `/settings`, 52 beállítás tíz al-tabon (a *Log* csoport az admin log oldallal jött), **kizárólag** a DB-ből, a defaultok a registryben. Lásd a lenti „Settings oldal" és „Csak a settings, env nélkül" alfejezeteket.
- [x] **Telegram-értesítések** (2026-08-08) — ld. a lenti „Telegram-értesítések" alfejezetet. Böngésző push és Discord webhook továbbra is nyitott; a [notify.ts](src/lib/notify.ts) egy csatornát ismer, egy másik hozzávétele új `notify` implementációt jelent, nem átépítést.
- [x] **Több felhasználó / auth** (2026-08-09) — bejelentkezés, admin és user szerepkör, OpenID Connect (Authentik) saját klienssel. Ld. a lenti „Bejelentkezés, szerepkörök, Authentik" alfejezetet.
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

**Ami ebből következett:** a sync csak akkor fut, ha fut a Next dev szerver — ezért lett az `entrypoint.sh` fő processze maga a dev szerver (2026-08-07), és ezért futtatja az indulás a telepítést, a klienst és a migrációkat is (2026-08-08). Lásd a két `entrypoint.sh`-tételt a Fázis 7-ben.

#### Közös `WatchlistUnit` tábla (2026-08-07-i kérés) ✅

A táblázatos nézet első fele: előbb a séma egységesítése, hogy a nézet már egységes adatra épüljön. A modell és az indoklás a **3. pontban**. Két lépésben, két migrációval:

1. `20260807180000_unified_watchlist_units` — a `WatchlistEpisode` és a `Watchlist` állapot-oszlopai egyetlen `WatchlistUnit` táblává olvadtak.
2. `20260807190000_drop_watchlist_season` — a `WatchlistSeason` is megszűnt, a `monitored` és a `seasonNumber` átkerült a unitokra. Így **két tábla maradt: `Watchlist` és `WatchlistUnit`.**

Mindkét migráció kézzel írt, nem a `prisma migrate dev` generálta: a generált változat előbb dobta volna el az oszlopokat, mint hogy az adat átkerül — az elsőnél a Mortal Kombat II `DOWNLOADED` állapotával együtt, a másodiknál az évadok `monitored` értékével együtt. Így mindkettő a régi oszlop eldobása **előtt** másol.

A harmadik tábla később, önállóan jött: `20260808100000_blocked_releases` — tisztán additív (`CREATE TYPE` + `CREATE TABLE` + két index), semmit nem dob el, ezért ott a generált diff változtatás nélkül használható volt.

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
| **A hasznos tartalom ellenőrzése** ([payload.ts](src/lib/payload.ts)) | Az indexer csak nevet ad, a torrent tartalma viszont lebuktatja a hamisítványt. A `syncDownloads` **még letöltés közben**, a „kész" megállapítása *előtt* megnézi a fájllistát (`getTorrentFiles`). Rossznak számít, ha **a legnagyobb fájl futtatható**, vagy ha **egyetlen videófájl sincs benne**. Ilyenkor a torrent a fájljaival törlődik (`PAYLOAD_DELETE_FILES=1`), a release neve a stall-feketelistára kerül, a unitok `PENDING`-re állnak azonnali esedékességgel. Dry-runban csak logol. A három kiterjesztés-lista beállítás, a Settings / Content check tabon tag-ekként szerkeszthető (`PAYLOAD_VIDEO_EXTENSIONS`, `PAYLOAD_ARCHIVE_EXTENSIONS`, `PAYLOAD_EXECUTABLE_EXTENSIONS`) — lásd alább. |

**A listák viselkedése.** Két szélső eset, mindkettő szándékos:
- **Kiürített lista = az a szabály ki van kapcsolva.** Az üres listát *nem* értelmezi „semmi nem videó"-ként, mert az minden torrentet törölne — egy hiányzó konfiguráció nem bizonyíték arra, hogy a letöltés rossz. A `startScheduler` ezért kiírja, ha a védelem nem él: `payload check is OFF: fill in the extension lists under Settings / Content check` — egy néma, nem működő biztosíték rosszabb, mint a semmi. (Az üres lista **el is tárolódik**, épp azért, hogy a kikapcsolás ne váltson vissza a defaultra; ld. „Csak a settings, env nélkül".)
- **`*` = minden elfogadott**, vagyis az a lista semmit nem utasít el. Így egy szabály kikapcsolható anélkül, hogy a listát ki kellene ürítened (és később visszaírnod). A `PAYLOAD_EXECUTABLE_EXTENSIONS=*` tehát *nem* azt jelenti, hogy minden futtathatónak számít — hanem hogy ez a szabály nem szól bele. A `*` tag a felületen kiemelt színt kap.
- A 2026-08-08 reggeli „ne legyen kódba írt default" kérés miatt eredetileg a `.env`-be került a három sor; ma a registry defaultjai adják ugyanezt a három listát, tehát egy friss install is *bekapcsolt* ellenőrzéssel indul.
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

**Megoldva 2026-08-08-án:** a feketelista **tábla lett** (`BlockedRelease`), tehát egy szerver-újraindítás után ugyanaz a hamis release már nem kap új esélyt. Ld. a lenti „A feketelista tábla lett" alfejezetet. A **már `DOWNLOADED`** unitok tartalmát a sync szándékosan nem nézi újra (különben minden könyvtárbeli torrent fájllistája lekérésre kerülne minden körben, és egy rossznak ítélt film unitja a „letöltéskor levett” `monitored` miatt némán kiesne a keresésből).

#### Settings oldal (2026-08-08-i kérés) ✅

Kérés: „env-ből átvinni néhány dolgot UI-ról szerkeszthetőnek, egy settings oldal alá, ahol admin beállítások lesznek; mindent vigyél be UI-ra, amit lehet és érdemes."

**Felmérés.** A kód **52 env-változót** olvasott, ebből **19 modul-szintű konstans** — azok import-időben olvasnak, tehát egy UI-ból mentett érték csak újraindítás után hatott volna. Mindegyik függvénnyé lett (`STALL_MS` → `stallMs()`, `CATEGORY` → `category()`, `TMDB_LANGUAGE` → `language()`, …). **50 beállítás** került a felületre kilenc csoportban: TMDB, Indexers, Torrent client, Quality, Language, Scanner, Content check, Notifications, Download dialog.

**Ami szándékosan nem került fel:** `DATABASE_*` és `APP_*` (ezek kellenek ahhoz, hogy a táblát egyáltalán elérjük — tyúk-tojás), és a **`SCAN_DISABLED`**: egy vészfék nem lehet ott, ahonnan az app kibeszélheti magát belőle.

**A rétegezés (első kiadás, aznap felülírva).** Az első változat úgy készült, hogy a `Setting` sor nyer, az env pedig az, amire visszaesik — így a default nem a kódban volt, hanem a `.env`-ben. Ezt a **„kizárólag settingsből legyen használva"** kérés váltotta le pár órával később; a végleges modell a lenti „Csak a settings, env nélkül" alfejezetben van.

**Miért szinkron az olvasás.** A `getQualityProfile()` és társai pontozó ciklusokban futnak, ott nem lehet `await` értékenként — ugyanaz a helyzet, mint a feketelistánál. A tábla `Map`-be kerül, abból olvasunk szinkronban; a `loadSettings()` induláskor és minden scan-kör elején tölt, mentés után pedig azonnal frissül.

**Titkok.** A `TMDB_API_KEY`, `INDEXER_API_KEY`, `TORRENT_PASS` és `TELEGRAM_BOT_TOKEN` szerkeszthető, de **soha nem jön vissza a böngészőbe**: az API csak azt küldi, hogy be van-e állítva, a mező pedig cserélni tud, olvasni nem. Az üres érték egy titoknál nem törlés (különben egy mentés minden titkot kinullázna), ahhoz külön `DELETE` kell. **Nyitva marad:** az app-nak nincs bejelentkezése (Fázis 8), tehát aki eléri a hálózaton, az *átírni* továbbra is át tudja ezeket — az olvashatatlanság ezt nem pótolja, csak a legrosszabbat zárja ki.

**Az intervallum is élő.** A `setInterval` befagyasztotta volna a boot-kori értéket, ezért a scan- és sync-kör önmagát újraütemező `setTimeout`-ra váltott, ami minden körben újraolvassa az intervallumot.

**Egy hiba, amit a refaktor okozott volna:** a `torrent.ts` `categoryChecked` flagje igen/nemet tárolt, tehát egy UI-ból átírt kategóriát már nem hozott volna létre a kliensben. Most a nevet tárolja.

**Mérés** (a futó appon, API-n keresztül):

```
QUALITY_RESOLUTIONS  elotte:  source=env       value=1080p,720p,2160p
mentes ("720p,1080p")     ->  source=database  value=720p,1080p
TORRENT_CATEGORY mentes   ->  source=database  value=aioseerr-test
SCAN_DRY_RUN=1 mentes     ->  POST /api/scan valasza: dryRun=true   (ujrainditas nelkul)
DELETE mindharomra        ->  source=env / unset, dryRun=false
```

Titok-körforgás: `TORRENT_PASS` mentése után `source=database`, `value=""`, `isSet=true`; **üres értékkel PUT → `changed:0`** (nem törli); explicit `DELETE` után vissza `env`-re — utána a qBittorrent-kapcsolat sértetlen (`v5.2.2`, 2 torrent). A két közben lefuttatott scan-kör **semmit nem indított**: mind a négy Silo-rész `PENDING`, torrent nélkül, a dátum-visszatartás dry-run nélkül is fogott.

#### Csak a settings, env nélkül (2026-08-08-i kérés) ✅

Kérés: „nem akarom, hogy env-ben is legyenek ezek, azt akarom hogy kizárólag settingsből legyen használva" — plusz: a vesszős értékek **tag-ként** legyenek szerkeszthetők, és a settings kapjon **al-tabokat**.

**Hol lakik ezután egy érték.** A `Setting` tábla, és semmi más. Amelyik kulcsnak nincs sora, az a **registryben lévő `default`-ot** használja ([settings.ts](src/lib/settings.ts)), ami az egyetlen példánya annak az értéknek: egyetlen hívási hely sem visz magával tartalékot, tehát pontosan egy helyen kell megnézni, mit tesz egy beállítás nélküli install. Ami install-specifikus (URL, jelszó, chat id), annak **szándékosan nincs default**ja: `not set`, amíg valaki ki nem tölti.

Ez visszafelé mozdítja a 2026-08-08 reggeli „ne legyen kódba írt default" kérést, ezért érdemes kimondani, miért: env nélkül a default vagy a kódban van, vagy nincs sehol — és ha nincs sehol, akkor egy friss install minden szabállyal kikapcsolva indul (a tartalom-ellenőrzés is), 45 üres mezővel. A kérés *célja* viszont az volt, hogy ne legyen **rejtett** tartalék egy pontozó függvény `??`-je mögött. A registry-default nem rejtett: egy sorban áll a beállítás mellett, a felületen látszik, és a badge megmondja, hogy azt kapod-e vagy a sajátodat.

**A régi értékek átvitele.** [scripts/import-env-settings.ts](scripts/import-env-settings.ts) egyszer lefutott: **9 kulcs került át** a táblába (TMDB kulcs, Jackett URL + kulcs + indexer id-k, qBittorrent URL/user/pass, Telegram token + chat id). **21 kulcs** értéke szó szerint megegyezett az új default-tal, tehát nem kapott sort — a viselkedés így bizonyítottan nem változott, a tábla mégis csak a *döntéseket* tartalmazza. A script a repóban maradt a művelet emlékeként, és újrafuttatva sem ír felül semmit.

**Üres ≠ törölt.** Ez a fontos új szabály, és egy csapdát javít: ha egy lista kiürítése a sort törölné, akkor a „kapcsold ki ezt a szabályt" gesztus visszahozná a defaultot. Ezért **listánál az üres érték eltárolódik** (`source=database`, `value=""`, vagyis a szabály kikapcsolva), a defaulthoz visszatérés pedig a `RotateCcw` gomb, azaz `DELETE`. Nem-listánál marad a régi működés: az üres érték törli a sort, mert egy üres torrent-kategória vagy egy üres intervallum nem döntés — az előbbi épp a legrosszabb (kategória nélkül a scanner a kliens *összes* torrentjét látná).

**Ami nem lehet szám.** Egy elírt `STALL_MINUTES=abc` a következő olvasásnál némán a defaultra esett volna vissza, ezért a `PUT` már **400-al elutasítja** (`"Give up after standing still (minutes) has to be a number."`), és nem ír semmit.

**Hideg cache már nem elég.** Amíg az env volt a tartalék, egy be nem olvasott tábla legfeljebb elavult volt. Most viszont a defaultokkal válaszolna, ami *rossz* válasz egy beállított kulcsra. Ezért a `loadSettings(true)` bekerült az [instrumentation.ts](src/instrumentation.ts) `register()`-ébe, **még a `SCAN_DISABLED` ág előtt** (különben scanner nélkül soha nem töltött volna), és egy TTL-es `loadSettings()` a három kimenő úton is: `media.ts` `cached()`, `indexer.ts` `request()`, `torrent.ts` `request()`, plus a `notify()`. Mind a négy egyetlen szűk pont, amin minden TMDB / indexer / qBittorrent / Telegram hívás átmegy.

**Tag-ek.** [tag-input.tsx](src/components/tag-input.tsx): a vesszős értékek badge-ként jelennek meg, `×`-szel törölhetők, Enterrel/vesszővel vehetők fel, egy vesszős szöveg beillesztése az egészet szétszedi, üres mezőn a Backspace az utolsó tag-et *visszabontja* szerkesztésre. A komponens kifelé továbbra is a vesszős stringet adja, tehát az oldal dirty-figyelése és a beállítás formátuma nem duplikálódik. Két extra:

- **A sorrend-érzékeny listák (`ordered`) húzhatók** — felbontás (legjobb elöl), nyelv (első nyer), indexer-prioritás, kodek. Enélkül egy pozíció megváltoztatása azzal járt volna, hogy a listát kiürítve újra begépeled.
- A **`*`** tag kiemelten látszik (primary színnel), mert az „fogadj el mindent" jelentése ellentétes az összes többi tag-gel.
- A `table` típusú beállítás (`2160p:8`) ugyanezt a mezőt kapja, de **validál**: fél bejegyzés (`1080p`) nem vehető fel, mert a parser némán kihagyta volna.

**Al-tabok.** A kilenc csoport kilenc tab lett egyetlen hosszú oldal helyett, a mentés viszont **globális maradt**: a fejlécben áll, és az összes tab változását küldi el egyszerre — így nem lehet tabot váltani úgy, hogy közben elveszik a szerkesztés. Amelyik tabon módosítás van, az egy pontot kap a nevéhez, és az aktív tab a hash-ben marad (`/settings#content-check`), tehát linkelhető és túléli az újratöltést.

**Mérés** (a futó appon, a végleges modellel):

```
GET /api/settings, mind az 50 sor:  9 adatbazisbol, 37 a registry default-jabol, 4 unset
tipus szerint: 18 szam, 15 string, 11 lista, 4 igen/nem, 2 tablazat  (13 mezo tag-es)
QUALITY_EXCLUDE ures listaval mentve  ->  source=database  value=""     (a szabaly kikapcsolva)
ugyanaz DELETE utan                   ->  source=default   value="cam,camrip,..."
STALL_MINUTES=abc                     ->  400, az ertek valtozatlan (60, default)
TORRENT_MOVIE_PATH="" (string)        ->  a sor torlodik, source=unset
TORRENT_PASS="" (titok)               ->  changed:0, a jelszo megmarad
```

Az env kiürítése után újraindítva: `[scheduler] started, scanning every 15 minutes` + `telegram notifications are on` (a token már csak a DB-ben van), `/` 200, `/details/tv/125988` 200 „Silo"-val, `POST /api/scan` `dryRun:false`, `getClientVersion()` `v5.2.2` 2 torrenttel — tehát TMDB, Jackett, qBittorrent és a Telegram mind a táblából konfigurálódik. A `.env` 8 sorra fogyott (`APP_*`, `DATABASE_*`, `SCAN_DISABLED`, `COMPOSE_*`).

#### Mit tesz egy friss install (2026-08-08-i kérdés) ✅

Kérdés: „ha egy felhasználó első alkalommal akarja elindítani, működni fog? nem fog hibát dobni hiányzó beállítás nélkül? mi lesz, ha letöltene egy filmet, de még nincs torrent/indexer?"

**Mérés, nem tipp.** Külön adatbázison (`aioseerr_fresh`), a te configod érintése nélkül: `prisma migrate deploy` mind a 7 migrációt lefuttatta üresen, aztán egy script végigjárta azokat a kódutakat, amiket egy első látogató érint. A tábla ilyenkor **0 sor, 38 default, 12 unset**.

| amit egy friss install tesz | előtte | most |
|---|---|---|
| indulás, migrációk, scheduler | lefut, nem dob | változatlan, plusz a scheduler **kimondja**, mi nincs beállítva (TMDB / indexer / kliens / tartalom-ellenőrzés) |
| főoldal TMDB-kulcs nélkül | 0 sor, **örökre pörgő hero-skeleton**, és 12 teljes axios-dump a logban | „Add a TMDB API key to get started" panel a `/settings#tmdb` linkkel, a logban 12 **egysoros** `[tmdb] /tv/popular: 401 — the api key is missing or wrong (Settings / TMDB)` |
| adatlap | `null` → `notFound()` → 404 | változatlan (kártya nélkül el sem érhető) |
| keresés indexer nélkül | 0 találat, ami hazugság: nem is keresett | a letöltés-ablak **400-at** kap: „An indexer is not configured — fill it in under Settings / Indexers." |
| letöltés kliens nélkül | `TypeError: "/api/v2/app/version" cannot be parsed as a URL` → 500 „Failed to start the download!" | `NotConfiguredError` → **400**: „The torrent client is not configured — fill it in under Settings / Torrent client." |
| percenkénti kliens-olvasás | percenként egy hibás kör | a `syncDownloadsOnce` kilép, ha nincs kliens — a figyelmeztetés egyszer, induláskor jön |
| egy scan-kör | `runScan()` végigment | változatlan |

A válasz tehát: **elindul és nem omlik össze**, de eddig *úgy* nem működött, hogy közben nem mondta meg, miért. A három javítás pontosan ezt zárja: a `NotConfiguredError` ([settings.ts](src/lib/settings.ts)) saját típus, hogy egy api route 400-at és okot adhasson 500 helyett — friss installon ez a normális állapot, nem hiba. A `isTmdbConfigured()` / `isIndexerConfigured()` / `isClientConfigured()` ugyanabba a mintába illeszkedik, mint a már meglévő `isNotifyConfigured()` és `isPayloadCheckConfigured()`.

Egy döntés az indexernél: az `isIndexerConfigured()` **nem dob**, mert a scanner ciklusban keres, és egy beállítatlan indexer nem szakíthat meg egy egész kört — a route-ok kérdezik meg előre. A kliensnél viszont dob, mert oda csak egyetlen ponton lehet eljutni.

**Egy éles incidens, ugyanebből a körből.** Miközben ezt írtam, a `/settings`-en valaki rákattintott a Jackett API-kulcs melletti visszaállítás gombra (`DELETE /api/settings?key=INDEXER_API_KEY`, a log 2118. sora). Onnantól minden indexer-keresés `Invalid API Key`-jel jött vissza, a letöltés-ablak 5 helyett 0 találatot adott. Visszaállítás: a **konténer környezete még az eredeti**, mert a `docker restart` nem olvas újra `env_file`-t — így a `scripts/import-env-settings.ts` újrafuttatva visszatette a kulcsot, anélkül hogy az értéket bárki kiírta volna. Utána `getCaps("ncore")` rendben, egy próbakeresés 116 release-t adott, a letöltés-ablak megint 5 opciót.

Ez viszont az én hibám volt a felületen, és javítva is van: **defaulttal bíró kulcsnál** a visszaállítás ártalmatlan (`RotateCcw`, kérdés nélkül), **default nélkülinél** — api kulcs, jelszó, URL, chat id — nincs mire visszaesni és nincs mivel visszavonni, ezért `Trash2` ikont kapott, `text-destructive` színnel, és **rákérdez**, mielőtt törölne. Az env eltűnésével ez a gomb lett a legélesebb kés a lapon.

**Miért nem a `.env` (2026-08-08-i felvetés, elvetve).** Felmerült, hogy a mentés inkább a `.env`-et írja, amit kézzel is lehet szerkeszteni. Megmérve: **megoldható, és nem kellene hozzá újraindítás** — a konténer írja a fájlt (root, `rw`, a bind mounton), és egy változás a dev szervert nem indítja újra (ugyanaz a pid, a scheduler nem inicializálódik újra, a logban csak `Reload env: .env`). A `process.env`-re viszont nem lehetne támaszkodni: az pillanatkép, dev alatt a Next újraolvassa, `next start` alatt viszont csak bootnál — a `loadSettings()`-nek magát a fájlt kellene parse-olnia `mtime`-ra figyelve, és a mentéshez egy műtő-pontosságú író kellene (a sor a helyén cserélődik, hogy a kommentek és a sorrend megmaradjanak; temp fájl + `rename`). Az ár, amiért nem érte meg: egy sortörés az értékben új kulcsot injektálna, a `$` a compose interpolációjába lóg bele, és az írónak a `DATABASE_*` sorokat kellene kerülgetnie. **Döntés: marad a tábla**, kézi szerkesztés nincs, a `/settings` az egyetlen felület.

**Összehasonlítás: a Jellyseerr/Overseerr ugyanezt fájlban tartja** — `config/settings.json`, egy induláskor beolvasott, memóriában tartott singletonnal, a defaultokkal a kódban; env-ből ott is csak a bootstrap jön (port, config könyvtár, DB, loglevel). Ugyanaz a szerkezet, más tároló. Egy különbség szándékos: a `settings.json`-be a *teljes* objektum kiíródik, tehát utólag nem látszik, mi volt döntés és mi default — nálunk csak a döntések kapnak sort, ezért tud a felület `edited` / `default` badge-et mutatni. A DB mellett szól még, hogy a Postgres amúgy is kötelező dependencia, és a beállítások a DB-mentéssel együtt utaznak; ellene, hogy egy elrontott `DATABASE_URL` mellett a settings sem érhető el (a `settings.json` ilyenkor is olvasható lenne).

#### Telegram-értesítések (2026-08-08-i kérés) ✅

Az app lényege, hogy akkor is dolgozik, amikor senki nem figyeli — eddig viszont csak úgy lehetett megtudni, hogy valami elkészült, ha benyitottál az oldalra. [notify.ts](src/lib/notify.ts), Telegram Bot API `sendMessage`-en.

**Három esemény**, mindegyik a `syncDownloads`/scanner meglévő döntési pontjain:

| esemény | mikor | mit ír |
|---|---|---|
| `ready` | egy letöltés befejeződött és nézhető | `✅ Ready to watch` + cím + a release neve |
| `started` | a scanner talált valamit és beadta a kliensbe | `⬇️ Download started` + cím + a release neve |
| `dropped` | egy már lehúzott release hamisnak vagy halottnak bizonyult | `⚠️ Release dropped` + cím + az ok és a release neve |

**Konfiguráció**: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `TELEGRAM_EVENTS` — utóbbi ugyanazt a konvenciót követi, mint a payload-listák: **beállítatlan = nem küld semmit**, `*` = mindent. A `TELEGRAM_API_URL` felülírható (önhosztolt Bot API szerverhez, és ez tette mérhetővé a dolgot Telegram nélkül). A `startScheduler` induláskor kiírja, hogy be van-e kapcsolva — ahogy a payload-ellenőrzés is.

**Amit szándékosan nem tesz:** a *kézi* letöltésre nem küld `started`-et, mert azt a felületen amúgy is látod; az értesítés arról szól, ami magától történt. Dry-runban nem kell külön kezelés: ott nem indul letöltés (`started` nincs), a stall- és payload-ág pedig a törlés előtt kilép (`dropped` nincs), a `syncDownloads` viszont dry-runban is tükröz, tehát a `ready` helyesen szól.

**Sosem dob és sosem lóg**: 10 másodperces timeout, minden hiba csak logol. Egy elveszett üzenet elveszett üzenet — a letöltés nem múlhat rajta.

**Mérés.** A Bot API helyére egy lokális szerver került, ami rögzíti, mi menne ki. A kapuzás:

```
nothing configured                  configured=no   sent=false  requests=0
token only                          configured=no   sent=false  requests=0
token + chat, no events             configured=no   sent=false  requests=0
events=ready only, sending ready    configured=yes  sent=true   requests=1
events=ready only, sending started  configured=yes  sent=false  requests=0
events=*, sending dropped           configured=yes  sent=true   requests=1
```

És végig, eldobható sorokkal egy valódi, kész torrentre (amit watchliston semmi nem birtokol), tehát igazi `syncDownloads`-on és igazi TMDB-címképzésen át:

```
<b>✅ Ready to watch</b>\nFight Club\n<i>Mortal.Kombat.II.2026…HUN-FULCRUM</i>
<b>✅ Ready to watch</b>\nReacher S02 — 2 episodes\n<i>Mortal.Kombat.II.2026…HUN-FULCRUM</i>
```

A HTML-escape is ellenőrizve (`Fish <&> Chips` → `Fish &lt;&amp;&gt; Chips`), mert a release-nevek tele vannak olyan karakterrel, ami a Telegram HTML-parsereit eltörné. Halott végpontra: `ECONNREFUSED` logolva, `sent=false`, kivétel nélkül. Utána a torrent érintetlen, az eldobható sorok törölve.

#### A feketelista tábla lett (2026-08-08) ✅

A `.scr`-es incidens után ez volt a legkonkrétabb nyitott pont: az eldobott release-ek neve **memóriában** élt, a folyamat élettartamára. Minden dev-szerver újraindítás új esélyt adott ugyanannak a hamisítványnak — és aznap ez nem elméleti volt.

Most `BlockedRelease` tábla (`20260808100000_blocked_releases`, tisztán additív migráció, semmit nem dob el), és a logika saját modulba került: [blocklist.ts](src/lib/blocklist.ts). A [stall.ts](src/lib/stall.ts) így visszaszűkült arra, ami tényleg csak memóriába való — az elakadás órájára.

**Két lejárati szabály**, mert a két ok nem egyenrangú:
- `STALLED` → `BLOCKED_RELEASE_TTL_DAYS` (default 30 nap) múlva újra kipróbálható. Egy este nem volt seeder — ez nem tesz egy release-t örökre halottá. `0` = ezt se felejtse el.
- `BAD_PAYLOAD` → **soha nem jár le**. Egy torrent tartalma nem javul az idővel.

**A lejárt sort nem kell takarítani**: a lekérdezés `expiresAt IS NULL OR expiresAt > now()`, tehát egyszerűen nem olvassa vissza.

**Az olvasás szándékosan szinkron maradt.** A `rateRelease` egy szoros ciklusban több száz jelöltet pontoz, ott nem lehet `await` soronként. Ezért a tábla egy `Set`-be kerül, amit a két keresési belépési pont (`planMovieGrab`, `planSeasonGrab`) tölt fel — ezeken megy át a scanner és a kézi kiadásválasztó is —, 60 másodperces cache-sel. DB-hiba nem állítja meg a keresést, csak logol: a legrosszabb eset az, hogy egy ismert rossz release még egy esélyt kap.

**Ellenőrzés.** Először magam mértem félre: a `global.blocklist` felülírása nem hat a modul már elkapott `cache` referenciájára, tehát az a „cold cache" próba nem bizonyított semmit. Az újraindítás-túlélést **két külön processz** mutatja meg:

```
process A: wrote the block
process B, fresh memory, before reading the table: false
process B, after reading the table:                true
```

A többi, ugyanezen a futáson: `BAD_PAYLOAD` sor `expires=never`, `STALLED` sor `expires=2026-09-07`; a `rateRelease` a blokkolt névre `already tried and dropped`-ot ad; a lejáratott `STALLED` sor **nem** blokkol többé, a `BAD_PAYLOAD` igen.

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

#### Admin log oldal (2026-08-08-i kérés) ✅

Kérés: legyen egy admin funkció, amivel az oldalon nézhető a log, akár valós időben; gondoljam át, érdemes-e websocket szerver; és **minden fontos művelet írjon logba**.

**Hol tárolódik.** `LogEntry` tábla (`20260808194024_log_entries`, tisztán additív). A `docker logs`-ban eddig is ott volt minden, de csak annak, aki shellt kap a konténerbe, és csak addig, amíg a konténer él. A tábla ugyanaz a döntés, mint a feketelistánál: ami a működés magyarázatához kell, az nem lehet a processz élettartamához kötve.

**Egy belépési pont: [log.ts](src/lib/log.ts).** A `writeLog(level, source, message, detail?)` három dolgot garantál, és a többi kód erre épít:
1. **soha nem dob.** Egy sikertelen naplózás nem viheti el azt a műveletet, amiről szólt — a legrosszabb eset egy kimaradó sor.
2. **a konzol is megkapja** (`console.log` / `warn` / `error`, `[source]` prefixszel), **az insert előtt** — tehát a `docker logs` akkor is teljes, ha a DB éppen nem elérhető, és egyetlen hívási helynek sem kell mindkettőre emlékezni.
3. **titok nem mehet bele.** Egy elutasított kérés hibateste visszaidézheti magát a kérést, egy indexer-kérésben pedig az api kulcs a query stringben van — a `scrub()` az `apikey=` / `token=` / `password=` alakot és a Telegram `/bot<token>/` útvonalat maszkolja. Mérve: `…?apikey=SUPERSECRET123` → `…?apikey=***`, `…/bot123456789:AAHfake-Token_x/…` → `…/bot***/…`.

**Ami logol.** Az összes `[scheduler]` sor (a modul saját `log()`-ja most a `writeLog`-ot hívja, tehát egy helyen dől el a formátum), a kézi letöltés minden elindított torrentje, a beállítás-változás, a watchlist-műveletek, és kifelé menő hibák a TMDB / indexer / qBittorrent / Telegram felől. Szint szerint: `WARN` a ledobott release, az eltűnt torrent, a friss install „nincs beállítva" sorai és **a beállítás-törlés** (2026-08-08-án egy félrekattintás így vitte el az indexer api kulcsot — ez a sor az, ami megmondta volna, hova lettek a keresések), `ERROR` a scan-kör és a sync hibája.

**Két dolog, amit a naplózás nem tehet meg: elárasztani és lelassítani.**
- Az azonos, sorozatban jövő hibák egy percre összecsuknak (`logThrottled`): egy rossz TMDB kulcs a főoldal minden sorát elbukja egyszerre, és hét azonos sor nem hét információ. Ugyanígy indexerenként és qBittorrent-műveletenként.
- A **beállítatlan** kliens nem hiba, amit óránként hatvanszor ki kell írni — a `NotConfiguredError` a torrent-modulban némán kimarad, mert a scheduler indulásnál egyszer már megmondta.
- A **kör-összefoglaló** (`round finished in 4s: 12 searched, 1 grabbed`) `INFO`, ha volt mit átnézni, és `DEBUG`, ha nem — különben naponta 96 „nem volt dolgom" sor temetné be a többit.
- A `DEBUG` szint alapból **nem is íródik ki** (Settings / Log → *Keep debug entries*), a megőrzés pedig 14 nap (`0` = örökre), amit egy írás kimenetén ellenőriz óránként — így a takarítás akkor sem áll le, ha a scanner ki van kapcsolva, és nem is fut, amikor nincs mit takarítani.

**Miért nem websocket (végiggondolva, nem elvből).** Amit a felület kér, az **egyirányú**: szerver → böngésző. A websockethez HTTP `upgrade` kell, amihez az App Router route handlerében nincs hozzáférés — vagy **saját szerver** (`server.ts`), amivel a `next dev --turbopack` esik el, vagy **második processz** külön porton, ami viszont nem látja azt a processzen belüli értesítést, amiből az egész él (és a schedulerrel is ugyanez a helyzet: az app egy processzre van tervezve). Az SSE ezzel szemben egy route handlerben elfér, nincs hozzá csomag, és az `EventSource` magától újrakapcsolódik. **Amire később ugyanez a stream jó lesz**, mert mind szerver → kliens: a letöltés-haladás a watchlist/library táblában (ma 5 másodperces poll, minden körben egy qBittorrent-hívással), a „scan-kör fut / kész" állapot, és egy toast arról, hogy valami megjött. Ha egyszer tényleg kétirányú kell, **egyetlen fájl és a benne lévő hook változik** — a `log.ts` értesítője transzport-független.

**Amit a stream helyesen tesz.** Egy kapcsolat = egy **kurzor a táblán**: az írás nem küldi el a sort, csak felébreszti a hurkot, ami utána az `id > utolsó` kérdést teszi fel. Így a tábla az egyetlen igazság, egy sor nem érkezhet kétszer vagy fordított sorrendben, és a **más processz** által írt sor is megjelenik. Az `id:` mező minden frame-ben ott van, tehát egy megszakadt kapcsolat a böngésző saját `Last-Event-ID` fejével pontosan onnan folytatja — nem replikálva a már látott sorokat. 15 másodperces üresjárati tick egyszerre keep-alive (a bufferelő proxyk ellen az `X-Accel-Buffering: no` is), és ez a biztonsági háló a kihagyott ébresztésre.

**Mérve** (futó dev szerveren, egyszerre nyitott streammel):

```
0.3s  first page: 3 entries, newestId 3        <- szerverindulás sorai a táblában
1.1s  stream 200 text/event-stream
2.2s  -> DELETE /api/log cleared 3
2.2s  <- WARN app | the log was cleared …      <- ugyanabban a processzben: azonnal
17.2s <- INFO app | written by another process <- másik processz írta: az üresjárati tick hozta
```

Plusz a beállítás-út: `PUT` → `INFO setting changed: Log / Keep debug entries (LOG_DEBUG)` `"0" → "1"`, `DELETE` → `WARN setting cleared: … back to the default "0"`. Titoknál a `detail` sosem az érték, hanem `replaced` / `set for the first time`.

**A felület** (`/log`, az ADMIN menüben a Settings mellett): szintszűrő (a *Warnings* a hibákat is tartalmazza), forrás-választó a tábla tényleges forrásaival és darabszámukkal, szöveges keresés (300 ms debounce, a `message` és a `detail` felett), *Live* kapcsoló zöld/sárga/szürke ponttal, és *Clear*. A lista **legújabb elöl**, tehát az új sor elé kerül — nincs automatikus görgetés, amit el lehetne rontani. A szűrő ugyanazokat a paramétereket adja a listának és a streamnek, egy `where`-építőn keresztül, tehát a kettő nem tud eltérni; a lapozás `before=<id>`, nem offset, mert az kihagyná az azóta beérkezett sorokat.

**Ami nyitva marad.** ~~Nincs auth: aki eléri a `/log`-ot, az elolvassa~~ — 2026-08-09 óta a `/log` és a `/settings` is **admin-only** (ld. „Bejelentkezés, szerepkörök, Authentik"). A titok-maszkolás ettől függetlenül marad: az admin sem az a szint, ahol egy qBittorrent-jelszót ki kell írni a képernyőre. És mint a schedulernél: **egy processzre** épül az azonnali ébresztés; több worker esetén a 15 másodperces tick lenne az egyetlen csatorna, ott Postgres `LISTEN/NOTIFY` a következő lépés.

#### Csak a figyelt részeknek van sora (2026-08-09-i kérdés) ✅

Kérdés: „biztos szükség van minden évad részt felvenni fixen? szerintem elég csak azt ami tényleg monitorozva van". A `WatchlistUnit` eddig a sorozat **teljes** epizódlistáját tükrözte, függetlenül attól, hogy a felhasználó mit követ.

**Mennyiről van szó.** A watchlisten lévő Silo 30 sort tartott, amiből **4** volt figyelt (S03E07–E10); a többi 26 minden metaadat-körben újraíródott anélkül, hogy bármit jelentett volna. Nagyságrendileg: a Grey's Anatomy 466, a The Simpsons 802 epizód — egyetlen sorozat, akkor is, ha az utolsó évadot követed belőle.

**Amit a mérés mutatott: a kód már eddig is így gondolkodott.** A `trackedUnits` mindenhol pontosan a `monitored = false && status = PENDING` sorokat szűrte ki (státusz, `X/Y` számláló, `withMedia`), a `pruneWatchlistItem` megtartási szabálya pedig szó szerint `monitored || DOWNLOADING || DOWNLOADED` volt. Vagyis a rendszer saját definíciója szerint ezek a sorok **nem léteztek** — csak tárolva voltak. Egyetlen dolgot csináltak: horgonyt adtak az `updateMany`-nek.

**Az új szabály.** Egy unit akkor van, ha **figyeled vagy már megvan**. Ebből következik minden más:
- **A monitorozás nem flag-billentés, hanem sor-létrehozás és -törlés.** Bepipálás → a unitok létrejönnek a TMDB dátumaival (`ensureEpisodeUnits` / `ensureSeasonUnits`), kivétel → a `pruneWatchlistItem` eldobja őket, ha nincs mögöttük letöltés.
- **A letöltés is „megvan"-nak számít.** Az azonnali letöltés (`executeSeasonGrab`) ott hozza létre a sorokat, ahol eddig készen találta őket, és a több évados pack (`packUnitIds`) ugyanígy létrehozza a lefedett évadokét — enélkül eltűnt volna a védelem, ami megakadályozza, hogy ugyanaz az anyag másodszor is lejöjjön.
- **A `syncTvSeasons` már nem tükröz, hanem követ**: a meglévő sorok `airDate`-jét frissíti, és csak azt hozza létre, ami az öröklési szabály szerint kell. A Silo köre most **29 ms, 4 sor**, 30 upsert helyett.

**A csapda, ami két javítást kényszerített ki** — sor nélkül a „nem lett bejelentve" és a „nem kérted" egyformán néz ki:
1. Az első verzió egy figyelt évad *összes* hiányzó epizódját magára vette, tehát a metaadat-kör visszapipálta azt is, amit a felhasználó épp levett (mérve: Silo 4 → 10 sor, egy levett E01 visszajött). Javítás: csak a tárolt legnagyobb sorszám **fölött**.
2. Ugyanez évad-szinten: egy évad kipipálása után a kör a sorozat összes többi évadát is felvette (mérve: Ted Lasso S1 kipipálva → 43 sor, S2–S4 mind figyelt). Itt a sorszám nem elég, mert a régi évadok is ott vannak a listán — ezért lett a szándék **tárolt mező** (`monitorNewSeasons`), nem következtetés. A migráció a meglévő sorokra egyszer lejátssza a régi döntést (akinek a legfrissebb évada figyelt, az `true`-t kap), tehát a Silo ugyanúgy fogja követni a S4-et, mint eddig.

**Mérve** (a saját adatbázisodon, eldobható sorral a Ted Lassóra, ami utána törlődött):

```
1. a te sorod                        4 sor, új évadok: igen   S3: 4/4 figyelt   (metaadat-kör után változatlan)
2. azonnali letöltés, semmi kipipálva 0 sor
3. S1 kipipálva -> E01 levéve        10 -> 9 sor, a metaadat-kör nem nyúl hozzá
4. E10 „most jelent be"              8 -> 9 sor, felveszi
5. S02E01-E02 letöltve               a sor létrejön figyelés nélkül, az évad többi része nem
6. S01-S03 pack                      3 évad, 22 unit lefoglalva, a sorok létrejönnek
7. stop watching                     csak a 2 letöltött marad, a tétel a listán marad
8. „ezt a sorozatot nézem"           44 sor, új évadok: igen; a törölt S4 a következő körben visszajön
```

Migráció: `20260809120000_drop_unwatched_units` (a te 26 felesleges Silo-sorod, plusz a unit nélkül maradt tételek) és `20260809130000_monitor_new_seasons`.

**Incidens a bevezetéskor (2026-08-09, ~08:39).** A migráció lefutott, a kód elkészült, a Silo négy soron állt — a **futó dev szerver viszont még a régi `syncTvSeasons`-t tartotta a memóriájában**, mert a schedulert az `instrumentation.ts` indítja a boot-nál, és az a modulgráf nem esik a hot reload hatálya alá. Egy külön `bun` processzben az új kód négy sort mért, ugyanabban a percben a szerverben futó **régi** szabály viszont a friss, ritka adatra nézett rá: „az évadnak nincs unitja → örököljön a legmagasabb meglévő évadtól", ami S3-ra `monitored = true` volt. Ezzel a Silo mind a 30 epizódja figyeltre került, a következő kör pedig **26 unitot keresett és 8 torrentet indított** (S01 pack 41 GB, S02 pack 7,5 GB, öt S03-as epizód) — kb. 65 GB-nyi nem kért letöltés.

A tanulság nem a szabályról szól, hanem a sorrendről: **egy migráció, ami megváltoztatja a meglévő adat jelentését, addig veszélyes, amíg a régi kód még fut rajta.** A „nincs sor" itt tegnap még „nem kérted, de tudunk róla" volt, ma pedig „nem kérted" — a régi öröklés a másodikat az elsőnek olvasta. Ezért került be a lenti üzemeltetési jegyzetbe: ilyen migráció után **azonnal `docker compose restart aioseerr_app`**, még a következő scan-kör előtt.

Helyreállítás: a hét torrent leállítva (`/api/v2/torrents/stop`, nem törölve — a döntés a felhasználóé), a 26 átvett unit törölve, a Silo vissza a négy figyelt epizódra, a szerver újraindítva. Az újraindulás utáni első kör: `round finished in 0s: 0 searched, 0 grabbed`.

**Ami nyitva marad.** A bepipálás mostantól TMDB-hívást igényel (cache-elt, 12 óra), tehát TMDB-kiesésnél nem lehet évadot felvenni — eddig a sorok már ott voltak, csak billenni kellett. Cserébe TMDB nélkül az adatlap sem jelenik meg, tehát a gyakorlatban nem új korlát. A `monitorNewSeasons`-nek nincs saját kapcsolója a felületen: a „watchlistre teszem" gomb kapcsolja be, az évadonkénti pipálás nem, a `Stop watching` pedig kikapcsolja.

#### A watchlist keres, a library birtokol (2026-08-09-i kérés) ✅

Kérés: a watchlist szerepe **csak annyi legyen, hogy a scanner tudja, mit kell figyelnie**; amint elindul a letöltés, a tétel kikerül a watchlistből (a táblából is), és átkerül a **libraryba**, ahol a letöltés állapota látszik, majd elérhetővé válik és elindul a seed időszak. A seed idő beállítható, alapból 3 nap; alatta a tétel nem törölhető, csak **megjelölhető törlésre**, és a végén magától eltűnik. Két döntés a kérdéseimre: a torrent a seed idő letelte után is **seedel tovább**, amíg nem törlöd, és a library **letöltésenként egy sort** mutat.

**Amit ez a modellben jelent.** Eddig egy `WatchlistUnit` sor öt állapoton ment végig (`PENDING → SEARCHING → DOWNLOADING → DOWNLOADED`), és ugyanaz a tábla volt a keresési sor és a leltár. Most kettéválik:

| | Watchlist | Library |
|---|---|---|
| mire válaszol | *mit kell még megtalálni* | *mim van, és mi jön* |
| sor = | egy epizód / egy film, amit még keresünk | **egy torrent**, és minden, amit hoz |
| állapotok | `PENDING`, `SEARCHING` | `DOWNLOADING`, `AVAILABLE` |
| élettartam | a letöltés indulásáig | a törlésig (utána is, tombstone-ként) |

A `LibraryItem` sor **a torrent hozzáadása előtt** jön létre, mert az id-ja lett a tag, amiről a hash visszaolvasható — ezzel a `movieTag` / `episodeTag` / `seasonTag` hármas egyetlen `libraryTag`-ra egyszerűsödött. Hogy egy letöltés mit fed le, az az `episodes` oszlopban van, `évad:rész` kulcsok tömbjeként: filmnél üres, epizódnál egy elem, packnél mind — a több évadot fedő pack másik évadjait is.

**Miért nem külön `LibraryEpisode` tábla.** Először az volt, és egy commitig élt. A négy olvasóból három (`heldEpisodes`, a `syncTvSeasons` vízjele, az adatlap epizód-állapotai) **azonnal kulcs-halmazzá lapította** a gyerek sorokat, a negyedik (`coverText`) pedig végigment rajtuk — vagyis a tábla minden olvasásnál újraépítendő halmaz volt. Ráadásul minden kérdés **egy címre** vonatkozik (`where tmdbId`), tehát a gyerektábla indexe sem vásárolt semmit: címenként néhány sorról van szó. A `@@unique([itemId, seasonNumber, episodeNumber])` sem védett semmit, amit a tömb ne védene — két *különböző* letöltés amúgy sem ütközhetett benne, azt a `held` ellenőrzés akadályozza meg kódban. Ami elveszett: nem lehet globálisan lekérdezni, hogy „kinek van meg az S03E07" — ilyen kérdés nincs, és ha lesz, a Postgres tömb-operátorai (`@>`) megválaszolják.

**Ami ebből következett, és nem volt nyilvánvaló:**

- **A hiányzó sor kétértelműsége, harmadszor.** Ha egy évad összes unitját elviszi a letöltés, semmi nem őrzi, hogy az évadot *figyelted* — a következő epizódja így nem kerülne fel. Ezért van a `LibraryItem.watched`: azt rögzíti, hogy amit ez a letöltés leváltott, figyelt volt-e. A `syncTvSeasons` vízjele (`már felkínáltuk`) is a libraryból egészül ki, a törölt sorokat is beleértve — enélkül egy kitörölt epizód a következő körben újra letöltődne.
- **A törlés a sorozatnál nem törli a sort.** `removedAt` kerül rá, mert a `syncTvSeasons` vízjele ebből tudja, hogy azt az epizódot már felkínáltuk — enélkül a következő kör újra lehozná. **Filmnél viszont tényleg törlődik**: nincs `episodes` kulcsa, tehát a tombstone-ja semmit nem őriz, és a többi lekérdezés amúgy is kihagyja a `removedAt`-os sorokat. Egy olyan sor maradna, amit senki nem lát és senki nem olvas. A `runLibraryCleanup()` a régi, üres tombstone-okat is elviszi.
- **Ami sosem landolt, visszakerül a watchlistre.** Elakadt, hibás, hamis tartalmú vagy a kliensből eltűnt torrentnél a `restoreToWatchlist` visszaírja a unitokat és eldobja a library sort — az mindig egy *letöltést* jelent, és nem volt letöltés. **Figyeltként** kerül vissza, akkor is, ha azonnali letöltésként indult: az alternatíva az, hogy valami, amit kértél, némán megszűnik létezni.
- **A `/api/watchlist` cím szerint is kérdezhető.** Egy sorozat, aminek minden epizódja letöltött, **nem szerepel a watchlist táblában** — az adatlapnak mégis ki kell pipálnia a részeit. A `getTitleState()` ezért mindkét táblából épít, és `id: null`-lal tér vissza, ha nincs watchlist sor.
- **Egy badge, két tábla.** A poszterek `getWatchlistSlim()`-et kérdezik, ami mostantól **összefésült** listát ad: ami épp töltődik, az `Downloading`, ami csak a libraryban van, az `Available`, a többi a watchlist saját állapota.

**A seed időszak.** `LIBRARY_SEED_DAYS` (Settings / Library, default 3). A `seedUntil` a letöltés befejezésekor áll be, és **kizárólag a törlés gombot zárolja** — a torrent utána is seedel, amíg te nem törlöd. Zárolás alatt a törlés dialógusa „törlésre jelölés"-re vált (fájllal vagy anélkül), a `runLibraryCleanup()` pedig a percenkénti kliens-visszaolvasással együtt fut, tehát a késés legrosszabb esetben egy perc. Az API a biztosíték: `DELETE` seedelés közben **409**, nem csak a gomb tűnik el.

**Mérve** (a futó szerveren, eldobható Ted Lasso sorral, ami utána törlődött):

```
1. S1 kipipálva                     watchlist: 10 unit    library: üres
2. a pack elindul                   watchlist: nincs sor  library: DOWNLOADING x10 watched
3. újra keresné?                    0 epizód kereshető, 0 grab
4. befejeződik                      AVAILABLE, még 72 óra seedelés
5. DELETE -> 409 "still seeding",   PATCH -> 200, a sor "marked"
6. cleanup seedelés alatt: 0 tétel; a lejárat után: 1 tétel -> removed
7. metaadat-kör: nem hoz vissza semmit; a libraryból törölt E10 -> 1 unit visszakerül
8. a torrent meghal                 watchlist: 1 unit     library: üres
9. badge: 125988 UPCOMING (watchlist) | 1339713 DOWNLOADED, id=null (csak library)
```

Migráció: `20260809160000_library`, majd `20260809180000_library_episode_list` (a gyerektábla összevonása). A meglévő letöltések torrentenként csoportosítva kerültek át (a hash amúgy is pontosan így fogta össze őket), a `completedAt` a sor utolsó módosítása — pontosabb adat nem volt, és csak azt dönti el, mikor oldódik a zár. A release nevét egyik unit sem tárolta; azt a következő kliens-visszaolvasás tölti ki a torrent nevéből.

**Két javítás az első éles próbán (2026-08-09).** A Mortal Kombat II-re megnyomott letöltés nem indult el, hanem a watchlistre került. Ok: a film **már benne volt a kliensben**, a qBittorrent pedig egy ugyanolyan torrentet nem ad hozzá másodszor — így az új tag alatt semmi nem jelent meg, az `addRelease` `null`-t adott, és a visszaesési ág (`restoreToWatchlist`) tette watchlistre. Az `addRelease` utolsó szava mostantól egy **név szerinti keresés** a kliensben: ha megvan, felveszi rá a taget és azt a hasht adja vissza — a „ez már megvan" elindult letöltés, nem sikertelen. Mérve: a következő kör felvette a meglévő torrentre az `aioseerr-9` taget, a sync pedig egy percen belül `AVAILABLE`-re vitte, új letöltés nélkül. Mellette: egy tényleg el nem induló grab mostantól **logol és a válaszban is megmondja** — eddig néma volt, és ez tette a hibát „watchlistelésnek". És a `scanMovies` a filmeknél is megkérdezi a libraryt (`hasLibraryItem`), ahogy az epizód-ág a `heldEpisodes`-t — enélkül egy visszakerült film újra letöltődik, tetszőleges release-ben.

**Visszaszámláló a Scan now mellett (2026-08-09-i kérés).** A scan-kör saját ütemezőt kapott a közös `loop` helyett, mert **minden kör újraindítja az óráját** — a kézi is. A `GET /api/scan` adja a következő kör időpontját, a gomb alatt másodpercenként ketyeg. Mérve: a kör előtt 880 mp, egy kézi scan után pontosan 900 (15 perc).

**Ami nyitva marad.** A `WatchStatus` enumban benne maradt a `DOWNLOADING`, `DOWNLOADED` és `FAILED` — a unitok már egyiket sem veszik fel, de egy Postgres enum-érték eldobása külön migráció, és a badge-ek úgyis ugyanezeket a neveket használják a library felől. A `monitorNewSeasons`-nek továbbra sincs saját kapcsolója a felületen. És a seedelésnek nincs arány-alapú vége: az „meddig seedeljen" kérdésre a válasz most „amíg nem törlöd".

#### Bejelentkezés, szerepkörök, Authentik (2026-08-09-i kérés) ✅

Kérés: „csinálj user kezelést, bejelentkezéssel, admin fiókkal, oauth támogatással hogy authentiket tudjak használni". Három döntés a kérdéseimre: **közös lista, admin a kapuőr** (nincs Overseerr-szerű kérelem-folyamat), **saját session + OIDC kliens** (nem Auth.js), és **az Authentik által beengedett ismeretlen automatikusan fiókot kap**, user szerepkörrel.

**Miért nem Auth.js.** Ebben a kódbázisban minden konfiguráció a `Setting` táblából jön, és futásidőben átírható újraindítás nélkül (ld. „Csak a settings, env nélkül"). A NextAuth v5 a providereket **modul-szinten**, importáláskor várja, és env-változókból konfigurálja magát — vagyis vagy megszegtem volna a saját szabályt, vagy végig a könyvtár ellen dolgozom. Cserébe amit meg kellett írni, az kevesebb, mint amit a beillesztése jelentett volna: egy random token, egy sor, és egy authorization-code flow.

**Nincs mit titkosan tárolni.** A cookie a tokent viszi, a `Session.id` annak a **SHA-256-a**. Semmi nincs aláírva, tehát nincs `AUTH_SECRET`, amit be kéne tenni az env-be — és egy kiszivárgott adatbázis nem egy csomó működő session. A jelszó `scrypt` (node beépített, memóriaigényes), a tárolt alak `scrypt$N$r$p$salt$hash`, tehát a költség később emelhető anélkül, hogy a meglévő sorok érvénytelenné válnának. `+0 npm függőség`.

**Hol a határ.** A `middleware.ts` **nem** az: az edge runtime-on nincs adatbázis, ott csak annyi látszik, hogy van-e egyáltalán session cookie. Az igazi ellenőrzést minden route handler maga kéri (`refuseUnlessSignedIn` / `refuseUnlessAdmin`), a tábla ellen. A middleware dolga csak az, hogy a bejelentkezetlen böngésző a `/login`-ra menjen és ne egy üres képernyőre, az API pedig 401-et adjon és ne egy redirectet, amivel a `fetch` nem tud mit kezdeni.

| | user | admin |
|---|---|---|
| discover, keresés, adatlap | ✅ | ✅ |
| watchlistre tesz / levesz | ✅ | ✅ |
| letöltést indít | ✅ | ✅ |
| library megnézése | ✅ | ✅ |
| **library törlés / törlésre jelölés** | ❌ | ✅ |
| **Scan now** | ❌ | ✅ |
| **Settings, Log, Users** | ❌ | ✅ |

A „watchlistről levétel" szándékosan a user oldalán maradt: visszafordítható, és ami már letöltődött, azt nem érinti. A **törlés** a fájlokat viszi, azt nem.

**Az első admin.** Nincs env-ből seedelt fiók (nem lenne hova tenni), ezért: amíg **nulla** user van, minden a `/setup`-ra megy, ahol az első ember adminként létrehozza magát — és a `createFirstAdmin` másodszor is ellenőrzi, mert ez az egyetlen végpont az appban, ami idegennek írással válaszol. Az ablak abban a pillanatban bezárul, hogy létezik egy fiók.

**OIDC, egy fájlban.** `discovery` → PKCE (S256) → authorization code. Az issuer az egyetlen, amit tudni kell, a többi endpoint a `.well-known/openid-configuration`-ből jön (10 percig cache-elve, issuer-váltásra azonnal újra). Az `id_token` **aláírását nem ellenőrzöm**, és ez tudatos: a token-választ ez a szerver kérte le, a token endpointról, TLS-en, egy kóddal, aminek csak nála volt meg a verifier-e — a benne lévő identitáshoz nem kell aláírás, mert nem volt más a beszélgetésben. Ami a két lábat összeköti, az a `state`, ami rövid életű cookie-ban utazik és visszafelé összehasonlításra kerül.

**Az Authentik-specifikus rész**, amiért az egész készült: `AUTH_OIDC_ADMIN_GROUPS`. Ha ki van töltve, a provider dönti el minden általa beléptetett fiók szerepkörét — a csoportból való kikerülés **elveszi** az admint, nem csak adni tud. Egy kivétellel: az **utolsó** admint nem veheti el, mert egy elgépelt csoportnév különben olyan installt hagyna maga után, amit csak adatbázisból lehet megjavítani.

**Mérve** (a futó szerveren, eldobható `verify-admin@` és `verify-user@` fiókkal, amik utána törlődtek):

```
setup             -> admin #1, session cookie
admin             -> /api/{watchlist,settings,log,library,scan}  mind 200
user              -> watchlist/library/scan(GET) 200
                     settings/log/users/scan(POST)/library DELETE  403
                     PUT /api/settings 403, és a LIBRARY_SEED_DAYS tényleg nem íródott
kikapcsolt user   -> a nyitott session 401, és belépni sem tud (401)
saját szerepkör   -> "You cannot change your own role."
11 rossz jelszó   -> 401 x10, majd 429
OIDC kikapcsolva  -> /oidc/start 307 -> /login?error=sso
OIDC bekapcsolva  -> 307 -> accounts.google.com/o/oauth2/v2/auth?...&code_challenge_method=S256
                     (valódi discovery, valódi PKCE; a próba-issuer utána törölve)
rossz state       -> "That sign-in attempt could not be verified"
provider elutasít -> a saját szövege jön vissza a login oldalra
```

**Amit nem tudtam kipróbálni:** magát az Authentik-belépést, mert ahhoz a te példányod kell. A flow minden lába megvan mérve a token-cseréig; ami hátra van, az a `sub`/`email`/`groups` kiolvasása egy valódi userinfo-válaszból.

**Ami nyitva marad.** Nincs „elfelejtett jelszó" (levélküldés nélkül az admin `Set a password` gombja az), nincs kétfaktor (az Authentik dolga), és a `/api/log/stream` jogosultsága a kézfogáskor dől el egyszer — egy közben megszűnt session egy már nyitott kapcsolatba kerül.

#### Mindenkinek saját watchlistje (2026-08-09-i kérés) ✅

Kérés: „a watchlist mégse legyen közös, az mindenkinek saját legyen (így senki se tudja törölni más filmjét a watchlistről, kivéve az admin)… ha pl. letöltött a film, akkor mindegyik watchlistelt recordon egységesen kell végrehajtani a műveleteket", plusz: a usernek legyen **saját Telegram-értesítése** a saját dolgairól.

Ez visszavonja a pár órával korábbi „közös lista" döntést, és a modell **aszimmetrikus** lett:

| | kié | miért |
|---|---|---|
| **Watchlist** | mindenkinek a sajátja | a *várakozás* személyes: az én listám az én ízlésem |
| **Library** | közös | a *fájl* egy darab, akárhányan várták |

`Watchlist` egy `userId`-t kapott, és az egyediség `(userId, tmdbId, type)` lett — **ugyanaz a film három ember listáján három sor**.

**A drága következmény, ami minden íráson átmegy.** Semmi nem kérdezheti többé egy sorból, hogy „figyeljük-e ezt". Ami egy *címre* hat — elindult egy letöltés, egy release hamisnak bizonyult — annak **mindenki során** kell hatnia egyszerre. Ez a `moveToLibrary` és a `restoreToWatchlist`: az egyik minden listáról leszedi, amit a torrent hoz, a másik mindenkinek visszaadja, akitől elvette. A `Library.watched` bool ezért lett `watchedBy Int[]`: az a lista, akiktől elvette — és **ugyanez az értesítési lista**.

**A scanner deduplikál.** Négy ember ugyanarra a filmre négy unit, és továbbra is **egy** keresés: a `scanMovies` `tmdbId` szerint, a `scanEpisodes` `tmdbId:évad` szerint csoportosít (eddig `watchlistId:évad` volt). Nem optimalizálás — négyszer ugyanazt kérdezni egy indexertől az a mód, ahogy egy fiókot letiltanak. A backoff is a *címé*: aki utoljára kérte, az nem nullázza a többiek óráját.

**Az azonnali letöltésnek nincs watchlist sora**, tehát nincs miből kiolvasni, kié. Ezért kapott a `moveToLibrary` egy `requestedBy`-t: aki a gombot nyomta, bekerül a `watchedBy`-ba. Enélkül egy meghiúsult azonnali letöltésnek nem lenne hova visszakerülnie, és a kész filmről senki nem kapna értesítést.

**Saját értesítés: egy webhook URL.** Először Telegram chat id volt, de az egy szolgáltatást jelentett. Most `User.webhookUrl` + `notifyEvents`, a `/account` oldalon — bármilyen URL, tehát a Telegram és a Discord is „csak egy URL", és nincs szolgáltatás-választó. Ld. a lenti „Egy URL, két alak" alfejezetet. A **Settings-beli Telegram az installé** és mindenről hall; a webhook a felhasználóé és csak a sajátjáról. Akinek mindkettő be van állítva, két üzenetet kap: egyet üzemeltetőként, egyet magánemberként — ez a helyes olvasat, nem duplikáció. Az admin nem tudja se beállítani, se megnézni valaki más webhookját: az csak a `/api/auth/me`-n megy át.

**Mérve** (eldobható „Anna" adminnal és „Bela" userrel, utána törölve):

```
mindketten felveszik a Fight Clubot   -> 2 watchlist sor, ugyanaz a tmdbId
Anna lát 1-et, Bela lát 1-et, ?all=1  -> 3 (a te House of the Dragonoddal együtt)
Bela ?all=1                           -> továbbra is 1 (nem admin, a kapcsoló figyelmen kívül)
Bela törli Anna sorát                 -> 404, és Anna sora ott marad
Bela törli a sajátját                 -> 200
Anna törli Bela sorát                 -> 200, a log: "off Bela's list — by Anna"
letöltés indul (közvetlen hívás)      -> watchedBy [Anna, Bela], 0 sor marad egyik listán sem
a grab meghiúsul                      -> 2 sor vissza, mindkettő figyelve, a library sor eltűnt
dry-run scan, 2 ember ugyanarra       -> EGY sor: "movie 550: grabbing ... (2 people are waiting for it)"
                                         a kör összegzése: "2 searched" (keresés, nem sor)
Bela saját chat id-ja                 -> mentve; a /api/users válaszában sehol nem szerepel
```

**Ami nyitva marad.** A `getWatchlistSlim` a saját listádat fésüli össze a **teljes** libraryval, tehát a posztereken `Available` jelvényt látsz olyasmin is, amit más töltött le — ez szándékos, a fájl közös. A `refreshMetadata` címenként annyiszor fut, ahány ember figyeli (a TMDB-cache miatt olcsó, de nem nulla). És a migráció minden korábbi watchlist sort **az első adminra** írt: az install eddig egy emberé volt, most az övé.

#### Egy URL, két alak (2026-08-09-i kérés) ✅

Kérés: „a user saját magánál inkább webhookot adhasson meg, egy linket benne placeholderrel — így telegram és discord értesítéseket is tud kapni".

A két szolgáltatás nem ugyanúgy fogad üzenetet: a Telegram `sendMessage`-e **GET**, a szöveg a query stringben; a Discord webhook **POST**, a szöveg JSON törzsben. Ahelyett, hogy megkérdezném, melyikről van szó, **maga az URL mondja meg**: ha van benne placeholder, a szöveg az URL-be megy és GET lesz; ha nincs, POST lesz `{"content": …}` törzzsel. Így mindkettő egy mező, és nincs mit kiválasztani:

```
https://api.telegram.org/bot<token>/sendMessage?chat_id=123&text={message}
https://discord.com/api/webhooks/<id>/<token>
```

Placeholderek: `{message}` (a teljes szöveg), `{title}`, `{detail}`, `{event}`. URL-be `encodeURIComponent`-tel megy — egy release-név tele van ponttal, zárójellel és `&`-tel, kódolatlanul kettévágná a query stringet.

**Amiért ez őrzött.** A szerver hív meg egy URL-t, amit egy tetszőleges bejelentkezett felhasználó adott meg — ez **SSRF**: az app eléri a qBittorrent API-ját, a Postgrest és a saját admin végpontjait, amiket a böngészőjéből nem érne el. Ezért a privát és loopback címek alapból tiltottak (`localhost`, `127.`, `10.`, `192.168.`, `172.16–31.`, `169.254.`, `::1`, `fc/fd`, `.local`, `.internal`), és csak a `NOTIFY_WEBHOOK_ALLOW_PRIVATE` kapcsolja fel őket. Ez **hostnév-alapú**, tudatosan: egy DNS-név mögé rejtett privát cím elkapásához resolver kell és minden átirányítás után újraellenőrzés — az több gépezet, mint amennyit egy otthoni install indokol. A nyilvánvalót megfogja, a kapcsoló pedig ott van annak, akinek tényleg belső fogadója van.

**Teszt gomb**, mert enélkül hetekkel később derülne ki, hogy elgépelted: a `/account` oldalon a mező mellett, és **a képernyőn lévő értéket küldi**, nem a mentettet.

**Mérve** (a konténerben futó fogadóval, ami leírta, mi érkezett):

```
{message}-szel   GET /hook?chat_id=42&text=%E2%9C%85%20Ready%20to%20watch%20%E2%80%94%20A%20test...
nélküle          POST /api/webhooks/1/2
                   body: {"content":"✅ Ready to watch — A test from aioseerr — ..."}
igazi esemény    notifyUsers([Wanda]) -> 1 elküldve
más userre       -> 0            (nincs webhookja)
"started" neki   -> 0            (csak "ready"-re iratkozott fel)
guard vissza     localhost -> elutasítva, 192.168.1.10 -> elutasítva
                 "not a url" -> elutasítva, file:///etc/passwd -> elutasítva
```

#### Mindenkinek saját nyelve, és a nyelv külön kiadás (2026-08-09-i kérés) ✅

Négy bejelentés egyszerre: (1) más épp futó letöltése nem látszik a libraryban, csak ha kész; (2) a preferált nyelv felhasználónként állítható legyen, a globális settingsből ki is kerülhet; (3) a letöltési listában látszódjon a torrent nyelve; (4) ha az elsődleges nyelven nincs kiadás, arra kérdezzen rá.

**1. A library tábla nem frissült magától.** A sor mindig is a letöltés *indításakor* jött létre `DOWNLOADING`-gal, és a `getLibrary()` sosem szűrt felhasználóra — a hiba a felületen volt: a poll csak akkor indult el, ha a tábla **már látott** egy `DOWNLOADING` sort. Nyitva hagyott oldalon tehát más letöltése sosem bukkant fel. Most mindig frissül, két sebességgel: 5 mp, amíg megy valami (a százalékok miatt), egyébként 20 mp — mert ez a tábla a háztartásé, és az új sor ugyanolyan gyakran más letöltése, mint a saját százalékod.

**2–4. A nyelv nem beállítás lett, hanem kiadás.** A válaszaid alapján: két ember két nyelve **két külön letöltés, két library sor, végig külön kezelve**; egy ember listája viszont marad rangsor (elsődleges + tartalék); a scanner pedig **csak az elsődlegest** tölti le magától, tartalékra sosem vált át magától.

Ebből következik a modell:

- **A `User` megkapta az egész Language csoportot** (`preferredLanguages`, `excludeLanguages`, `defaultLanguage`, `languageBonus`, `languageFirst`), a `Setting` registryből pedig kikerült mind az öt. A migráció (`20260809260000_personal_languages`) **átmásolja az eddigi globális értékeket minden meglévő userre**, tehát a bevezetés napján semmi nem változik: mérve, mindkét fiók `hun,eng`-gel indult, és az öt `Setting` sor eltűnt.
- **A `Library` sor kapott `language` mezőt.** Üres = a bevezetés előtti letöltés: az *ismeretlen mindenkié*, különben egy frissítés az egész könyvtárat újra letöltötte volna.
- **„Megvan-e már" kérdés nincs többé önmagában** — csak „megvan-e *neki*". Ezt a [audience.ts](src/lib/audience.ts) mondja meg: egy sor akkor számít a tiédnek, ha (a) ugyanaz a kiadás, vagy (b) *érted* töltötték le (a kézzel elfogadott másik nyelv), vagy (c) a bevezetés előttről való. Erre épül a `heldEpisodes`, a `hasLibraryItem`, a `seasonStarted`, és a poszterek jelvényét adó `libraryState` is — utóbbi nélkül a más nyelvén letöltött film „Available"-nek látszott volna nálad is.
- **A `moveToLibrary` már nem viszi el mindenki unitját**, csak azokét, akikért a keresés ment (`forUsers`). Aki más nyelvet vár, az tovább keres — neki ez egy másik film.
- **A scanner nyelvenként csoportosít** (`tmdbId:nyelv`, sorozatnál `tmdbId:évad:nyelv`), és a profilja **szigorú**: ami nincs az elsődleges nyelven, az nem rosszabb találat, hanem nem találat (`requireLanguage`). A kézi letöltés ugyanezt a réteget nyitott profillal hívja, tehát ott minden ott van a listában.

**Egy lyuk a saját tervemben, menet közben javítva.** Ha valaki *ugyanazt* a nyelvet várja, de a köre épp nem esedékes (backoff), akkor a letöltés nem viszi el a unitját, a következő körben viszont a scanner látja, hogy a kiadás megvan, és nem keres — a unit örökre `PENDING` maradt volna, miközben a fájl ott van a lemezen. Ezért van a `claimHeldUnits`: keresés helyett rácsatolja a várakozókat a meglévő sorra (`watchedBy`), és a unitjaik ugyanúgy elmennek, mintha a körben lettek volna.

**Felületen:** a kiadásválasztóban a nyelv a sor **első** adata (a felbontás elé került — ez az egy dolog dönti el, hogy egyáltalán nézhető-e), a library táblában külön oszlop (ugyanaz a film kétszer szerepelhet, és csak ez különbözteti meg őket), az account oldalon pedig ott a teljes Language csoport, húzható sorrenddel.

**A 4. tétel a kiadásválasztóban van, és tényleg megerősítés:** ha egyetlen sorra sincs az elsődleges nyelveden kiadás, sárga sáv írja meg, mit hagynál ki („magára hagyva ez a watchlistedre kerülne, amíg meg nem jelenik"), és a **Download gomb tiltva marad**, amíg be nem pipálod, hogy így is jó. Azért itt, mert 2026-08-08 óta *minden* letöltés ezen az ablakon megy keresztül — külön „azonnali letöltés" út nincs.

**Mérve, a te adatbázisodon** (eldobható szkript, kamu felhasználókkal és a `550`-es tmdb id-vel, amit előtte ellenőrzött, hogy nincs az installban; a végén mindent törölt):

```
units before                hu=1 en=1 late=1
a hun kör lefut             library row: language=hun watchedBy=[hu]
units after                 hu=0 en=1 late=1      ← az angolos tovább keres, helyesen
claimHeldUnits(late)        claimed=1 → watchedBy=[hu,late], late unitja elment
claimHeldUnits(en)          claimed=0             ← a magyar fájl nem az övé
takarítás                   nem maradt sor
```

És a szigorú szűrő ugyanott, `primary=hun`-nal:

```
…H264 HUN-GROUP    scanner: TAKEN            dialog: offered
…H264-GROUP        scanner: not in hun       dialog: offered
…H264 ITA-GROUP    scanner: not in hun       dialog: offered
```

**Amit ez az install napi működésében jelent, és amiért érdemes szemmel tartani:** a te elsődleges nyelved `hun`, a release-ek túlnyomó része viszont **jelöletlen** (`untagged = eng`). A scanner mostantól ezekhez nem nyúl — ami korábban magától lejött angolul, az ezután a watchlisten marad, és kézzel, a sárga sávot megerősítve indítható. Ha ez sok, két út van: az account oldalon `eng` az első nyelv (a magyar akkor is előrébb pontozódik, csak nem kizárólagos), vagy az `untagged` mező átírása.

**A két maradék tétel, utólag megcsinálva (ugyanaznap):**

**A főoldal személyes sorai a libraryból jönnek.** A `Downloading now` és a `Ready to watch` eddig watchlist sorokból épült, egy elindult letöltésnek viszont már nincs watchlist sora — filmnél ez a sor sosem telhetett meg. Most a `getPersonalLibrary(userId, status)` adja őket (címenként egy kártya, nem torrentenként), a `getSections` pedig **megkapta a bejelentkezett felhasználót**: eddig `getWatchlistWithMedia()` hívás ment user nélkül, tehát a „On your watchlist" sor mindenki listáját mutatta, holott a címe az ellenkezőjét ígérte. Mérve a te fiókodra: a `downloaded` sor a két library elemet hozza (`Regular Show: The Lost Tapes`, `Obsession`) — korábban itt nem volt semmi.

**A dialógus megmondja, ha ugyanaz a kiadás már megvan.** Két fél, szándékosan másképp: az **epizódok kikerülnek** a listából (a grab úgyis visszautasítaná őket, tehát egy olyan sor lenne, ami csendben nem csinál semmit), a **film viszont bent marad**, mert egy második példány olyasmi, amit a grab tényleg megcsinál — és néha pont az kell, ha az első egy rossz rip. Sárga sáv írja meg, és a Download gomb tiltva marad, amíg be nem pipálod. Ha az egész kérés megvan már, az ablak ezt mondja („You already have …"), nem azt, hogy az indexereken nincs meg — ez két különböző válasz. Mérve az `Obsession`-re: `choices=1, held=["Movie"]`.

#### Éles telepítés: egy image, egy compose (2026-08-09-i kérés) ✅

Kérés: „Komodóban akarom futtatni dockerrel, a lehető legegyszerűbb beüzemeléssel, hogy más felhasználók is meg tudják oldani — egy image és egy compose fájl, ami mindent tartalmaz".

**Amiből indultunk.** A `.docker/` fejlesztésre van szabva: az egész repo bind mountolva, és minden induláskor `bun install` + `prisma generate` + `next build`. Ez idegen gépre nem adható oda — forráskód kell hozzá, és percekbe telik minden restart.

**Ami viszont kedvezett.** A kód mindössze három env-változót olvas (`DATABASE_URL`, `SCAN_DISABLED`, `NODE_ENV`), és **semmit nem ír a fájlrendszerre** — a payload-ellenőrzés is a qBittorrent API-jából dolgozik. Az 52 beállítás a `Setting` táblából jön a `/settings` oldalról, az első admin a `/setup`-on készül. Egy idegen felhasználónak tehát **nulla konfigot** kell fájlban szerkesztenie.

**A döntés: két konténer, nem egy.** Az app és a Postgres külön service ugyanabban a compose fájlban, named volume-mal. A „mindent tartalmaz" a compose fájlra vonatkozik, nem az image-re: a Postgres beépítése egy image-be nagyobb image-t, kézzel megoldandó major upgrade-et és több üzemeltetési kockázatot jelentett volna, az SQLite-ra váltás pedig provider-cserét és mind a 17 migráció újraírását. A Komodo ezt a formát natívan kezeli (Stack), és a `docker compose pull && up -d` marad a frissítés.

**[Dockerfile](Dockerfile), négy fázisban.** `deps` (bun install) → `builder` (`prisma generate` + `next build`) → `migrator` (a Prisma CLI külön telepítve) → `runner` (`node:22-bookworm-slim`). A [next.config.ts](next.config.ts) `output: "standalone"`-ja miatt a futtató image-be nem a 845 MB-os `node_modules` kerül, hanem az, amit a szerver ténylegesen importál. A `runner` **node**, nem bun, és ugyanaz a debian kiadás, amin a build futott: a Prisma engine binárisokat a `bun install` az adott libc-hez és openssl-hez választotta ki.

**Négy dolog derült ki menet közben, mind javítva:**
1. **A `next build` éles módban még sosem futott le.** A dev turbopackkel megy, a build viszont webpackkel: a `pg` a middleware miatt az **edge** bundle-be is bekerült (`instrumentation.ts` → `log.ts` → `prisma.ts` → `@prisma/adapter-pg` → `pg`), és ott nincs `fs`, `net`, `string_decoder`. A kód oda soha nem jut el (`register()` visszatér, ha a runtime nem `nodejs`), de a fordítónak fel kell oldania. Megoldás: `serverExternalPackages: ["pg", "@prisma/adapter-pg"]`, és az edge fordításnál a `pg` semmire aliasolva — builtin-shimek listája helyett, mert azok mind halott súly lettek volna.
2. **A `prisma.config.ts` a `generate`-hez is kéri a `DATABASE_URL`-t**, pedig az nem nyit kapcsolatot — a builder fázisban egy placeholder áll benne, ami nem kerül tovább.
3. **A `bun install` a build sandboxban elhasal** („Fail extracting tarball for next"), miközben sima konténerben ugyanaz lefut — a hardlink backend és az overlay fs nem barátok. `--backend=copyfile`.
4. **A Prisma CLI-t nem lehet fájlonként kimazsolázni**: a `prisma` a `@prisma/dev`-et betöltéskor húzza be, az pedig `valibot`-ot, pglite-ot, hono-t. Ezért kapott saját fázist, ahol npm telepíti a *futtató* image alapjára, az app által pinelt verzióval. Első nekifutásra 977 MB lett az image: a fázisban ott maradt az app `package.json`-je, és az npm mellé telepítette a `next`-et meg a Reactet is. Átnevezve (`version-source.json`) **541 MB**.

**Mérve, friss adatbázison** (`aioseerr:test`, külön compose projekt, 3999-es port, a fejlesztői példány érintése nélkül):

```
migrate deploy    mind a 17 migráció lefutott üres DB-n
next              ✓ Ready in 89ms
scheduler         started, scanning every 15 minutes + a négy „nincs beállítva" figyelmeztetés
healthcheck       healthy
/api/auth/state   200, needsSetup: true
POST /api/auth/setup  {"success":true} → needsSetup: false, ADMIN, session cookie
/api/settings     200 sütivel, 401 anélkül
/_next/static/…   200 (a statikus fájlok a standalone mellől mennek ki)
restart           a migráció no-op, a szerver 18s alatt újra healthy
memória           app 97 MB, postgres 46 MB
```

**A végfelhasználói [docker-compose.yml](docker-compose.yml)** a repo gyökerében: `ghcr.io/gptrk0/aioseerr:latest` + `postgres:17.7` + egy volume. A DB-nek nincs publikált portja, ezért a fix jelszó benne ártalmatlan — ez a fájlban is oda van írva, mert a port megnyitásával megszűnik. A `.docker/` compose változatlanul a fejlesztői stack, a `.env`-ben lévő `COMPOSE_FILE` miatt a `docker compose` itt továbbra is azt találja meg.

**A publikálás** [.github/workflows/image.yml](.github/workflows/image.yml): push `master`-re mozdítja a `latest`-et, egy `v1.2.3` tag pedig `1.2.3` és `1.2` tageket is kirak. `linux/amd64` + `linux/arm64` — az arm QEMU-val emulálva készül, ez a job lassú fele, és kivehető, ha nem kell.

**Frissítés meglévő adatbázison — mérve, nem feltételezve (2026-08-09).** A kérdés az volt, hogy egy már használatban lévő install rendben migrálódik-e az új image-dzsel. Külön Postgresben előállítottam egy „régi" állapotot (séma a `20260809250000_user_webhook`-ig, két felhasználó, library sor, watchlist unit, és a nyelvi beállítások **nem a default értékekkel**: `ger,eng` / `ita,fre` / `ger` / `2500000` / `1`), majd ráindítottam az image-et. Eredmény: az egy hiányzó migráció felment, a konténer `healthy` lett, mindkét user megkapta a *korábbi install* értékeit (nem az oszlop-defaultot), az öt `Setting` sor eltűnt, a `TMDB_API_KEY` és a többi adat érintetlen, a régi library sor `language=""`-t kapott.

Két hiba viszont csak így derült ki, mindkettő javítva:

1. **Egy nem szám érték a `QUALITY_LANGUAGE_BONUS`-ban megölte a migrációt** (`1e6` → `22P02`), a Prisma pedig a migrációt *failed*-nek jelölte, ami onnantól **minden továbbit blokkol**, amíg valaki kézzel fel nem oldja (`P3018`) — vagyis a konténer soha többé nem indul el. A cast most őrzött (`CASE WHEN value ~ '^[0-9]+$'`), az olvashatatlan érték a defaultra esik vissza. Újramérve ugyanazzal az `1e6`-tal: a migráció lefut, a bónusz `1000000` lesz, minden más átjön.
2. **A Prisma nem tudta megállapítani az openssl verziót** a futtató image-ben, és 1.1.x-re esett vissza. Az `openssl` csomag telepítése önmagában viszont **elrontotta**: a migrátor fázis még 1.1.x-hez töltötte le a motort, a futásidő már 3.0.x-et keresett, és az írásvédett `/app`-ba próbálta letölteni — a konténer el sem indult. A csomag ezért **mindkét** fázisba bekerült, így a kettő ugyanazt látja; a figyelmeztetés is eltűnt.

**Ami nyitva marad.** A fájlok rendezése (átnevezés, hardlinkelt könyvtár) még nincs meg; amikor lesz, az app először fog fájlrendszert érinteni, és akkor a compose-ba kell egy médiakönyvtár mount **ugyanazon az útvonalon, ahol a qBittorrent látja** — enélkül a hardlink nem működik. Addig a konténernek nincs mit mountolni.

---

## 5. Javasolt sorrend

A Fázis 1 → 2 → 3 a lényegi új funkció (watchlist → automatikus letöltés), ez adja a legtöbb értéket, ezért ezekkel érdemes kezdeni. A Fázis 4 (keresés) és 5 (discover bővítés) UX-javítás a meglévő böngészésen, ezek függetlenek és bármikor közbeilleszthetők. A Fázis 6 (torrent-kiválasztás) érdemben a Fázis 2 scannerére épül, azzal együtt vagy közvetlenül utána logikus. A Fázis 7-8 folyamatosan/végén.

**Állapot (2026-08-09):** Fázis 1–6 kész, a Fázis 7 üzemeltetési tételei is (lint tiszta, `.gitattributes`, `entrypoint.sh`, letöltési mappák, duplikált `prisma.config.ts`, stall-kezelés, log a felületen). A Fázis 8-ból megvan a **settings UI**, a **Telegram-értesítések** és az **admin log oldal**. Az adatmodellből kikerültek a nem figyelt epizódok sorai (ld. „Csak a figyelt részeknek van sora"), a watchlist és a library pedig két külön táblára és két külön szerepre vált szét, seed-időszakkal (ld. „A watchlist keres, a library birtokol"). Az app **be van zárva**: bejelentkezés, admin/user szerepkör és OpenID Connect (ld. „Bejelentkezés, szerepkörök, Authentik"). Ami maradt: **fájlok rendezése** (a seedelés kérdését a library megválaszolta, az átnevezés/hardlinkelt könyvtár nem), médiaszerver-integráció, és további értesítési csatornák (böngésző push, Discord). Az **éles telepítés** megvan: kiadott image és egy compose fájl (ld. „Éles telepítés: egy image, egy compose").

### Amit legközelebb kézzel meg kell tenni
1. **Push** — a remote megvan (`github.com/gptrk0/aioseerr`), a commitok viszont még mindig egyetlen gépen. Push előtt érdemes megismételni a titok-ellenőrzést, most a teljes történetre. Ez egyben a kiadás feltétele is: a GHCR image az első push után épül meg magától, és amíg nincs image, a végfelhasználói compose fájlnak nincs mit lehúznia.
2. **Indítás**: `docker compose up -d` — a konténer magától felteszi a függőségeket, generálja a Prisma klienst, felviszi a migrációkat, majd elindítja a dev szervert (és vele a schedulert az `instrumentation.ts`-ből). Ez a sor jelzi, hogy megvan: `[scheduler] started, scanning every 15 minutes, reading the client back every 1` — ugyanez a `/log` oldalon is ott van. `entrypoint.sh` módosítása után `--build` kell.
3. **A dry run ki van** (Settings / Scanner), tehát a scanner valódi letöltéseket indíthat. A kézi letöltés ettől függetlenül mindig valódi volt — 2026-08-08-án az *Obsession* így jött le. Kézi kör: `POST /api/scan`, teljes kikapcsolás: `SCAN_DISABLED=1`.
4. **A watchlisten két elem van** (2026-08-08, 21:00): egy `UPCOMING` sorozat és egy `DOWNLOADED` film. Egy scan-kör tehát ma nem keres semmit — az `UPCOMING` epizódjait a megjelenési dátum tartja vissza, és ez így helyes.

---

## 6. Fejlesztői műveletek (jegyzet)

Az adatbázis csak a docker hálózaton belülről érhető el (`DATABASE_HOST=aioseerr_db`), ezért minden Prisma művelet a konténerben fut:

```bash
docker exec -w /home/bun/app aioseerr_app bunx prisma migrate status
docker exec -w /home/bun/app aioseerr_app bunx tsc --noEmit
```

A `prisma migrate dev` **nem használható nem-interaktív shellből** ("Prisma Migrate has detected that the environment is non-interactive") — de a `--create-only` igen, mert az nem kérdez semmit. Ez a rövidebb út, és a `20260808194024_log_entries` így készült:

```bash
# 1. a migráció legenerálása (nem alkalmazza, csak megírja)
docker exec -w /home/bun/app aioseerr_app bunx prisma migrate dev --name <nev> --create-only

# 2. alkalmazás + kliens újragenerálás
docker exec -w /home/bun/app aioseerr_app bunx prisma migrate deploy
docker exec -w /home/bun/app aioseerr_app bunx prisma generate

# 3. ha a migráció a meglévő adat JELENTÉSÉT változtatja: azonnali újraindítás
docker compose restart aioseerr_app
```

A 3. lépés nem formalitás. A schedulert az `instrumentation.ts` indítja a boot-nál, és **az a modulgráf nem esik a hot reload hatálya alá**: a futó szerver a régi függvényeket tartja a memóriájában, amíg a processz él. Egy olyan migráció után, ami átírja, mit jelent a meglévő adat, ez azt jelenti, hogy a **régi szabály fut az új adaton** — 2026-08-09-én pontosan ez indított 65 GB nem kért letöltést (ld. „Csak a figyelt részeknek van sora" / Incidens). Tiszta séma-bővítésnél (új, defaultos oszlop) elég a `generate`.

Ha a `--create-only` mégis elakadna (shadow adatbázis nélküli környezetben), a kézi út:

```bash
# SQL legenerálása az élő DB → új schema diffből
docker exec -w /home/bun/app aioseerr_app bunx prisma migrate diff \
  --from-config-datasource --to-schema prisma/schema.prisma --script

# a kimenet mentése ide: prisma/migrations/<YYYYMMDDHHMMSS>_<nev>/migration.sql, majd deploy + generate
```

**`prisma generate` után a dev szervert újra kell indítani** — a turbopack nem figyeli a `prisma/generated` mappát, így a futó szerver a régi klienst tartja memóriában, és a routeok 500-al elhalnak (a régi kliens még nem is ismeri az új modellt). 2026-08-08 óta viszont **elég a `docker restart aioseerr_app`**: az `entrypoint.sh` minden induláskor generál és migrál, tehát a fenti két lépést nem kell külön kiadni — csak akkor, ha a szervert nem akarod újraindítani.

**Env-változók (2026-08-08 óta mindössze négy).** A `.env` már csak azt tartalmazza, amit a `Setting` tábla elérése *előtt* tudni kell: `APP_ENV`, `APP_PORT`, a `DATABASE_*` (ebből a `DATABASE_URL` áll össze) és a `SCAN_DISABLED`. Minden más beállítás a táblából jön, a defaultja pedig a [settings.ts](src/lib/settings.ts) registryjében van — ott egy helyen látszik mind, a csoportjával, a típusával és a súgójával együtt. Egy kivétellel: a **nyelvi szabályok nincsenek itt**, azok a felhasználó sorában élnek (ld. „Mindenkinek saját nyelve"). A `.env` átírásának **nincs hatása** egyetlen beállításra sem.

<details><summary>A korábbi env-lista (2026-08-08 előtt) — már csak referencia</summary>

`TMDB_API_KEY`, `TMDB_LANGUAGE` (opcionális, default `en-US`), `TMDB_CACHE_TTL_MINUTES` (opcionális, default 720), `DISCOVER_CACHE_TTL_MINUTES` (opcionális, default 60), `DATABASE_URL`, `INDEXER_URL`, `INDEXER_API_KEY`, `INDEXER_IDS` (default `all`, most `ncore,limetorrents,thepiratebay` — a sorrend a prioritás), `INDEXER_PRIORITY`, `INDEXER_PRIORITY_BONUS`, `INDEXER_CAPS_TTL_MINUTES` (opcionális, default 360), `EPISODE_SEARCH_CONCURRENCY` (default 3), `QUALITY_RESOLUTIONS`, `QUALITY_PREFERRED_CODECS`, `QUALITY_CODEC_BONUS`, `QUALITY_EXCLUDE`, `QUALITY_MIN_SEEDERS`, `QUALITY_MAX_SIZE_GB`, `QUALITY_MIN_SIZE_MOVIE`, `QUALITY_MIN_SIZE_EPISODE`, `QUALITY_PREFERRED_LANGUAGES` (default `hun,eng`), `QUALITY_EXCLUDE_LANGUAGES`, `QUALITY_DEFAULT_LANGUAGE` (default `eng`), `QUALITY_LANGUAGE_BONUS` (default 1000000), `QUALITY_LANGUAGE_FIRST` (`1` = nyelv a felbontás előtt), `QUALITY_MAX_PACK_SIZE_PER_EPISODE_GB` (default 5), `TORRENT_URL`, `TORRENT_USER`, `TORRENT_PASS`, `TORRENT_CATEGORY` (default `aioseerr`), `TORRENT_MOVIE_PATH`, `TORRENT_SERIES_PATH` (opcionális save path-ok, üresen a kategória dönt), `TMDB_REGION` (opcionális, a korhatár országa), `WATCHLIST_SCAN_INTERVAL_MINUTES`, `DOWNLOAD_SYNC_INTERVAL_MINUTES` (default 1), `SEARCH_BACKOFF_MINUTES`, `SEARCH_MAX_BACKOFF_HOURS` (default 24), `DOWNLOAD_OPTION_COUNT` (default 5), `DOWNLOAD_PLAN_TTL_MINUTES` (default 15), `SCAN_DRY_RUN`, `SCAN_DISABLED`, `STALL_MINUTES` (default 60), `STALL_DELETE_FILES` (default `1`), `PAYLOAD_DELETE_FILES` (default `1` — a hamis tartalmú torrent fájljai is törlődnek), `PAYLOAD_VIDEO_EXTENSIONS`, `PAYLOAD_ARCHIVE_EXTENSIONS`, `PAYLOAD_EXECUTABLE_EXTENSIONS` (a tartalom-ellenőrzés három listája, vesszős; vezető pont és kisbetű/nagybetű mindegy), `BLOCKED_RELEASE_TTL_DAYS` (default 30 — ennyi idő után kap új esélyt egy elakadás miatt eldobott release; `0` = soha; a hamis tartalmú mindig végleges), `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `TELEGRAM_EVENTS` (`ready,started,dropped` vagy `*`; beállítatlan = nem küld), `TELEGRAM_API_URL` (opcionális, önhosztolt Bot API szerverhez).

</details>

A `MAX_SEARCH_ATTEMPTS` és a `PACK_AFTER_ATTEMPTS` **már nincs a kódban** (2026-08-07 óta).

**Éles műveletek (a kiadott image).** Ott nincs bun és nincs forráskód, a Prisma CLI viszont ott van — a saját `node_modules`-ában, node-dal hívva:

```bash
docker compose pull && docker compose up -d                       # frissítés
docker exec aioseerr node node_modules/prisma/build/index.js migrate status
docker logs -f aioseerr                                           # ugyanaz, ami a /log oldalon
```

Az image kipróbálása push nélkül, a fejlesztői stack érintése nélkül (a `-p` és a port-override miatt nem ütközik vele):

```bash
docker build -t aioseerr:test .
docker compose -p aioseerr-prodtest -f docker-compose.yml -f <(echo 'services: {aioseerr: {image: aioseerr:test, ports: !override ["3999:3000"]}}') up -d
```

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
| [src/lib/stall.ts](src/lib/stall.ts) | az elakadás órája (memóriában, mert egy újraindítás nem számít nála) |
| [src/lib/blocklist.ts](src/lib/blocklist.ts) | az eldobott release-ek feketelistája — `BlockedRelease` tábla + szinkron olvasású memória-cache |
| [src/lib/notify.ts](src/lib/notify.ts) | Telegram-értesítések (`ready` / `started` / `dropped`), sosem dob és sosem lóg |
| [src/lib/language.ts](src/lib/language.ts) | egy ember nyelvi szabályai: a sorrendezett lista, az elsődleges nyelv fogalma, és a defaultok, amikkel egy új fiók indul |
| [src/lib/audience.ts](src/lib/audience.ts) | kinek számít a tiédnek egy letöltés: azonos kiadás, érted letöltött, vagy a kiadások előttről való |
| [src/lib/settings.ts](src/lib/settings.ts) | a beállítások registryje a defaultjaival + a `Setting` tábla szinkron olvasása — az egyetlen hely, ahol egy beállítás értéke eldől |
| [src/lib/log.ts](src/lib/log.ts) | a napló egyetlen belépési pontja: konzol + `LogEntry` tábla, titok-maszkolás, azonos hibák összecsukása, megőrzés, és az az értesítő, amiből az élő stream él |
| [src/app/settings/page.tsx](src/app/settings/page.tsx) | az admin felület: al-tabok, forrás-badge, tag-es listák, visszaállítás defaultra |
| [src/app/log/page.tsx](src/app/log/page.tsx) | a log oldal: szint/forrás/szöveg szűrő, élő követés (SSE), `before=<id>` lapozás |
| [src/app/api/log/stream/route.ts](src/app/api/log/stream/route.ts) | az élő stream: kurzor a táblán, `Last-Event-ID`-vel folytatható, 15 s-os üresjárati tick |
| [src/components/tag-input.tsx](src/components/tag-input.tsx) | vesszős érték tag-ekként: felvesz, töröl, sorrend-érzékenynél húzható |
| [scripts/import-env-settings.ts](scripts/import-env-settings.ts) | egyszeri: a `.env`-ben maradt beállítások átvitele a táblába (a művelet emléke) |
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
| `POST /api/scan` | egy scanner-kör kézi indítása; `{ force: true }` esetén a backoffot hagyja figyelmen kívül (a megjelenési dátumokat **nem**) |
| `GET /api/settings` | a beállítások csoportokkal, érvényes értékkel, forrással (`database` / `default` / `unset`) és a defaultjával; titok értéke sosem jön vissza |
| `PUT /api/settings` | `{ values: { KEY: "..." } }` — csak a változott kulcsokat kell küldeni. Üres érték: **listánál eltárolva** (a szabály kikapcsolva), másnál a sor törlése; üres titok nem változtat semmit; szám típusra a nem-szám 400 |
| `DELETE /api/settings?key=` | vissza a registry defaultjára (default nélküli kulcsnál `unset`) — titoknál ez az egyetlen mód a törlésre |
| `GET /api/log?level&source&q&before` | egy lap napló (200 sor), legújabb elöl, + `hasMore`, a szűrőhöz a tábla forrásai darabszámmal, és a stream indulási pontja (`newestId`, szándékosan szűrés nélkül) |
| `GET /api/log/stream?level&source&q&after` | SSE: `event: entries` egy tömbbel, `id:` mezővel a folytatáshoz; 15 s-onként `: ping` |
| `DELETE /api/log` | a teljes napló törlése — magáról a törlésről ír egy `WARN` sort |
