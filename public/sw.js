/**
 * The service worker: the part of the app that runs when the app is not running.
 *
 * It has three jobs and only one of them is caching.
 *
 * - A browser will not offer to install a page as an app unless a worker is registered
 *   and handling fetches, so without this file there is no "Add to Home Screen" worth
 *   the name on android and no standalone window anywhere.
 * - A phone that has left the house should say so in the app's own words rather than
 *   show the browser's error page, which looks like the app crashed when in fact the
 *   server is simply three streets away.
 * - A push arrives here, in a worker with no page open and no javascript of the app's
 *   running, and this is the only place that can turn it into a notification.
 *
 * **Nothing of the app is cached.** Not a page, not a chunk, not one api answer. That is
 * not laziness, it is the only safe default here:
 *
 * - An install is shared. A cached page belongs to whoever was signed in when it was
 *   stored, and the next person to open the app on that phone is usually the same person
 *   — but "usually" is not a basis for keeping somebody's watchlist in a cache.
 * - The data is the point. Everything worth looking at comes from `/api`, from a database
 *   on a machine that is either reachable or not. A cached shell with no data in it is a
 *   working app with every list empty, which is worse than an honest "no connection".
 * - The development stack rebuilds on every start. A worker that served chunks from a
 *   cache would serve yesterday's build to the person writing today's.
 *
 * So one file is kept — the offline page — and every navigation is tried against the
 * network first. The day static caching earns its place, it goes here and nowhere else.
 */

const CACHE = "amphi-offline-v1";

const OFFLINE = "/offline.html";

self.addEventListener("install", event => {
    event.waitUntil(
        caches.open(CACHE)
            // `reload` so an upgrade cannot pick the old page out of the http cache and
            // store it again as if it were the new one
            .then(cache => cache.add(new Request(OFFLINE, { cache: "reload" })))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener("activate", event => {
    event.waitUntil(
        caches.keys()
            .then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key))))
            .then(() => self.clients.claim())
    );
});

/**
 * Navigations only. Everything else — the api, the chunks, the posters from TMDB — is
 * left to the browser, which is what an untouched request means: no `respondWith`, no
 * worker in the way.
 */
self.addEventListener("fetch", event => {
    const request = event.request;

    if (request.method !== "GET" || request.mode !== "navigate") {
        return;
    }

    event.respondWith(
        fetch(request).catch(async () => await caches.match(OFFLINE) || Response.error())
    );
});

/**
 * A push, which is to say a sealed envelope the browser has just opened. The payload is
 * whatever `pushToUser` put in it; anything else — a push from something that is not this
 * app, an empty one sent by a service to keep the subscription warm — still has to end in
 * a visible notification, because the subscription promised `userVisibleOnly` and a
 * browser that catches us breaking that promise revokes it.
 *
 * There is deliberately no `badge`: android draws it from the alpha channel alone, and
 * this icon is a solid square, so it would come out as a grey blob. No badge means the
 * browser's own mark, which is at least a shape.
 */
self.addEventListener("push", event => {
    let payload = {};

    try {
        payload = event.data ? event.data.json() : {};

    } catch {
        payload = { body: event.data ? event.data.text() : "" };
    }

    event.waitUntil(
        self.registration.showNotification(payload.title || "Amphi", {
            body: payload.body || "",
            icon: "/icon-192.png",
            // notifications about the same thing replace each other rather than stacking:
            // a series that lands episode by episode should not bury the phone
            tag: payload.tag || undefined,
            data: { url: payload.url || "/" }
        })
    );
});

/**
 * Tapping one. A window of this app that is already open is reused and taken to the
 * right page rather than left where it was — somebody who taps a notification has said
 * which page they want — and only when nothing is open at all is a new one made.
 */
self.addEventListener("notificationclick", event => {
    event.notification.close();

    const target = new URL(event.notification.data && event.notification.data.url || "/", self.location.origin);

    event.waitUntil(
        self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(clients => {
            for (const client of clients) {
                if (new URL(client.url).origin !== target.origin) {
                    continue;
                }

                if (client.url !== target.href && "navigate" in client) {
                    return client.navigate(target.href).then(navigated => (navigated || client).focus());
                }

                return client.focus();
            }

            return self.clients.openWindow(target.href);
        })
    );
});
