import { Messages } from "@/i18n";

/**
 * Hungarian. Typed as `Messages`, so this file cannot fall behind English: a key added
 * there and missing here is a build error, not a sentence somebody finds in the wrong
 * language three weeks later.
 *
 * The words follow what a Hungarian user of Overseerr or Sonarr would expect — `release`,
 * `seeder` and `indexer` stay as they are, because that is what they are called in the
 * only conversations these pages take part in.
 */
export const hu: Messages = {
    common: {
        cancel: "Mégse",
        save: "Mentés",
        download: "Letöltés",
        never: "soha",
        justNow: "épp most",
        minutesAgo: "{n} perccel ezelőtt",
        hoursAgo: "{n} órával ezelőtt",
        daysAgo: "{n} nappal ezelőtt",
        movie: "Film",
        series: "Sorozat",
        film: "a film"
    },

    input: {
        pick: "Válassz",
        notOnList: "nincs beállítva — „{value}” nem szerepel a listán",
        notOnListTag: "„{value}” nem szerepel a listán — válassz onnan.",
        search: "Keresés…",
        nothing: "Erre nincs találat.",
        empty: "üres",
        reorder: "Húzással átrendezhető — az első nyer."
    },

    nav: {
        discover: "FELFEDEZÉS",
        all: "Összes",
        movies: "Filmek",
        series: "Sorozatok",
        manualSearch: "Kézi keresés",
        collection: "GYŰJTEMÉNY",
        watchlist: "Figyelőlista",
        library: "Gyűjtemény",
        admin: "ADMIN",
        users: "Felhasználók",
        settings: "Beállítások",
        log: "Napló",
        language: "Nyelv"
    },

    header: {
        searchPlaceholder: "Filmek és sorozatok keresése..."
    },

    theme: {
        toggle: "Téma váltása",
        light: "Világos",
        dark: "Sötét",
        system: "Rendszer"
    },

    userMenu: {
        administrator: "adminisztrátor",
        user: "felhasználó",
        account: "Fiókbeállítások",
        changePassword: "Jelszó módosítása",
        signOut: "Kijelentkezés",
        password: {
            title: "Jelszó módosítása",
            description: "A régi jelszót akkor is kéri, ha be vagy jelentkezve — egy őrizetlenül hagyott böngésző ne legyen elég egy fiók átvételéhez. Minden más böngésző kiléptetésre kerül.",
            current: "A jelenlegi jelszavad",
            next: "Az új, legalább 8 karakter",
            submit: "Módosítás",
            done: "A jelszavad megváltozott — minden más böngésző kiléptetve.",
            failed: "Nem sikerült módosítani."
        }
    },

    auth: {
        sso: "Belépés egyszeri bejelentkezéssel",
        or: "vagy",
        email: "te@example.com",
        password: "Jelszó",
        signIn: "Bejelentkezés",
        noWayIn: "Nincs beállítva egyetlen belépési mód sem. Ezt valakinek adatbázis-hozzáféréssel kell megjavítania.",
        serverSilent: "A szerver nem válaszolt.",
        signInFailed: "A bejelentkezés nem sikerült.",
        setupIntro: "Itt még senkinek nincs fiókja. Az első lesz az adminisztrátor.",
        yourName: "A neved",
        newPassword: "Jelszó, legalább 8 karakter",
        again: "Ugyanaz még egyszer",
        mismatch: "A két jelszó nem egyezik.",
        createAdmin: "Adminisztrátor létrehozása",
        createFailed: "Nem sikerült létrehozni a fiókot."
    },

    adminOnly: {
        note: "Ez az oldal adminisztrátoroknak szól. Kérd meg valamelyiküket, ha változtatni kell valamin."
    },

    language: {
        hun: "Magyar",
        eng: "Angol",
        ita: "Olasz",
        ger: "Német",
        fre: "Francia",
        spa: "Spanyol",
        por: "Portugál",
        rus: "Orosz",
        pol: "Lengyel",
        cze: "Cseh",
        slo: "Szlovák",
        tur: "Török",
        ara: "Arab",
        hin: "Hindi",
        tam: "Tamil",
        tel: "Telugu",
        kor: "Koreai",
        jpn: "Japán",
        chi: "Kínai",
        tha: "Thai",
        vie: "Vietnámi",
        ukr: "Ukrán",
        rum: "Román",
        bul: "Bolgár",
        dut: "Holland",
        swe: "Svéd",
        nor: "Norvég",
        dan: "Dán",
        fin: "Finn",
        gre: "Görög",
        heb: "Héber",
        per: "Perzsa",
        ind: "Indonéz"
    },

    status: {
        PENDING: "Figyelőlistán",
        UPCOMING: "Még nem jelent meg",
        SEARCHING: "Release-re vár",
        DOWNLOADING: "Letöltés alatt",
        DOWNLOADED: "Elérhető",
        FAILED: "Nincs találat"
    },

    discover: {
        setup: {
            title: "Kezdéshez add meg a TMDB API kulcsot",
            body: "Minden poszter, cím és megjelenési dátum a TMDB-től jön, tehát semmit nem lehet listázni, amíg a kulcs nincs a helyén. Ingyenes — regisztrálj a themoviedb.org-on, aztán illeszd be a kulcsot a beállítások oldalon.",
            open: "Beállítások megnyitása"
        },
        empty: "Itt nincs mit megjeleníteni.",
        seeMore: "Több",
        genreLine: "{genre}, a legnépszerűbbek elöl.",
        movies: {
            title: "Filmek",
            description: "Böngészd, mi jelent meg és mi jön."
        },
        series: {
            title: "Sorozatok",
            description: "Böngészd, mi fut és mi következik."
        },
        sections: {
            "trending": { title: "Ma felkapott", description: "Amit most mindenki néz." },
            "trending-movies": { title: "Ma felkapott", description: "Amit most mindenki néz." },
            "trending-series": { title: "Ma felkapott", description: "Amit most mindenki néz." },
            "popular-movies": { title: "Népszerű filmek", description: "A legtöbbet nézett filmek most." },
            "popular-series": { title: "Népszerű sorozatok", description: "A legtöbbet nézett sorozatok most." },
            "upcoming-movies": { title: "Hamarosan", description: "Filmek, amik még nem jelentek meg." },
            "top-rated-movies": { title: "Örök kedvencek", description: "A TMDB legjobbra értékelt filmjei." },
            "top-rated-series": { title: "Örök kedvencek", description: "A TMDB legjobbra értékelt sorozatai." },
            "airing-today": { title: "Ma adásban", description: "Ma érkező epizódok." },
            "on-the-air": { title: "Most fut", description: "Sorozatok, amikhez ezen a héten új rész jön." },
            "downloading": { title: "Most töltődik", description: "Már útban a kliensedhez." },
            "downloaded": { title: "Megnézhető", description: "Befejezett letöltések." },
            "watchlisted": { title: "A figyelőlistádon", description: "Arra vár, hogy megjelenjen egy release." }
        },
        card: {
            stopWatching: "Levétel a figyelőlistáról",
            addToWatchlist: "Figyelőlistára",
            downloadNow: "Letöltés most"
        },
        hero: {
            download: "Letöltés",
            watchlist: "Figyelőlistára",
            remove: "Levétel",
            details: "Részletek"
        }
    },

    search: {
        title: "Keresési találatok",
        matching: "Filmek és sorozatok erre: „{query}”.",
        prompt: "Írj be valamit a fenti keresőbe.",
        nothing: "Nincs találat erre: „{query}”.",
        loadMore: "Több betöltése",
        loading: "Betöltés..."
    },

    releaseSearch: {
        title: "Kézi keresés",
        intro: "Az indexereidet név szerint kérdezi meg, és mindent kilistáz, amit válaszolnak — cím-egyeztetés nélkül, és a minőségi profil sem dönt helyetted. Minden soron ott van, hogy a profilod mit gondol róla, a szűrő gombbal pedig elrejthetők vagy megjeleníthetők azok, amiket eldobott volna. A méretkorlátaid itt egyáltalán nem élnek: azok arról szólnak, mennyi helyet vihet el valami akkor, amikor senki nem figyeli — itt viszont semmi nem felügyelet nélküli. A letöltés ahhoz a címhez kerül, amit a release saját nevéből sikerült beazonosítani — ez a soron látszik, még mielőtt bármit megnyomnál.",
        placeholder: "Release-név vagy a keresett cím…",
        search: "Keresés",
        prompt: "Írj be egy nevet, és keresd meg. Ez közvetlenül az indexereket kérdezi, szóval eltart pár másodpercig.",
        searching: "Keresés az indexereiden erre: „{query}”...",
        found: "{n} release",
        capped: "az első {n} látszik a {total} közül",
        hidden: "{n} elrejtve a minőségi profilod által",
        showingFiltered: "ebből {n} olyan, amit a minőségi profilod eldobott volna",
        allFiltered: "Mind a {n} megtalált release-t eldobta a minőségi profilod — kapcsold ki a szűrőt, és látszanak.",
        nothing: "Az indexereidnek nincs semmi erre: „{query}”.",
        filterOn: "Minőségi profil be",
        filterOff: "Minőségi profil ki",
        filterOnHint: "Csak azok a release-ek, amiket a minőségi profilod elfogadna. Kattints, és minden találat látszik.",
        filterOffHint: "Minden, amit az indexerek válaszoltak, az eldobottakkal együtt — mindegyiken ott az ok. Kattints, és visszatér a minőségi profilod saját listája.",
        seeders: "{n} seeder, {p} peer",
        noImage: "nincs kép",
        inLibrary: "már megvan",
        unknownTitle: "nem beazonosítható, melyik címhez tartozik — innen nem letölthető",
        noEpisodes: "a névben nincs évad vagy epizód, így ez egyetlen részt sem fedne le",
        download: "Letöltés",
        started: "Elindítva",
        searchFailed: "Nem sikerült keresni az indexereken.",
        startFailed: "Nem sikerült elindítani a letöltést.",
        expired: "Ez a keresés lejárt, keresés újra..."
    },

    details: {
        noPoster: "nincs poszter",
        series: "sorozat",
        movie: "film",
        noOverview: "Még nincs leírás.",
        download: "Letöltés",
        downloadEpisodes: "{n} epizód letöltése",
        downloadEpisode: "1 epizód letöltése",
        trailer: "Előzetes",
        stopWatching: "Levétel a listáról",
        cast: "Szereplők",
        links: {
            title: "Linkek",
            website: "Weboldal"
        },
        factsTitle: "Részletek",
        recommendations: "Ajánlott",
        similar: "Ehhez hasonló",
        updateFailed: "Nem sikerült frissíteni a figyelőlistát.",
        seasons: {
            title: "Évadok",
            hint: "Pipáld be, amit szeretnél — egész évadot vagy egyes részeket. A pipa azonnal felveszi a figyelőlistádra, a kivétel leveszi róla."
        },
        facts: {
            status: "Állapot",
            nextEpisode: "Következő rész",
            firstAired: "Első adás",
            released: "Bemutató",
            lastAired: "Utolsó adás",
            episodes: "Epizódok",
            runtime: "Hossz",
            originalTitle: "Eredeti cím",
            originalLanguage: "Eredeti nyelv",
            spokenLanguages: "Beszélt nyelvek",
            network: "Csatorna",
            studio: "Stúdió",
            country: "Ország",
            budget: "Költségvetés",
            revenue: "Bevétel",
            dateUnknown: "ismeretlen dátum",
            seasonCount: "{seasons} évad, {episodes} epizód",
            oneSeason: "1 évad, {episodes} epizód",
            perEpisode: "{n} perc / rész",
            hoursMinutes: "{h} ó {m} p",
            minutes: "{m} p",
            billions: "{n} Mrd $",
            millions: "{n} M $",
            dollars: "{n} $"
        }
    },

    person: {
        born: "Született",
        died: "Elhunyt",
        birthplace: "Születési hely",
        credits: "Munkái",
        creditCount: "{n} cím",
        yearsOld: "{n} éves",
        agedYears: "{n} évesen",
        website: "Weboldal",
        knownFor: "Legismertebb munkái",
        acting: "Színészként",
        otherWork: "Egyéb munkák",
        showAll: "További {n} megjelenítése",
        showLess: "Kevesebb",
        showMoreBio: "Tovább olvasom",
        showLessBio: "Kevesebbet"
    },

    seasonPicker: {
        episodes: "{n} epizód",
        watched: "{n} figyelve",
        downloaded: "{n} letöltve",
        noDate: "még nincs dátum",
        status: {
            SEARCHING: "release-re vár",
            DOWNLOADING: "letöltés alatt",
            DOWNLOADED: "letöltve",
            FAILED: "nincs találat"
        }
    },

    trailerDialog: {
        title: "Előzetes"
    },

    notify: {
        ready: { label: "Megnézhető", help: "egy letöltés befejeződött, meg lehet nézni" },
        started: { label: "Letöltés indult", help: "a scanner elvitt valamit, vagy valaki kézzel kérte" },
        dropped: { label: "Release eldobva", help: "egy letöltés hamisnak vagy halottnak bizonyult, és visszakerült a keresésbe" },
        deleted: { label: "Törölve", help: "egy letöltés elhagyta a gyűjteményt, kézzel vagy mert lejárt az ideje" }
    },

    account: {
        title: "Fiókbeállítások",
        titleFor: "{name} fiókbeállításai",
        backToUsers: "Vissza a felhasználókhoz",
        forSomebodyElse: "Ezek {name} saját beállításai — lent minden „te” őrá vonatkozik. Amit itt átállítasz, azt az app neki fogja csinálni, és ő a saját oldalán bármikor visszaállíthatja.",
        missing: "Nincs ilyen fiók.",
        who: "{email} · {role}",
        name: "Név",
        nameHint: "Ezen a néven szólít a napló és a figyelőlista. Nem lehet üres.",
        webhook: "A webhookod",
        webhookOff: "ki",
        webhookHint: "Egy URL, amit az app meghív, ha valami a tiéddel történik — soha nem mások letöltéseivel. Ha van benne {message}, akkor a behelyettesített szöveggel hívja meg; ha nincs, akkor JSON-t POST-ol rá (content), amit egy Discord webhook vár. A többi behelyettesíthető: {title}, {detail}, {event}. Üresen kikapcsol.",
        events: "Miről szóljunk",
        eventsHint: "Kizárólag a saját letöltéseidről. Ha semmi nincs bepipálva, nem küld semmit — és ugyanez igaz üres webhook esetén.",
        languages: "Nyelvek, amiket szeretnél, a legjobb elöl",
        languagesHintAny: "Bármelyik jó ezek közül, az első előnyben. A második nyelvű release csak akkor kerül elvitelre, ha az elsőn nincs semmi — és amint elvittük, az a te példányod.",
        languagesHintFirst: "Az első az egyetlen nyelv, amit magától letöltünk neked. Ha még nincs ilyen release, a cím a figyelőlistádon marad, és újra keressük — a lista többi része csak akkor kerül felajánlásra, ha kézzel indítasz letöltést, és az elfogadás a te döntésed.",
        languagesHintShared: "Valaki más más nyelvű példánya nem számít a tiédnek: mindenki a saját fájlját kapja.",
        acceptAny: "A listán bármelyik nyelv jó",
        acceptAnyHint: "Kikapcsolva egy cím, ami az első nyelveden nem létezik, soha nem töltődik le — ott ül a figyelőlistádon „release-re vár” állapotban, miközben a release más nyelven megjelent. Ez a biztonságos irány, és ez az alapértelmezés, mert nem szabad a hátad mögött megelégedni egy nyelvvel, amit nem kértél. Bekapcsolva a scanner bármelyiket elviheti, továbbra is az elsőt előnyben részesítve. Egyetlen címre a figyelőlistán van nyelv oszlop.",
        languageFirst: "A nyelv előbbre való a felbontásnál",
        languageFirstHint: "Bekapcsolva, és egy új fiók így indul: a te nyelveden lévő 720p megelőzi az idegen nyelvű 1080p-t. Kikapcsolva a legélesebb példány nyer, és a nyelv csak döntetlent bont — a kettő között nincs beállítás, mert egy nyelv, ami csak „számít valamennyit”, az egy nyelv, ami pár seederrel szemben veszít.",
        excluded: "Nyelvek, amiket sosem kérsz",
        excludedHint: "Csak arra érvényes, amit kézzel indítasz, és soha nem a cím saját eredeti nyelvére — különben egy japán film megszerezhetetlen lenne.",
        pickLanguage: "válassz nyelvet",
        saved: "Mentve.",
        saveFailed: "Ezt nem sikerült elmenteni.",
        providerOnly: "Ez a fiók az identitásszolgáltatón keresztül lép be, és nincs itt jelszava. Egy adminisztrátor tud neki adni.",
        providerOnlyTheirs: "Ez a fiók az identitásszolgáltatón keresztül lép be, és nincs itt jelszava. A felhasználók listájában a „Jelszó beállítása” ad neki egyet."
    },

    // mindkét webhook mezőhöz — a telepítésé a Beállítások / Értesítések alatt, mindenki
    // sajátja a fiókja oldalán —, hogy ugyanaz a gomb ne kapjon kétféle szöveget
    webhook: {
        test: "Teszt",
        testTitle: "Egy üzenet küldése most, arra a címre, ami épp a mezőben van",
        exampleTitle: "Használd ezt kiindulásnak",
        failed: "A webhookot nem sikerült meghívni."
    },

    watchlistToast: {
        added: "{name} felkerült a figyelőlistádra!",
        addFailed: "Nem sikerült felvenni a figyelőlistádra: {name}.",
        removed: "{name} lekerült a figyelőlistádról.",
        removeFailed: "Nem sikerült levenni a figyelőlistádról: {name}.",
        media: "A tartalom",
        mediaLower: "a tartalmat"
    },

    settingsPage: {
        title: "Beállítások",
        intro: "Minden, amit az app olvas, itt van — a környezeti változók csak az adatbázis megtalálására szolgálnak. Amihez nem nyúltál, az a saját alapértékét követi, és nem is tárolódik; a törlés visszaadja azt. A változás a következő keresésnél vagy scan-körnél érvényes, újraindítás nélkül.",
        save: "Mentés",
        saveCount: "{n} változás mentése",
        saveOne: "1 változás mentése",
        saved: "{n} beállítás mentve.",
        savedOne: "1 beállítás mentve.",
        saveFailed: "Nem sikerült elmenteni a beállításokat.",
        readFailed: "Nem sikerült beolvasni a beállításokat.",
        clearConfirm: "Töröljük ezt: {label}? Nincs alapértéke, amire visszaeshetne, tehát újra be kell majd írnod.",
        backToDefault: "{label} visszaállt az alapértékére.",
        cleared: "{label} törölve.",
        clearFailed: "Nem sikerült törölni a beállítást.",
        resetTitle: "Vissza az alapértékre",
        resetTitleValue: "Vissza az alapértékre: {value}",
        clearTitle: "{label} törlése — nincs alapérték, amire visszaesne",
        source: {
            database: "módosítva",
            default: "alapérték",
            unset: "nincs beállítva"
        },
        groups: {
            "TMDB": "TMDB",
            "Indexers": "Indexerek",
            "Torrent client": "Torrent kliens",
            "Library": "Gyűjtemény",
            "Quality": "Minőség",
            "Scanner": "Scanner",
            "Content check": "Tartalom-ellenőrzés",
            "Notifications": "Értesítések",
            "Download dialog": "Letöltési ablak",
            "Access": "Hozzáférés",
            "Log": "Napló"
        },
        indexers: {
            button: "Beolvasás",
            title: "Megkérdezi az indexer-kezelőt, mi van nála beállítva, és abból tölti ki a listát",
            saveFirst: "Előbb mentsd el az URL-t és az API kulcsot — a lista az elmentettekkel olvasódik be.",
            unchanged: "Mind a(z) {n} már bent van a listában.",
            added: "Hozzáadva: {added}. Mentsd el, hogy megmaradjon.",
            addedAndRemoved: "Hozzáadva: {added}. Eltávolítva, mert a kezelőnél már nincs meg: {removed}. Mentsd el, hogy megmaradjon.",
            failed: "Nem sikerült beolvasni az indexer-listát."
        },
        callback: {
            label: "Callback cím a providernek",
            fromPublic: "a lentebbi publikus címből",
            fromRequest: "ennek az oldalnak a címéből olvasva",
            copy: "Másolás",
            copied: "Másolva.",
            copyFailed: "A böngésző nem engedte másolni — jelöld ki a címet kézzel.",
            note: "Engedélyezd ezt a providernél pontosan így — az Authentik és a Keycloak redirect URI-nak hívja, a Google engedélyezett átirányítási URI-nak. Egy provider, amivel ezt nem közölték, a saját oldalán utasítja el a bejelentkezést, mielőtt ez az app bármit hallana róla.",
            guessed: " Most abból a címből van kitalálva, amin ezt az oldalt megnyitottad. Ha egy proxy átírja a hostot, töltsd ki lentebb a publikus címet, és ez azt fogja követni."
        },
        tableHint: "Így írd: 1080p:2 — felbontás és a mérete GB-ban.",
        on: "be",
        off: "ki"
    },

    logPage: {
        title: "Napló",
        intro: "Mit tett az app, amíg senki nem figyelt — minden letöltés, minden eldobott release és minden megváltoztatott beállítás. Az új sorok azonnal megjelennek. A régiek a Beállítások / Log alatti megőrzési idő után eltűnnek.",
        live: "Élő",
        clear: "Törlés",
        levels: {
            all: "Minden",
            info: "Info",
            warn: "Figyelmeztetések",
            error: "Hibák"
        },
        everySource: "Minden forrás",
        searchText: "Keresés a szövegben",
        nothingMatches: "Erre nincs találat.",
        nothingYet: "Még nincs naplózva semmi.",
        loadOlder: "Régebbi bejegyzések",
        readFailed: "Nem sikerült beolvasni a naplót.",
        clearConfirm: "Töröljük az egész naplót? Minden bejegyzés elmegy, azok is, amiket ez az oldal épp nem mutat.",
        cleared: "{n} bejegyzés törölve.",
        clearedOne: "1 bejegyzés törölve.",
        clearFailed: "Nem sikerült törölni a naplót."
    },

    users: {
        title: "Felhasználók",
        intro: "Itt mindenki ugyanazt a figyelőlistát és gyűjteményt használja. A szerepkör azt dönti el, ki módosíthatja a beállításokat, ki olvashatja a naplót, és ki törölhet letöltéseket.",
        add: "Felhasználó hozzáadása",
        columns: {
            who: "Kicsoda",
            role: "Szerepkör",
            signsIn: "Így lép be",
            lastSeen: "Utoljára látva"
        },
        you: "te",
        admin: "Admin",
        user: "Felhasználó",
        off: "ki",
        withPassword: "jelszó",
        withSso: "egyszeri bejelentkezés",
        withNothing: "még semmi",
        accountSettings: "Fiókbeállítások",
        setPassword: "Jelszó beállítása",
        makeUser: "Legyen sima felhasználó",
        makeAdmin: "Legyen adminisztrátor",
        switchOn: "Visszakapcsolás",
        switchOff: "Kikapcsolás",
        delete: "Törlés",
        addTitle: "Felhasználó hozzáadása",
        addNote: "A jelszó nem kötelező. Hagyd üresen annak, aki egyszeri bejelentkezéssel fog megjönni — amikor először belép, ebbe a fiókba fog megérkezni.",
        emailPlaceholder: "o@example.com",
        namePlaceholder: "Név — így fogja hívni a napló",
        passwordPlaceholder: "Jelszó (nem kötelező)",
        administrator: "Adminisztrátor",
        administratorNote: "Beállítások, napló, letöltések törlése.",
        addButton: "Hozzáadás",
        passwordTitle: "Új jelszó ehhez: {email}",
        passwordNote: "Minden böngésző, ami az ő nevében van bejelentkezve, kiléptetésre kerül.",
        passwordNoteProvider: " Hagyd üresen, ha el akarod venni a jelszót, és csak az egyszeri bejelentkezés maradjon.",
        passwordPlaceholderNew: "Legalább 8 karakter",
        deleteTitle: "{email} törlése?",
        deleteNote: "A sessionjei vele mennek. A figyelőlistán és a gyűjteményben semmi nem változik — azok a telepítéshez tartoznak, nem egy emberhez.",
        created: "{email} mostantól be tud jelentkezni.",
        createFailed: "Nem sikerült létrehozni a fiókot.",
        saveFailed: "Ezt nem sikerült elmenteni.",
        roleChanged: "{email} mostantól {role}.",
        roleAdmin: "adminisztrátor",
        roleUser: "felhasználó",
        switchedOff: "{email} ki van kapcsolva és ki van léptetve.",
        switchedOn: "{email} újra be tud jelentkezni.",
        passwordSet: "Új jelszó beállítva ehhez: {email}.",
        deleted: "{email} törölve.",
        deleteFailed: "Nem sikerült törölni a fiókot."
    },

    watchlistPage: {
        titleMine: "A figyelőlistád",
        titleEverybody: "Mindenki figyelőlistája",
        introMine: "Amit neked keresünk. Amint megjelenik egy release, letöltjük, és átkerül a gyűjteménybe — ami közös, akárhányan várták.",
        introEverybody: "Amit itt bárki keres. Amint megjelenik egy release, letöltjük, és átkerül a gyűjteménybe — ami közös, akárhányan várták.",
        mine: "Sajátom",
        everybody: "Mindenki",
        all: "Összes",
        scanNow: "Keresés most",
        scanTitle: "Végigmegy mindenen, amit figyelsz és már megjelent, a következő időpont kivárása nélkül",
        scanning: "keresés...",
        nextScanAny: "következő kör: bármelyik pillanatban",
        nextScanSeconds: "következő kör: {n} s",
        nextScanIn: "következő kör: {time}",
        scanStarted: "Megnézünk minden figyelt tételt az indexereiden...",
        scanDryRun: "{message} A SCAN_DRY_RUN be van kapcsolva, tehát valójában semmi nem töltődött le.",
        scanFailed: "A keresés nem sikerült.",
        emptyMine: "A figyelőlistád üres — vegyél fel valamit egy adatlapról, vagy jobb klikkel egy poszterre.",
        emptyEverybody: "Most senki nem vár semmire.",
        columns: {
            title: "Cím",
            language: "Kért nyelv",
            owner: "Felvette",
            type: "Típus",
            status: "Állapot",
            wanted: "Még kell",
            added: "Hozzáadva",
            lastChecked: "Utolsó ellenőrzés",
            attempts: "Kísérletek"
        },
        auto: "Auto",
        episodesLeft: "{n} epizód",
        outOn: "megjelent: {date}",
        outIn: "megjelenik: {date}, {n} nap múlva",
        outTomorrow: "megjelenik: {date}, 1 nap múlva",
        stopWatchingTitle: "Levétel a listáról — ami már letöltődött, a gyűjteményben marad",
        offList: "{name} lekerült a figyelőlistáról.",
        offListPartly: "{name} részben lekerült a figyelőlistáról.",
        offListFailed: "Nem sikerült levenni a figyelőlistáról: {name}.",
        languageSet: "{name} keresése ezen a nyelven fog menni: {language}.",
        languageAuto: "{name} újra a fiókodat követi — {languages}.",
        languageFailed: "Nem sikerült nyelvet váltani ehhez: {name}.",
        ownerTooltip: "Kinek kell. Ha átadod a sort, minden vele megy, ami még hiányzik belőle — és onnantól azon a nyelven keressük, amit az új tulajdonos fiókja kér.",
        ownerSet: "{name} mostantól {user} figyelőlistáján van.",
        ownerTaken: "{user} figyelőlistáján már szerepel: {name}, két listát pedig nem lehet eggyé olvasztani.",
        ownerFailed: "Nem sikerült átadni: {name}."
    },

    libraryPage: {
        title: "Gyűjtemény",
        intro: "Minden, ami a háznak megvan, és minden, ami útban van, címenként egy sorban — nyisd ki, és látszanak a letöltések, amikből összeáll. A befejezett letöltés egy ideig seedel, mielőtt törölhetővé válik, aztán magától elmegy — a fájljaival együtt —, amint lejár a „Megőrzés\" oszlopban álló idő. Egy film vagy egyetlen epizód alapból 7 napig marad, egy évadpack pedig a benne lévő epizódonként 3 napig; bármelyik sornak adható saját érték.",
        empty: "Még nincs itt semmi — amit az app letölt, ebben a listában jelenik meg.",
        filters: {
            all: "Összes",
            downloading: "Letöltés alatt",
            available: "Megnézhető"
        },
        columns: {
            title: "Cím",
            release: "Release",
            language: "Nyelv",
            watchers: "Kérte",
            size: "Méret",
            status: "Állapot",
            seed: "Seedelés",
            keep: "Megőrzés",
            added: "Hozzáadva"
        },
        noImage: "nincs kép",
        ready: "Megnézhető",
        downloading: "Letöltés alatt",
        notInClient: "nincs a kliensben",
        // a cím sora az, ami a háznak megvan belőle; a letöltések, amikből összeáll, benne vannak
        episodesCovered: "{n} epizód",
        downloadCount: "{n} letöltés",
        editionCount: "{n} kiadás",
        readyOf: "{done}/{total} kész",
        markedCount: "{n} törlésre jelölve",
        firstDeletedIn: "az első {time} múlva megy",
        showDownloads: "Letöltések mutatása",
        hideDownloads: "Letöltések elrejtése",
        kbPerSecond: "{n} kB/s",
        mbPerSecond: "{n} MB/s",
        minutesLeft: "{n} perc",
        hoursLeft: "{n} óra",
        timeLeft: "{time} van hátra",
        hours: "{n} ó",
        days: "{n} nap",
        freeToDelete: "törölhető",
        goesWhenUp: "megy, amint lejár",
        deletingNow: "törlés...",
        deletedIn: "törlés {time} múlva",
        deletedNow: "törlés bármelyik pillanatban",
        seedTooltip: "A qBittorrent saját seed-ideje alapján — egy szüneteltetett torrent nem teljesíti.",
        retentionTooltip: "A befejezés után {n} napig marad, és a fájlok is mennek vele. A seed-idő letelte előtt semmi nem törlődik.",
        marked: "megjelölve",
        keepTitle: "Mégis maradjon",
        markTitle: "Még seedel — megjelölés törlésre",
        deleteTitle: "Törlés",
        markQuestion: "{name} megjelölése törlésre?",
        deleteQuestion: "{name} törlése?",
        thisOne: "ez",
        seedingNote: "Ez még {time} seedel. Addig marad, és magától elmegy — a fájljaival együtt —, amint lejár az idő.",
        deleteNote: "A torrent és a fájljai is törlődnek a qBittorrentből, és nem fog újra letöltődni. Ez nem vonható vissza.",
        markConfirm: "Megjelölés törlésre",
        deleteConfirm: "Törlés a fájlokkal",
        watchersNobody: "senki",
        watchersTooltip: "Ki kérte — kattints az átírásához. Ők kapnak róla értesítést, és az ő figyelőlistájukra kerül vissza, ha a letöltés nem sikerül.",
        watchersTooltipNobody: "Senki nincs feltüntetve kérőként, így senki nem kap róla értesítést, és hiba esetén sem kerül vissza egyetlen figyelőlistára sem. Kattints, és add meg, kinek kellett.",
        watchersQuestion: "Ki kérte ezt: {name}?",
        watchersNote: "Ők kapnak értesítést, amikor megjön vagy elmegy, az ő figyelőlistájukra kerül vissza, ha a letöltés nem sikerül, és az ő főoldalukon jelenik meg. Az app abból állítja össze, hogy ki várta akkor — a kézzel indított letöltés pedig azé, aki megnyomta a gombot, szóval itt igazítható, amit ez nem tudott.",
        watchersToast: "{name} kérője mostantól: {users}.",
        watchersNoneToast: "{name} mostantól senki kérése.",
        keepDaysValue: "{n} nap",
        keepTooltip: "Meddig marad a befejezés után. Magára hagyva ez {n} nap — kattints, ha átírnád.",
        keepQuestion: "Meddig maradjon ez: {name}?",
        keepNote: "A befejezés pillanatától számol, és a fájlok is mennek vele, amikor letelik. {min} és {max} nap között — az alsó határ a seed-idő (Beállítások / Library).",
        keepDefaultButton: "Alapérték ({n} nap)",
        dayUnit: "nap",
        keepToast: "{name} {n} napig marad.",
        keepDefaultToast: "{name} visszaállt az alapértékére: {n} nap.",
        markedToast: "{name} és a fájljai törlődnek, amint lejár a seed-ideje.",
        stayingToast: "{name} marad.",
        updateFailed: "Nem sikerült frissíteni: {name}.",
        deletedToast: "{name} és a fájljai törölve.",
        deleteFailed: "Nem sikerült törölni: {name}."
    },

    download: {
        titleDownload: "{name} letöltése",
        titleHave: "{name} már megvan",
        titleNothing: "Nincs elérhető release: {name}",
        searching: "Keresés az indexereiden...",
        pickHint: "Válassz release-t minden sorhoz. Az első az, amit a minőségi profilod magától elvitt volna.",
        haveAll: "{lines} — már letöltve ({languages}), tehát nincs mit hozni.",
        notFound: "Most nincs meg az indexereiden, és semmi nem került fel sehova. Ha szeretnéd, hogy elhozzuk, amint megjelenik, jelöld be lentebb.",
        notFoundFiltered: "Most nincs meg az indexereiden — {n} találatot kiszűrt a minőségi profilod —, és semmi nem került fel sehova. Megnézheted magad azokat a release-eket, vagy megkérheted, hogy figyeljük.",
        showMore: "További {n} találat, amit a profil kihagyott — megjelenítés",
        hideMore: "Ezek elrejtése",
        filtered: "Ebből {n} darabot a minőségi profilod dobott el — az okot a soron írja.",
        filteredOne: "Ebből 1 darabot a minőségi profilod dobott el — az okot a soron írja.",
        rejection: {
            noLink: "nincs mit letölteni",
            blocked: "egyszer már megpróbáltuk, eldobva",
            seeders: "túl kevés seeder",
            tooBig: "átmegy a méretkorláton",
            excluded: "kizárt kulcsszó",
            mismatch: "nem úgy tűnik, hogy ez a cím",
            language: "nem a kért nyelven van",
            resolution: "nem kért felbontás",
            tooSmall: "túl kicsi ehhez a felbontáshoz"
        },
        releases: "{n} release",
        bestMatch: "legjobb találat",
        pack: "csomag",
        duplicate: "Ez már megvan ({lines}), ezen a nyelven: {languages}. Az újbóli letöltés egy második példányt jelent a lemezen — megéri, ha a mostani rossz rip, egyébként kidobott hely.",
        duplicateAccept: "Tudom, töltsük le újra.",
        wrongLanguage: "Nincs {languages} nyelvű release ehhez: {lines}. Magára hagyva ez a figyelőlistádon várna, amíg megjelenik a te nyelveden — a letöltés most azt jelenti, hogy más nyelven nézed meg.",
        wrongLanguageAccept: "Rendben, töltsük le így.",
        watchMissing: "Nincs találat ehhez: {lines}. Vedd fel a figyelőlistámra, és töltsd le, amint megjelenik.",
        watchNothing: "Vedd fel a figyelőlistámra, és töltsd le, amint megjelenik.",
        close: "Bezárás",
        manualSearch: "Kézi keresés",
        manualSearchFiltered: "Mutasd a {n} kiszűrt release-t",
        addToWatchlist: "Figyelőlistára",
        confirm: "Letöltés",
        confirmMany: "{n} elem letöltése",
        searchFailed: "Nem sikerült keresni az indexereken.",
        startFailed: "Nem sikerült elindítani a letöltést.",
        expired: "A keresési eredmények lejártak, keresés újra...",
        watchRest: "{name} a figyelőlistádon van, a hiányzó részek követni fogják.",
        episodes: {
            title: "Mit töltsünk le ebből: {name}?",
            description: "Pipáld be az epizódokat, és pontosan azokra keresünk release-t. Ez itt nem írja a figyelőlistádat — ami már rajta van, bepipálva jelenik meg.",
            empty: "A TMDB még nem sorol fel epizódot ehhez, tehát nincs mit választani — ha felveszed a figyelőlistádra, keresni fogjuk, amint bejelentenek egyet.",
            pick: "Válassz epizódot",
            search: "{n} epizód keresése",
            searchOne: "1 epizód keresése",
            loadFailed: "Nem sikerült beolvasni az epizódlistát."
        }
    }
};
