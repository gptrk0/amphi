'use client';

import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { ChevronDown, Loader2, Send, X } from "lucide-react";
import classNames from "classnames";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useLocale } from "@/context/locale";
import { Locale } from "@/i18n";

/**
 * Notifications on the device you are holding, and the list of every other one.
 *
 * **It is not an account setting and it cannot be made into one.** Everything else on the
 * account page is a row in a table that an administrator could fill in for somebody; this
 * is a permission one browser gave, tied to one service worker, and nothing on the server
 * can create it. So the switch is only ever drawn on your own page, it says "this device"
 * everywhere, and the same person on a phone and a laptop has to press it twice.
 *
 * **The list is the part that matters most, and it is not a convenience.** A subscription
 * is invisible and it does not expire: a phone that was lent out, a borrowed laptop signed
 * into once, a handset that was lost — each goes on being told, forever, and the switch
 * that would stop it is on the device nobody has any more. So every device is listed and
 * every one of them can be forgotten from here. What makes that mean anything is on the
 * server: the page says "still here" on load with `refresh`, which updates a row and
 * cannot create one, so a device forgotten here does not quietly re-create itself the
 * next time somebody opens the app on it.
 *
 * **The three dead ends are worth naming rather than hiding.** Without a secure context
 * there is no `PushManager` at all — which is most self hosted installs, reached as a
 * plain address on the house network. In an iOS tab there is none either until the page
 * is on the home screen. And a permission that was once refused cannot be asked for
 * again from here, by either platform's rules: the browser's own settings are the only
 * way back. A switch that silently did nothing in all three cases would be the worst
 * possible version of this.
 */

type State = "loading" | "unsupported" | "denied" | "off" | "on";

type Device = {
    id: number;
    label: string | null;
    createdAt: string;
    lastSeenAt: string;
    current: boolean;
};

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

const STORAGE_KEY = "amphi_push_device";

let onlyForThisPage = "";

/**
 * What this browser calls itself, made once and kept.
 *
 * **It exists because the endpoint moves.** A browser may renew a push subscription with
 * nobody asking, and since the page is deliberately not allowed to create a row on a
 * plain load — that is what makes forgetting a device from another one stick — a device
 * known only by its address would go quiet the moment its address changed. The event the
 * specification offers for this, `pushsubscriptionchange`, is no use here: Chrome only
 * began firing it in 138 and iOS does not have it at all, which is the platform the whole
 * feature is for.
 *
 * A private window, or site data the browser refuses to keep, falls back to a key that
 * lasts as long as the page does. That is not as bad as it sounds: the row is then found
 * by its endpoint instead and adopts whatever key arrived with it.
 */
const deviceKey = () => {
    try {
        const kept = localStorage.getItem(STORAGE_KEY);

        if (kept) {
            return kept;
        }

        const made = crypto.randomUUID();

        localStorage.setItem(STORAGE_KEY, made);

        return made;

    } catch {
        if (! onlyForThisPage) {
            onlyForThisPage = crypto.randomUUID();
        }

        return onlyForThisPage;
    }
};

const dateLocale = (locale: Locale) => locale === "hu" ? "hu-HU" : "en-GB";

