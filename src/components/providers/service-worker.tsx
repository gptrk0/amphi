'use client';

import { useEffect } from "react";

/**
 * Registers the worker, once, and does nothing else — it draws nothing and provides no
 * context, and sits with the providers because that is where the things wrapped around
 * the whole app live.
 *
 * **Why the guard is not a formality.** `navigator.serviceWorker` does not exist outside a
 * secure context, and a self hosted install reached as `http://192.168.1.50:3000` is not
 * one. So on the installs this app is most often reached from, this quietly does nothing
 * — which is the correct behaviour and the reason the app must not depend on the worker
 * for anything. Give it a hostname with a certificate, through Tailscale or a tunnel, and
 * the same code registers with no change anywhere.
 *
 * **A failure is swallowed on purpose.** Nothing the app does needs the worker: it is
 * what makes the page installable and what answers when the server cannot be reached.
 * A toast about it would be a toast about a feature nobody asked for yet.
 */
export function ServiceWorker() {
    useEffect(() => {
        if (! ("serviceWorker" in navigator)) {
            return;
        }

        navigator.serviceWorker.register("/sw.js").catch(() => {});
    }, []);

    return null;
}
