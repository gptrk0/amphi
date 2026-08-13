import { Locale, TranslateOr } from "@/i18n";

/**
 * The settings page, in Hungarian.
 *
 * **Why this is not in the dictionary.** The English label and help text of every setting
 * live in the registry (`src/lib/settings.ts`), next to the default and the type, because
 * that is the one place that knows what a setting *is*. Copying all of it into `en.ts` to
 * satisfy the "every language has every key" rule would mean two English texts to keep in
 * step, and the one that drifted would be the one nobody was reading.
 *
 * So: the api still sends the registry's English, and this file translates it. A key that
 * is missing here shows up in English rather than as a broken sentence, which is the right
 * failure for a page only administrators see.
 */

type Text = { label: string, help?: string, placeholder?: string };

const HU: Record<string, Text> = {
    TMDB_API_KEY: {
        label: "API kulcs",
        help: "Minden, ami a felfedező oldalakon van, a TMDB-től jön, tehát ez az egyetlen beállítás, ami nélkül az app nem tud elindulni a munkával."
    },
    TMDB_CACHE_TTL_MINUTES: { label: "Metaadat-gyorsítótár (perc)" },
    DISCOVER_CACHE_TTL_MINUTES: {
        label: "Felfedező-sorok gyorsítótára (perc)",
        help: "A trendek gyorsabban mozognak, mint a metaadatok, ezért külön, rövidebb gyorsítótárat kapnak."
    },
    INDEXER_URL: { label: "Jackett / Prowlarr URL" },
    INDEXER_API_KEY: { label: "API kulcs" },
    INDEXER_IDS: {
        label: "Indexerek",
        placeholder: "indexer id",
        help: "Egyenként kerülnek megkérdezésre, képesség szerint, és a sorrend egyben a prioritás is. Az `all` a Jackett összesített végpontját használja, ami csendben kihagy minden indexert, ami nem tud imdb id szerint keresni — jobb megnevezni őket."
    },
    INDEXER_PRIORITY: {
        label: "Prioritási sorrend",
        help: "Csak akkor, ha másnak kell lennie, mint a fenti sorrend. Azonos felbontáson és nyelven az előbb álló indexer **mindig** nyer, akárhány seedere van a másiknak — ez a megnevezett sorrend jelentése. Ha a preferáltnál nincs elfogadható release, a következő indexeré kerül elvitelre."
    },
    INDEXER_CAPS_TTL_MINUTES: { label: "Képesség-gyorsítótár (perc)" },
    TORRENT_URL: { label: "qBittorrent URL" },
    TORRENT_USER: { label: "Felhasználó" },
    TORRENT_PASS: { label: "Jelszó" },
    TORRENT_CATEGORY: {
        label: "Kategória",
        help: "Minden, amit ez az app kezel, ezt viseli, és semmihez nem nyúl, ami ezen kívül van."
    },
    TORRENT_MOVIE_PATH: {
        label: "Filmek mentési útvonala",
        help: "Ahogy a qBittorrent látja. Üresen a célt a kategória dönti el."
    },
    TORRENT_SERIES_PATH: { label: "Sorozatok mentési útvonala" },
    LIBRARY_SEED_DAYS: {
        label: "Seedelés (nap)",
        help: "A qBittorrent saját seed-ideje alapján, nem attól, hogy mikor érkezett meg a letöltés: egy szüneteltetett torrent nem tölti az idejét, és amelyik már ez előtt is seedelt, annak nem kell kétszer letöltenie. Amíg le nem telik, semmi nem törlődik — sem kézzel, sem a megőrzési idő lejártával: a letöltés csak megjelölhető, és magától elmegy, amikor eljön az idő. Ez egyben a legrövidebb megőrzési idő is, amit a gyűjtemény elfogad. A torrent utána is seedel, amíg nem törlöd. A 0 azt jelenti, hogy minden azonnal törölhető."
    },
    QUALITY_RESOLUTIONS: {
        label: "Felbontások, a legjobb elöl",
        help: "Ami nincs a listán, az elutasításra kerül. Egy ismeretlen felbontás utolsó mentsvárként megmarad."
    },
    QUALITY_PREFERRED_CODECS: {
        label: "Preferált kodekek",
        help: "A h264 mindenen elmegy; a hevc és az av1 a tartalék."
    },
    QUALITY_CODEC_BONUS: {
        label: "Kodek-bónusz",
        help: "Ennyi seedert ér — ez a szám teljes jelentése, és pontosan ezért ez az egyetlen súly, ami megmaradt a pontozásban. Soha nem nyúl túl a seeder-számon a felbontásba, a nyelvbe vagy az indexer-sorrendbe."
    },
    QUALITY_MIN_SEEDERS: { label: "Minimum seeder" },
    QUALITY_MAX_SIZE_GB: { label: "Maximális méret (GB)", help: "0 = nincs korlát." },
    QUALITY_MAX_PACK_SIZE_PER_EPISODE_GB: {
        label: "Évadcsomag felső korlátja epizódonként (GB)",
        help: "Egy 2160p-s csomag 89–189 GB is lehet, erre való ez."
    },
    QUALITY_EXCLUDE: {
        label: "Kizáró kulcsszavak",
        help: "Szóhatáron illesztve, tehát a „ts” nem talál bele véletlen szavakba."
    },
    QUALITY_MIN_SIZE_MOVIE: {
        label: "Minimális film-méret felbontásonként",
        help: "Egy fájl, ami ennyivel kisebb, mint a bemondott felbontása, nem az a videó. GB-ban, bejegyzésenként."
    },
    QUALITY_MIN_SIZE_EPISODE: { label: "Minimális epizód-méret felbontásonként" },
    WATCHLIST_SCAN_INTERVAL_MINUTES: { label: "Keresés ennyi percenként" },
    DOWNLOAD_SYNC_INTERVAL_MINUTES: { label: "A kliens visszaolvasása ennyi percenként" },
    SEARCH_BACKOFF_MINUTES: {
        label: "Első várakozás üres keresés után (perc)",
        help: "Minden eredménytelen kereséssel duplázódik. Semmiről nem mondunk le végleg."
    },
    SEARCH_MAX_BACKOFF_HOURS: { label: "Leghosszabb várakozás (óra)" },
    EPISODE_SEARCH_CONCURRENCY: { label: "Párhuzamos epizód-keresések" },
    SCAN_DRY_RUN: {
        label: "Próbafutás",
        help: "Bekapcsolva a scanner csak naplózza, mit vitt volna el. A kézi letöltés mindig valódi."
    },
    PAYLOAD_VIDEO_EXTENSIONS: {
        label: "Videó-kiterjesztések",
        help: "Ha kiürítesz, a szabály kikapcsol — nem jelentheti azt, hogy „semmi nem videó”, mert az minden torrentet törölne. A `*` mindent elfogad."
    },
    PAYLOAD_ARCHIVE_EXTENSIONS: {
        label: "Archív kiterjesztések",
        help: "Egy archivált release-t nem lehet fájllistából megítélni, ezért soha nem minősül hibásnak. Az .r00–.r99 a „rar” után jön."
    },
    PAYLOAD_EXECUTABLE_EXTENSIONS: {
        label: "Futtatható kiterjesztések",
        help: "Ha a legnagyobb fájl ezek közül való, a torrent nem az, aminek a neve mondja."
    },
    PAYLOAD_DELETE_FILES: { label: "Hamis release fájljainak törlése" },
    STALL_MINUTES: {
        label: "Feladás egy helyben állás után (perc)",
        help: "Bármilyen haladás újraindítja az órát, tehát egy lassú letöltés biztonságban van."
    },
    STALL_DELETE_FILES: { label: "Beragadt release fájljainak törlése" },
    BLOCKED_RELEASE_TTL_DAYS: {
        label: "Beragadt release újrapróbálása (nap)",
        help: "0 = soha. Egy hamis tartalom ettől függetlenül végleg tiltásra kerül."
    },
    TELEGRAM_BOT_TOKEN: { label: "Telegram bot token", help: "A @BotFather-től." },
    TELEGRAM_CHAT_ID: {
        label: "Chat id",
        help: "Írj egyszer a botnak, aztán olvasd ki a /getUpdates-ből. Csoportnál negatív, és megváltozik, ha a Telegram szupercsoporttá alakítja a csoportot."
    },
    TELEGRAM_EVENTS: {
        label: "Küldendő események",
        help: "Ez a chat a telepítésé, ezért minden üzenet megmondja, kinek a letöltéséről volt szó. Ha semmi nincs bepipálva, nem küld semmit."
    },
    TELEGRAM_API_URL: { label: "Bot API URL", help: "Csak saját üzemeltetésű Bot API szerverhez." },
    NOTIFY_WEBHOOK_ALLOW_PRIVATE: {
        label: "Hálózaton belüli webhookok engedélyezése",
        help: "Itt mindenki beállíthat magának saját webhookot, és a szerver az, ami meghívja — ezért alapból elutasítja azokat a címeket, amiket csak a szerver ér el (localhost, 10.x, 192.168.x). Csak akkor kapcsold be, ha valakinek tényleg ugyanezen a hálózaton van a fogadója."
    },
    DOWNLOAD_OPTION_COUNT: { label: "Felajánlott release-ek száma" },
    DOWNLOAD_PLAN_TTL_MINUTES: {
        label: "Keresési eredmény megőrzése (perc)",
        help: "Meddig tartjuk meg a nyitott ablak mögötti keresést, hogy a válasz ne indítson újat."
    },
    AUTH_SESSION_DAYS: {
        label: "Bejelentkezve marad (nap)",
        help: "Az utolsó kéréstől számolva, nem a bejelentkezéstől, tehát akit használ az appot, azt sosem dobja ki. 0 = soha nem jár le, amíg valaki nem lép ki vagy a fiókot nem kapcsolják ki. A csökkentés a már megnyitott sessionöket is eléri."
    },
    AUTH_ALLOW_PASSWORD: {
        label: "Jelszavas űrlap engedélyezése",
        help: "Kikapcsolva csak az egyszeri bejelentkezés marad — és figyelmen kívül marad, amíg nincs provider beállítva, tehát ez nem az a beállítás, ami kizárhat téged."
    },
    AUTH_PUBLIC_URL: {
        label: "Az app publikus címe",
        help: "Csak egyszeri bejelentkezéshez kell, olyan proxy mögött, ami nem küld X-Forwarded-Host fejlécet: ebből épül a providertől visszatérő átirányítás. A fül tetején lévő callback cím ezt követi."
    },
    AUTH_OIDC_ENABLED: {
        label: "Egyszeri bejelentkezés",
        help: "OpenID Connect — Authentik, Authelia, Keycloak, Google. A providert megkérdezzük a végpontjairól, tehát a lentebbi issuer minden, amire szükség van. Mindig az `openid profile email` scope-okat kéri, a regisztrálandó callback cím pedig a fül tetején van."
    },
    AUTH_OIDC_ISSUER: {
        label: "Issuer URL",
        help: "Az Authentik kiírja a provider oldalán. Minden mást a .well-known/openid-configuration-ból olvasunk."
    },
    AUTH_OIDC_CLIENT_ID: { label: "Kliens azonosító" },
    AUTH_OIDC_CLIENT_SECRET: {
        label: "Kliens titok",
        help: "Publikus kliensnél hagyd üresen — a folyamat mindkét esetben PKCE-t használ."
    },
    AUTH_OIDC_AUTO_CREATE: {
        label: "Fiók létrehozása az első belépésnél",
        help: "Bekapcsolva: akit a provider átenged, itt fiókot kap, sima felhasználóként. Kikapcsolva: csak az léphet be, aki már szerepel a felhasználók oldalon."
    },
    AUTH_OIDC_ADMIN_GROUPS: {
        label: "Csoportok, amik adminná tesznek",
        help: "Amíg ez ki van töltve, a provider dönti el minden általa beléptetett fiók szerepkörét — a csoportból való kikerülés visszaveszi az admint. A tagságot a `groups`, a `roles` és a `realm_access.roles` claim közül abból olvassuk, amit a providered küld. Az utolsó admint soha nem tudja elvenni, tehát egy elgépelés itt nem zárhat ki."
    },
    LOG_RETENTION_DAYS: {
        label: "Bejegyzések megőrzése (nap)",
        help: "0 = minden megmarad. Óránként egyszer, egy írás után kerül ellenőrzésre."
    },
    LOG_DEBUG: {
        label: "Debug bejegyzések megtartása",
        help: "Minden indexer-keresés és minden előnézet, ami sok sor — érdemes bekapcsolni, amíg valaminek a nyomában vagy."
    }
};

const DICTIONARIES: Partial<Record<Locale, Record<string, Text>>> = { hu: HU };

const own = (locale: Locale, key: string) => DICTIONARIES[locale]?.[key];

/** The registry's English is the fallback, and it is what the api already sent. */
export const settingLabel = (locale: Locale, key: string, english: string) => own(locale, key)?.label || english;

export const settingHelp = (locale: Locale, key: string, english: string) => own(locale, key)?.help || english;

export const settingPlaceholder = (locale: Locale, key: string, english: string) => {
    return own(locale, key)?.placeholder || english;
};

/** A group heading is in the dictionary, because the group names are a short closed set. */
export const settingGroup = (group: string, tOr: TranslateOr) => tOr(`settingsPage.groups.${ group }`, group);