export function PushToggle() {
    const { t, locale } = useLocale();

    const [ state, setState ] = useState<State>("loading");
    const [ devices, setDevices ] = useState<Device[]>([]);
    const [ isOpen, setOpen ] = useState(false);
    const [ isBusy, setBusy ] = useState(false);
    const [ isTesting, setTesting ] = useState(false);

    const mine = async () => {
        const registration = await navigator.serviceWorker.ready;

        return await registration.pushManager.getSubscription();
    };

    /**
     * "Still here", said on every load. It updates the row and cannot make one, so a
     * browser whose device was forgotten elsewhere reads itself as off — which is the
     * whole point, and also why the state comes back from the server rather than from
     * the mere existence of a subscription in this browser.
     */
    const refresh = useCallback(async (subscription: PushSubscription) => {
        const res = await axios.post("/api/push", {
            subscription: payloadOf(subscription),
            deviceKey: deviceKey(),
            refresh: true
        });

        setDevices(res.data.result?.devices ?? []);

        return !! res.data.result?.known;
    }, []);

    useEffect(() => {
        if (! supported()) {
            setState("unsupported");

            return;
        }

        let alive = true;

        (async () => {
            try {
                const subscription = await mine();

                if (! alive) {
                    return;
                }

                const res = await axios.get("/api/push", {
                    params: { deviceKey: deviceKey(), endpoint: subscription?.endpoint }
                });

                setDevices(res.data.result?.devices ?? []);

                if (Notification.permission === "denied") {
                    setState("denied");

                    return;
                }

                if (subscription && Notification.permission === "granted") {
                    setState(await refresh(subscription) ? "on" : "off");

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
    }, [ refresh ]);

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

        // an existing subscription comes back as it is, which is the case that matters
        // after this device was forgotten from somewhere else: the browser never asked
        // again, and this is what puts the row back
        const subscription = await registration.pushManager.subscribe({
            // the promise that every push becomes something the person can see. It is
            // not optional on any browser that matters, and breaking it is how a
            // subscription gets revoked.
            userVisibleOnly: true,
            applicationServerKey: toBytes(key)
        });

        const res = await axios.post("/api/push", {
            subscription: payloadOf(subscription),
            deviceKey: deviceKey()
        });

        setDevices(res.data.result?.devices ?? []);
        setState("on");
        toast(t("push.turnedOn"));
    };

    const turnOff = async () => {
        const subscription = await mine();

        if (subscription) {
            // the browser first, then us: a row kept for a subscription the browser has
            // dropped would be a message sent into nothing every time
            await subscription.unsubscribe().catch(() => {});

            const res = await axios.delete("/api/push", { params: { endpoint: subscription.endpoint } });

            setDevices(res.data.result?.devices ?? []);
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

    /** Forgetting one from the list. This browser is the same gesture as the switch. */
    const forget = async (device: Device) => {
        setBusy(true);

        try {
            if (device.current) {
                await turnOff();

                return;
            }

            const res = await axios.delete("/api/push", { params: { id: device.id } });

            setDevices(res.data.result?.devices ?? []);
            toast(t("push.forgotten"));

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

    const when = (value: string) =>
        new Date(value).toLocaleDateString(dateLocale(locale), { day: "numeric", month: "short" });

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
                    disabled={isTesting || devices.length === 0}
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

            {devices.length > 0 && <div className="rounded-md border">
                <button
                    type="button"
                    className="flex w-full cursor-pointer items-center gap-1 px-3 py-2 text-xs text-muted-foreground hover:text-foreground"
                    onClick={() => setOpen(open => ! open)}
                    aria-expanded={isOpen}
                >
                    <ChevronDown className={classNames("size-3.5 transition-transform", { "-rotate-90": ! isOpen })} />
                    { t("push.devices", { count: devices.length }) }
                </button>

                {isOpen && <ul className="border-t">
                    {devices.map(device => (
                        <li key={device.id} className="flex items-center gap-2 px-3 py-2 text-xs">
                            <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-2">
                                    <span className="truncate font-medium">
                                        { device.label || t("push.unknownDevice") }
                                    </span>

                                    {device.current && <Badge variant="outline">{ t("push.thisDevice") }</Badge>}
                                </div>

                                <span className="text-muted-foreground">
                                    { t("push.lastSeen", { when: when(device.lastSeenAt) }) }
                                </span>
                            </div>

                            <Button
                                variant="ghost"
                                size="sm"
                                className="shrink-0 cursor-pointer"
                                onClick={() => forget(device)}
                                disabled={isBusy}
                                title={t("push.forget")}
                                aria-label={t("push.forget")}
                            >
                                <X />
                            </Button>
                        </li>
                    ))}
                </ul>}
            </div>}
        </div>
    );
}
