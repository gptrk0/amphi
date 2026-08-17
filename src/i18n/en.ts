/**
 * English, and the shape every other language is checked against. Adding a key here and
 * nowhere else does not compile — see `src/i18n/index.ts`.
 *
 * Grouped by where the words are, not by what they mean: finding the one string on the
 * screen in front of you is the thing this file is asked for a hundred times, and
 * "somewhere under common" is not an answer.
 */
export const en = {
    common: {
        cancel: "Cancel",
        save: "Save",
        download: "Download",
        never: "never",
        justNow: "just now",
        minutesAgo: "{n}m ago",
        hoursAgo: "{n}h ago",
        daysAgo: "{n}d ago",
        movie: "Movie",
        series: "Series",
        film: "the film"
    },

    // the two closed-set inputs. Their labels say what the field is, so these say nothing
    // about *what* is being picked — a noun that has to be declined for every sentence it
    // appears in is a sentence that cannot be translated
    input: {
        pick: "Pick one",
        notOnList: "not set — \"{value}\" is not on the list",
        notOnListTag: "\"{value}\" is not on the list — pick one from it.",
        search: "Search…",
        nothing: "Nothing matches that.",
        empty: "empty",
        reorder: "Drag to reorder — the first one wins."
    },

    nav: {
        discover: "DISCOVER",
        all: "All",
        movies: "Movies",
        series: "Series",
        manualSearch: "Manual search",
        collection: "LIBRARY",
        watchlist: "Watchlist",
        library: "Library",
        admin: "ADMIN",
        users: "Users",
        settings: "Settings",
        log: "Log",
        language: "Language"
    },

    header: {
        searchPlaceholder: "Search for movies and shows..."
    },

    theme: {
        toggle: "Toggle theme",
        light: "Light",
        dark: "Dark",
        system: "System"
    },

    userMenu: {
        administrator: "administrator",
        user: "user",
        account: "Account settings",
        changePassword: "Change password",
        signOut: "Sign out",
        password: {
            title: "Change your password",
            description: "The old one is asked for even though you are signed in — an unattended browser should not be enough to take an account over. Every other browser is signed out.",
            current: "Your current password",
            next: "The new one, at least 8 characters",
            submit: "Change it",
            done: "Your password is changed — every other browser was signed out.",
            failed: "Could not change it."
        }
    },

    auth: {
        sso: "Continue with single sign-on",
        or: "or",
        email: "you@example.com",
        password: "Password",
        signIn: "Sign in",
        noWayIn: "There is no way to sign in configured. Somebody with access to the database has to fix that.",
        serverSilent: "The server did not answer.",
        signInFailed: "Signing in failed.",
        setupIntro: "Nobody has an account here yet. The first one is the administrator.",
        yourName: "Your name",
        newPassword: "Password, at least 8 characters",
        again: "The same again",
        mismatch: "The two passwords are not the same.",
        createAdmin: "Create the administrator",
        createFailed: "Could not create the account."
    },

    adminOnly: {
        note: "This page is for administrators. Ask one of them if you need something changed."
    },

    // the catalogue's own names, so a language list reads in the language of the page.
    // The English name stays searchable in the dropdown either way — typing "hungarian"
    // finds it on a Hungarian page too
    language: {
        hun: "Hungarian",
        eng: "English",
        ita: "Italian",
        ger: "German",
        fre: "French",
        spa: "Spanish",
        por: "Portuguese",
        rus: "Russian",
        pol: "Polish",
        cze: "Czech",
        slo: "Slovak",
        tur: "Turkish",
        ara: "Arabic",
        hin: "Hindi",
        tam: "Tamil",
        tel: "Telugu",
        kor: "Korean",
        jpn: "Japanese",
        chi: "Chinese",
        tha: "Thai",
        vie: "Vietnamese",
        ukr: "Ukrainian",
        rum: "Romanian",
        bul: "Bulgarian",
        dut: "Dutch",
        swe: "Swedish",
        nor: "Norwegian",
        dan: "Danish",
        fin: "Finnish",
        gre: "Greek",
        heb: "Hebrew",
        per: "Persian",
        ind: "Indonesian"
    },

    status: {
        PENDING: "Watchlisted",
        UPCOMING: "Not out yet",
        SEARCHING: "Waiting for release",
        DOWNLOADING: "Downloading",
        DOWNLOADED: "Available",
        FAILED: "Not found"
    },

    discover: {
        setup: {
            title: "Add a TMDB API key to get started",
            body: "Every poster, title and release date comes from TMDB, so nothing can be listed until the key is in. It is free — sign up at themoviedb.org, then paste the key on the settings page.",
            open: "Open settings"
        },
        empty: "Nothing to show here.",
        seeMore: "See more",
        genreLine: "{genre}, most popular first.",
        movies: {
            title: "Movies",
            description: "Browse what is out and what is coming."
        },
        series: {
            title: "Series",
            description: "Browse what is on and what is next."
        },
        // by section key, which is why those keys are unique across the views — the server
        // still sends its own English title as the fallback for a key added later
        sections: {
            "trending": { title: "Trending today", description: "What everyone is watching right now." },
            "trending-movies": { title: "Trending today", description: "What everyone is watching right now." },
            "trending-series": { title: "Trending today", description: "What everyone is watching right now." },
            "popular-movies": { title: "Popular movies", description: "Most watched films at the moment." },
            "popular-series": { title: "Popular series", description: "Most watched shows at the moment." },
            "upcoming-movies": { title: "Coming soon", description: "Films that are not out yet." },
            "top-rated-movies": { title: "All time favourites", description: "The highest rated films on TMDB." },
            "top-rated-series": { title: "All time favourites", description: "The highest rated shows on TMDB." },
            "airing-today": { title: "Airing today", description: "Episodes landing today." },
            "on-the-air": { title: "On the air", description: "Shows with new episodes this week." },
            "downloading": { title: "Downloading now", description: "Already on the way to your client." },
            "downloaded": { title: "Ready to watch", description: "Finished downloads." },
            "watchlisted": { title: "On your watchlist", description: "Waiting for a release to show up." }
        },
        card: {
            stopWatching: "Stop watching",
            addToWatchlist: "Add to watchlist",
            downloadNow: "Download now"
        },
        hero: {
            download: "Download",
            watchlist: "Watchlist",
            remove: "Remove",
            details: "Details"
        }
    },

    search: {
        title: "Search results",
        matching: "Movies and shows matching \"{query}\".",
        prompt: "Type something into the search bar above.",
        nothing: "Nothing found for \"{query}\".",
        loadMore: "Load more",
        loading: "Loading..."
    },

    // the manual search page: the indexers asked by name, with the quality profile as a
    // button rather than a rule
    releaseSearch: {
        title: "Manual search",
        intro: "Your indexers asked for a name, and every release they answer with — no title matching, no quality profile deciding for you. Each row says what your profile thinks of it, and the filter button hides or shows the ones it would have refused. Your size limits do not apply here at all: those are about how much disk something may take while nobody is watching, and nothing here is unattended. Downloading a release files it under the title its own name resolves to, which is on the row before you press anything.",
        placeholder: "A release name, or the title you are after…",
        search: "Search",
        prompt: "Type a name and search. This asks the indexers directly, so it takes a few seconds.",
        searching: "Searching your indexers for \"{query}\"...",
        found: "{n} releases",
        capped: "showing the first {n} of {total}",
        hidden: "{n} hidden by your quality profile",
        showingFiltered: "{n} of these your quality profile would have refused",
        allFiltered: "Every one of the {n} releases found was refused by your quality profile — turn the filter off to see them.",
        nothing: "Your indexers have nothing for \"{query}\".",
        // the two states of the one button this page is about
        filterOn: "Quality profile on",
        filterOff: "Quality profile off",
        filterOnHint: "Only the releases your quality profile would accept. Click to see everything that was found.",
        filterOffHint: "Everything the indexers answered with, refused ones included — each says why. Click to go back to your quality profile's own list.",
        seeders: "{n} seeders, {p} peers",
        noImage: "no img",
        inLibrary: "already yours",
        unknownTitle: "no telling which title this is — it cannot be downloaded from here",
        noEpisodes: "the name says no season or episode, so this would cover none",
        download: "Download",
        started: "Started",
        searchFailed: "Could not search the indexers.",
        startFailed: "Could not start the download.",
        expired: "This search expired, searching again..."
    },

    details: {
        noPoster: "no poster",
        series: "series",
        movie: "movie",
        noOverview: "No overview yet.",
        download: "Download",
        downloadEpisodes: "Download {n} episodes",
        downloadEpisode: "Download 1 episode",
        trailer: "Trailer",
        stopWatching: "Stop watching",
        cast: "Cast",
        // its own section above the facts, not a line inside them
        links: {
            title: "Links",
            website: "Website"
        },
        factsTitle: "Details",
        recommendations: "Recommendations",
        similar: "More like this",
        updateFailed: "Could not update the watchlist.",
        seasons: {
            title: "Seasons",
            hint: "Tick what you want — a whole season or single episodes. Ticking puts it on your watchlist right away, unticking takes it off."
        },
        facts: {
            status: "Status",
            nextEpisode: "Next episode",
            firstAired: "First aired",
            released: "Released",
            lastAired: "Last aired",
            episodes: "Episodes",
            runtime: "Runtime",
            originalTitle: "Original title",
            originalLanguage: "Original language",
            spokenLanguages: "Spoken languages",
            network: "Network",
            studio: "Studio",
            country: "Country",
            budget: "Budget",
            revenue: "Revenue",
            dateUnknown: "date unknown",
            seasonCount: "{seasons} seasons, {episodes} episodes",
            oneSeason: "1 season, {episodes} episodes",
            perEpisode: "{n} min / episode",
            hoursMinutes: "{h}h {m}m",
            minutes: "{m}m",
            billions: "${n}B",
            millions: "${n}M",
            dollars: "${n}"
        }
    },

    // the cast page, reached from a face on a title page
    person: {
        born: "Born",
        died: "Died",
        birthplace: "Place of birth",
        credits: "Credits",
        creditCount: "{n} titles",
        yearsOld: "{n} years old",
        agedYears: "aged {n}",
        website: "Website",
        knownFor: "Known for",
        acting: "Acting",
        otherWork: "Other work",
        showAll: "Show {n} more",
        showLess: "Show fewer",
        showMoreBio: "Read the rest",
        showLessBio: "Show less"
    },

    seasonPicker: {
        episodes: "{n} episodes",
        watched: "{n} watched",
        downloaded: "{n} downloaded",
        noDate: "no date yet",
        status: {
            SEARCHING: "waiting for release",
            DOWNLOADING: "downloading",
            DOWNLOADED: "downloaded",
            FAILED: "not found"
        }
    },

    trailerDialog: {
        title: "Trailer"
    },

    notify: {
        ready: { label: "Ready to watch", help: "a download finished and can be watched" },
        started: { label: "Download started", help: "the scanner grabbed something, or somebody asked for it by hand" },
        dropped: { label: "Release dropped", help: "a grab turned out to be fake or dead and went back to being searched for" },
        deleted: { label: "Deleted", help: "a download left the library, by hand or because its time was up" }
    },

    account: {
        title: "Account settings",
        titleFor: "{name}'s account settings",
        backToUsers: "Back to users",
        forSomebodyElse: "These are {name}'s own settings — every \"you\" below is them. What you change here is what the app does for them, and they can change it back from their own page.",
        missing: "There is no such account.",
        who: "{email} · {role}",
        name: "Name",
        nameHint: "What the log and the watchlist call you. It cannot be empty.",
        webhook: "Your webhook",
        webhookOff: "off",
        test: "Test",
        exampleTitle: "Use this as a starting point",
        webhookHint: "A URL the app calls when something of yours happens — never anybody else's downloads. Put {message} in it and it is fetched with the text filled in; leave it without one and it is posted to as JSON (content), which is what a Discord webhook wants. {title}, {detail} and {event} are the other placeholders. Empty turns it off.",
        events: "What to send you",
        eventsHint: "Only ever about your own downloads. Nothing ticked sends nothing, and so does an empty webhook above.",
        languages: "Languages you want, best first",
        languagesHintAny: "Any of these will do, the first one for preference. A release in the second language is taken only when nothing in the first one is there — and once it is taken, that is your copy of it.",
        languagesHintFirst: "The first one is the only language downloaded for you on its own. If a release in it does not exist yet, the title stays on your watchlist and is looked for again — the rest of the list is only offered when you start a download by hand, and taking one of those is a question you have to answer.",
        languagesHintShared: "Somebody else's copy in another language does not count as yours: you each get your own file.",
        acceptAny: "Any language on this list will do",
        acceptAnyHint: "Off, and a title that exists in none of your first language is never downloaded at all — it sits on your watchlist saying \"waiting for release\" while the release is out in another language. That is the safe direction and it is the default, because settling for a language you did not ask for should not happen behind your back. On, the scanner may take any of them, still preferring the first. For one title only, the watchlist has a language column.",
        languageFirst: "Language outranks resolution",
        languageFirstHint: "On, which is how a new account starts: a 720p release in your language beats a 1080p one that is not. Off means the sharpest copy wins and the language is only a tie-breaker — there is no setting between the two, because a language that merely counts for something is a language that loses to a few more seeders.",
        excluded: "Languages you never want",
        excludedHint: "Only applies to what you start by hand, and never to a release in the title's own original language — otherwise a Japanese film would become unobtainable.",
        pickLanguage: "pick a language",
        saved: "Saved.",
        saveFailed: "Could not save that.",
        webhookFailed: "The webhook could not be called.",
        providerOnly: "This account signs in through the identity provider and has no password here. An administrator can give it one.",
        providerOnlyTheirs: "This account signs in through the identity provider and has no password here. \"Set a password\" in the users list gives it one."
    },

    watchlistToast: {
        added: "{name} added to your watchlist!",
        addFailed: "Could not add {name} to your watchlist.",
        removed: "{name} is no longer watched.",
        removeFailed: "Could not stop watching {name}.",
        media: "Media",
        mediaLower: "media"
    },

    settingsPage: {
        title: "Settings",
        intro: "Everything the app reads lives here — the environment is only used to find the database. A field you have not touched follows its default and is not stored; clearing one hands it back. Changes take effect on the next search or scan round, without a restart.",
        save: "Save",
        saveCount: "Save {n} changes",
        saveOne: "Save 1 change",
        saved: "{n} settings saved.",
        savedOne: "1 setting saved.",
        saveFailed: "Could not save the settings.",
        readFailed: "Could not read the settings.",
        clearConfirm: "Clear {label}? It has no default to fall back on, so you will have to type it in again.",
        backToDefault: "{label} is back to its default.",
        cleared: "{label} is cleared.",
        clearFailed: "Could not clear the setting.",
        resetTitle: "Back to the default",
        resetTitleValue: "Back to the default: {value}",
        clearTitle: "Clear {label} — there is no default to fall back on",
        source: {
            database: "edited",
            default: "default",
            unset: "not set"
        },
        // the groups come from the registry, and these are their headings
        groups: {
            "TMDB": "TMDB",
            "Indexers": "Indexers",
            "Torrent client": "Torrent client",
            "Library": "Library",
            "Quality": "Quality",
            "Scanner": "Scanner",
            "Content check": "Content check",
            "Notifications": "Notifications",
            "Download dialog": "Download dialog",
            "Access": "Access",
            "Log": "Log"
        },
        indexers: {
            button: "Read them in",
            title: "Ask the indexer manager what it has set up, and fill the list in from that",
            saveFirst: "Save the URL and the API key first — the list is read with the saved ones.",
            unchanged: "All {n} are already in the list.",
            added: "Added: {added}. Save to keep it.",
            addedAndRemoved: "Added: {added}. Removed, the manager no longer has them: {removed}. Save to keep it.",
            failed: "Could not read the indexer list."
        },
        callback: {
            label: "Callback address for the provider",
            fromPublic: "from the public address below",
            fromRequest: "read from this page's own address",
            copy: "Copy",
            copied: "Copied.",
            copyFailed: "The browser would not let this page copy — select the address by hand.",
            note: "Allow this at the provider exactly as it stands — Authentik and Keycloak call it a redirect URI, Google an authorised redirect URI. A provider that has not been told about it refuses the sign-in on its own page, before this app hears anything about it.",
            guessed: " Right now it is guessed from the address you opened this page on. Behind a proxy that rewrites the host, fill in the public address below and this follows it."
        },
        tableHint: "Write it as 1080p:2 — a resolution and its size in GB.",
        on: "on",
        off: "off"
    },

    logPage: {
        title: "Log",
        intro: "What the app did while nobody was watching — every grab, every release it threw away and every setting that was changed. New lines arrive as they happen. Old ones are dropped after the retention set under Settings / Log.",
        live: "Live",
        clear: "Clear",
        levels: {
            all: "Everything",
            info: "Info",
            warn: "Warnings",
            error: "Errors"
        },
        everySource: "Every source",
        searchText: "Search the text",
        nothingMatches: "Nothing matches that.",
        nothingYet: "Nothing has been logged yet.",
        loadOlder: "Load older entries",
        readFailed: "Could not read the log.",
        clearConfirm: "Clear the whole log? Every entry goes, including the ones this page is not showing.",
        cleared: "{n} entries cleared.",
        clearedOne: "1 entry cleared.",
        clearFailed: "Could not clear the log."
    },

    users: {
        title: "Users",
        intro: "Everybody here shares one watchlist and one library. What the role decides is who may change the settings, read the log, and delete downloads.",
        add: "Add user",
        columns: {
            who: "Who",
            role: "Role",
            signsIn: "Signs in with",
            lastSeen: "Last seen"
        },
        you: "you",
        admin: "Admin",
        user: "User",
        off: "off",
        withPassword: "password",
        withSso: "single sign-on",
        withNothing: "nothing yet",
        accountSettings: "Account settings",
        setPassword: "Set a password",
        makeUser: "Make a plain user",
        makeAdmin: "Make an administrator",
        switchOn: "Switch back on",
        switchOff: "Switch off",
        delete: "Delete",
        addTitle: "Add a user",
        addNote: "The password is optional. Leave it empty for somebody who will arrive through single sign-on — the first time they do, this account is what they land in.",
        emailPlaceholder: "them@example.com",
        namePlaceholder: "Name — this is what the log will call them",
        passwordPlaceholder: "Password (optional)",
        administrator: "Administrator",
        administratorNote: "Settings, the log, and deleting downloads.",
        addButton: "Add",
        passwordTitle: "A new password for {email}",
        passwordNote: "Every browser signed in as them is signed out by this.",
        passwordNoteProvider: " Leave it empty to take the password away and leave only single sign-on.",
        passwordPlaceholderNew: "At least 8 characters",
        deleteTitle: "Delete {email}?",
        deleteNote: "Their sessions go with them. Nothing on the watchlist or in the library is touched — those belong to the install, not to a person.",
        created: "{email} can sign in now.",
        createFailed: "Could not create the account.",
        saveFailed: "Could not save that.",
        roleChanged: "{email} is {role} now.",
        roleAdmin: "an administrator",
        roleUser: "a user",
        switchedOff: "{email} is switched off and signed out.",
        switchedOn: "{email} can sign in again.",
        passwordSet: "A new password is set for {email}.",
        deleted: "{email} is gone.",
        deleteFailed: "Could not delete the account."
    },

    watchlistPage: {
        titleMine: "Your watchlist",
        titleEverybody: "Everybody's watchlist",
        introMine: "What is being looked for for you. As soon as a release turns up it is downloaded, and it moves to the library — which is shared, however many people were waiting for it.",
        introEverybody: "What is being looked for by anybody here. As soon as a release turns up it is downloaded, and it moves to the library — which is shared, however many people were waiting for it.",
        mine: "Mine",
        everybody: "Everybody",
        all: "All",
        scanNow: "Scan now",
        scanTitle: "Check everything you watch that is already out, without waiting for its next slot",
        scanning: "scanning...",
        nextScanAny: "next scan: any moment",
        nextScanSeconds: "next scan in {n}s",
        nextScanIn: "next scan in {time}",
        scanStarted: "Checking every watched item on your indexers...",
        scanDryRun: "{message} SCAN_DRY_RUN is on, so nothing was actually downloaded.",
        scanFailed: "Scan failed.",
        emptyMine: "Your watchlist is empty — add something from a details page or by right clicking a poster.",
        emptyEverybody: "Nobody is waiting for anything at the moment.",
        columns: {
            title: "Title",
            language: "Requested language",
            owner: "Added by",
            type: "Type",
            status: "Status",
            wanted: "Still wanted",
            added: "Added",
            lastChecked: "Last checked",
            attempts: "Attempts"
        },
        auto: "Auto",
        episodesLeft: "{n} episodes",
        outOn: "out {date}",
        outIn: "out {date}, in {n} days",
        outTomorrow: "out {date}, in 1 day",
        stopWatchingTitle: "Stop watching — anything already downloaded stays in the library",
        offList: "{name} is off the watchlist.",
        offListPartly: "{name} is partly off the watchlist.",
        offListFailed: "Could not take {name} off the watchlist.",
        languageSet: "{name} will be looked for in {language}.",
        languageAuto: "{name} follows your account again — {languages}.",
        languageFailed: "Could not change the language of {name}."
    },

    libraryPage: {
        title: "Library",
        intro: "Everything the house has and everything on its way, a row per title — open one to see the downloads it is made of. A finished download seeds for a while before it can be deleted, and then goes on its own — with its files — once the time under \"Kept for\" is up. A film or a single episode is kept for 7 days by default and a season pack 3 days per episode it carries; any row can be given its own number.",
        empty: "Nothing here yet — whatever the app downloads shows up in this list.",
        filters: {
            all: "All",
            downloading: "Downloading",
            available: "Ready to watch"
        },
        columns: {
            title: "Title",
            release: "Release",
            language: "Language",
            watchers: "Requested by",
            size: "Size",
            status: "Status",
            seed: "Seeding",
            keep: "Kept for",
            added: "Added"
        },
        noImage: "no img",
        ready: "Ready to watch",
        downloading: "Downloading",
        notInClient: "not in the client",
        // a title's row is what the house has of it; the downloads it is made of are inside
        episodesCovered: "{n} episodes",
        downloadCount: "{n} downloads",
        editionCount: "{n} editions",
        readyOf: "{done}/{total} ready",
        markedCount: "{n} marked for deletion",
        firstDeletedIn: "first goes in {time}",
        showDownloads: "Show the downloads",
        hideDownloads: "Hide the downloads",
        kbPerSecond: "{n} kB/s",
        mbPerSecond: "{n} MB/s",
        minutesLeft: "{n}m left",
        hoursLeft: "{n}h left",
        timeLeft: "{time} left",
        hours: "{n}h",
        days: "{n} days",
        freeToDelete: "free to delete",
        goesWhenUp: "goes when the time is up",
        deletingNow: "deleting...",
        deletedIn: "deleted in {time}",
        deletedNow: "deleted any moment now",
        seedTooltip: "Counted from qBittorrent's own seeding time — a paused torrent is not serving it.",
        retentionTooltip: "It is kept for {n} days after it finished, and the files go with it. Nothing is deleted before the seed time is up.",
        marked: "marked",
        keepTitle: "Keep it after all",
        markTitle: "Still seeding — mark it for deletion",
        deleteTitle: "Delete",
        markQuestion: "Mark {name} for deletion?",
        deleteQuestion: "Delete {name}?",
        thisOne: "this",
        seedingNote: "This is still seeding for another {time}. It stays until then and goes by itself — with its files — the moment the time is up.",
        deleteNote: "The torrent and its files are both removed from qBittorrent, and it will not be downloaded again. This cannot be undone.",
        markConfirm: "Mark it for deletion",
        deleteConfirm: "Delete it with its files",
        keepDaysValue: "{n} days",
        keepTooltip: "How long it stays after it finished. Left alone this one is {n} days — click to change it.",
        keepQuestion: "How long should {name} be kept?",
        keepNote: "Counted from the moment it finished, and the files go with it when the time is up. Between {min} and {max} days — the floor is the seed time under Settings / Library.",
        keepDefaultButton: "Default ({n} days)",
        dayUnit: "days",
        keepToast: "{name} is kept for {n} days.",
        keepDefaultToast: "{name} is back on its default, {n} days.",
        markedToast: "{name} and its files will be deleted when its seed time is up.",
        stayingToast: "{name} is staying.",
        updateFailed: "Could not update {name}.",
        deletedToast: "{name} and its files were deleted.",
        deleteFailed: "Could not delete {name}."
    },

    download: {
        titleDownload: "Download {name}",
        titleHave: "You already have {name}",
        titleNothing: "Nothing available for {name}",
        searching: "Searching your indexers...",
        pickHint: "Pick a release for each line. The first one is what your quality profile would have taken.",
        haveAll: "{lines} — already downloaded in {languages}, so there is nothing left to fetch.",
        notFound: "Not on your indexers right now, and nothing has been put anywhere. If you want it fetched the moment it turns up, say so below.",
        notFoundFiltered: "Not on your indexers right now — {n} results were filtered out by your quality profile — and nothing has been put anywhere. You can go and look at those releases yourself, or have it watched for.",
        showMore: "Show {n} more releases the profile passed over",
        hideMore: "Hide those releases",
        filtered: "{n} of these were thrown away by your quality profile — the reason is on the line.",
        filteredOne: "1 of these was thrown away by your quality profile — the reason is on the line.",
        // why a release is in the second half of the list. The size, the seeders and the
        // resolution are on the line above, so these only name the kind of refusal
        rejection: {
            noLink: "nothing to download",
            blocked: "tried once and dropped",
            seeders: "too few seeders",
            tooBig: "over your size limit",
            excluded: "excluded keyword",
            mismatch: "does not look like this title",
            language: "not in a language you want",
            resolution: "resolution you do not want",
            tooSmall: "too small for its resolution"
        },
        releases: "{n} releases",
        bestMatch: "best match",
        pack: "pack",
        duplicate: "You already have {lines} in {languages}. Downloading again means a second copy on the disk — worth it if the one you have is a bad rip, and wasted otherwise.",
        duplicateAccept: "I know, download it again.",
        wrongLanguage: "Nothing in {languages} for {lines}. Left alone, this would stay on your watchlist until a release in your language turns up — downloading now means watching it in another one.",
        wrongLanguageAccept: "That is fine, download it anyway.",
        watchMissing: "Nothing found for {lines}. Put it on my watchlist and download it as soon as it shows up.",
        // the same question when *nothing* was found. Unticked, like every other question
        // in this dialog: pressing Download is not a request to be put on a waiting list
        watchNothing: "Put it on my watchlist and download it as soon as it shows up.",
        close: "Close",
        // the way on from "nothing available": those filtered releases do exist, and the
        // manual search page is where they can be looked at
        manualSearch: "Manual search",
        manualSearchFiltered: "Show the {n} filtered releases",
        addToWatchlist: "Add to watchlist",
        confirm: "Download",
        confirmMany: "Download {n} items",
        searchFailed: "Could not search the indexers.",
        startFailed: "Could not start the download.",
        expired: "The search results expired, searching again...",
        watchRest: "{name} is on your watchlist, the missing parts will follow.",
        episodes: {
            title: "What to download from {name}?",
            description: "Tick the episodes, then the releases are searched for exactly those. Nothing here touches your watchlist — what is already on it starts off ticked.",
            empty: "TMDB lists no episodes for this yet, so there is nothing to pick — it will be searched for as soon as one is announced if you put it on your watchlist.",
            pick: "Pick an episode",
            search: "Search for {n} episodes",
            searchOne: "Search for 1 episode",
            loadFailed: "Could not read the episode list."
        }
    }
};
