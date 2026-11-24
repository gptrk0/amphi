'use client';

import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Loader2, Send } from "lucide-react";
import classNames from "classnames";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useLocale } from "@/context/locale";

/**
 * Notifications on the device you are holding.
 *
 * **It is not an account setting and it cannot be made into one.** Everything else on the
 * account page is a row in a table that an administrator could fill in for somebody; this
 * is a permission one browser gave, tied to one service worker, and nothing on the server
 * can create it. So the switch is only ever drawn on your own page, it says "this device"
 * everywhere, and the same person on a phone and a laptop has to press it twice.
 *
 * **The three dead ends are worth naming rather than hiding.** Without a secure context
 * there is no `PushManager` at all — which is most self hosted installs, reached as a
 * plain address on the house network. In an iOS tab there is none either until the page
 * is on the home screen. And a permission that was once refused cannot be asked for
 * again from here, by either platform's rules: the browser's own settings are the only
 * way back. A switch that silently does nothing in all three cases would be the worst
 * possible version of this.
 */

type State = "loading" | "unsupported" | "denied" | "off" | "on";

/**
 * The key the browser wants as bytes, and the server has as the base64url a json response
 * can carry. Short enough to keep here rather than in a utils file nobody else would read.
 */
const toBytes = (base64url: string) => {
    const padded = (base64url + "=".repeat((4 - base64url.length % 4) % 4))
        .replace(/-/g, "+")
        .replace(/_/g, "/");

    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);

    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }

    return bytes;
};

const supported = () =>
    typeof window !== "undefined"
    && "serviceWorker" in navigator
    && "PushManager" in window
    && "Notification" in window;

/** What the server stores, out of what the browser hands over. */
const payloadOf = (subscription: PushSubscription) => {
    const json = subscription.toJSON();

    return {
        endpoint: json.endpoint,
        keys: { p256dh: json.keys?.p256dh, auth: json.keys?.auth }
    };
};

export function PushToggle() {
    const { t } = useLocale();

    const [ state, setState ] = useState<State>("loading");
    const [ devices, setDevices ] = useState(0);
    const [ isBusy, setBusy ] = useState(false);
    const [ isTesting, setTesting ] = useState(false);

    /**
     * Tells the server about a subscription every time the page loads, not only when the
     * switch is pressed. A browser may renew a subscription on its own, and a database
     * restored from a backup has rows that no longer exist — in both cases the device
     * goes quiet forever unless something says it again, and this is that something.
     */
    const remember = useCallback(async (subscription: PushSubscription) => {
        const res = await axios.post("/api/push", { subscription: payloadOf(subscription) });

        setDevices(res.data.result?.devices ?? 0);
    }, []);

    useEffect(() => {
        if (! supported()) {
            setState("unsupported");

            return;
        }

        let alive = true;

        (async () => {
            try {
                const registration = await navigator.serviceWorker.ready;
                const subscription = await registration.pushManager.getSubscription();

                if (! alive) {
                    return;
                }

                // the count comes from the account and the state from this browser: "on
                // somewhere else" and "on here" are two different sentences
                const res = await axios.get("/api/push");

                setDevices(res.data.result?.devices ?? 0);

                if (Notification.permission === "denied") {
                    setState("denied");

                    return;
                }

                if (subscription && Notification.permission === "granted") {
                    await remember(subscription);
                    setState("on");

                    return;
                }

                setState("off");

            } catch(err) {
                console.error(err);

                if (alive) {
                    setState("unsupported");
                }
            }
        })();

        return () => { alive = false; };
    }, [ remember ]);

    const turnOn = async () => {
        // from inside the click and nowhere else: both platforms refuse a permission
        // prompt that did not come out of something the person just did
        const permission = await Notification.requestPermission();

        if (permission !== "granted") {
            setState(permission === "denied" ? "denied" : "off");

            return;
        }

        const registration = await navigator.serviceWorker.ready;
        const key = (await axios.get("/api/push")).data.result?.publicKey;

        if (! key) {
            throw new Error("no signing key");
        }

        const subscription = await registration.pushManager.subscribe({
            // the promise that every push becomes something the person can see. It is
            // not optional on any browser that matters, and breaking it is how a
            // subscription gets revoked.
            userVisibleOnly: true,
            applicationServerKey: toBytes(key)
        });

        await remember(subscription);

        setState("on");
        toast(t("push.turnedOn"));
    };

    const turnOff = async () => {
        const registration = await navigator.serviceWorker.ready;
        const subscription = await registration.pushManager.getSubscription();

        if (subscription) {
            // the browser first, then us: a row we kept for a subscription the browser
            // has dropped would be a message sent into nothing every time
            await subscription.unsubscribe().catch(() => {});

            const res = await axios.delete("/api/push", { params: { endpoint: subscription.endpoint } });

            setDevices(res.data.result?.devices ?? 0);
        }

        setState("off");
        toast(t("push.turnedOff"));
    };

    const toggle = async (wanted: boolean) => {
        setBusy(true);

        try {
            await (wanted ? turnOn() : turnOff());

        } catch(err) {
            console.error(err);

            toast((axios.isAxiosError(err) && err.response?.data?.message) || t("push.failed"));

        } finally {
            setBusy(false);
        }
    };

    const test = async () => {
        setTesting(true);

        try {
            const res = await axios.post("/api/push/test");

            toast(res.data.message);

        } catch(err) {
            toast((axios.isAxiosError(err) ? err.response?.data?.message : null) || t("push.failed"));

        } finally {
            setTesting(false);
        }
    };

    const blocked = state === "unsupported" || state === "denied" || state === "loading";

    return (
        <div className="space-y-2">
            <div className="flex items-center gap-2">
                <label className="text-sm font-medium">{ t("push.title") }</label>

                <Badge variant="outline">{ state === "on" ? t("push.on") : t("push.off") }</Badge>
            </div>

            <div className="flex items-center gap-3">
                <Switch
                    className="cursor-pointer"
                    checked={state === "on"}
                    disabled={isBusy || blocked}
                    onCheckedChange={toggle}
                />

                <span className="text-sm text-muted-foreground">
                    { state === "on" ? t("push.disable") : t("push.enable") }
                </span>

                <Button
                    variant="outline"
                    size="sm"
                    className="ml-auto shrink-0 cursor-pointer"
                    onClick={test}
                    disabled={isTesting || devices === 0}
                    title={t("push.testTitle")}
                >
                    <Loader2 className={classNames("animate-spin", { "hidden": ! isTesting })} />
                    <Send className={classNames({ "hidden": isTesting })} />
                    { t("push.test") }
                </Button>
            </div>

            <p className="text-xs text-muted-foreground">{ t("push.hint") }</p>

            {state === "unsupported" && <p className="text-xs text-muted-foreground">{ t("push.unsupported") }</p>}
            {state === "denied" && <p className="text-xs text-muted-foreground">{ t("push.denied") }</p>}

            {devices > 0 && <p className="text-xs text-muted-foreground">{ t("push.devices", { count: devices }) }</p>}
        </div>
    );
}
