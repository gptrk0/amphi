'use client';

import { useLocale } from "@/context/locale";

/**
 * What to paste, for the three services anybody actually uses. Clicking one fills the field
 * in — the placeholder syntax is the part nobody guesses right from a help text, and a
 * starting point with the token spelt `<TOKEN>` is read as a starting point.
 *
 * One component for both webhook fields: the install's under Settings / Notifications and
 * each person's on their account page. They are the same field with the same rules, and two
 * copies of this list would be two places for a URL shape to go stale in.
 *
 * **ntfy is first because it is the one that reaches a phone without a certificate.** An
 * install that can be reached over https has no need of it: the switch below this field
 * pushes to the home screen app itself. One that is reached as a plain address on the
 * house network cannot do that at all, and then an ntfy topic is the answer — a URL, which
 * is the one thing this field has always been able to call.
 *
 * Two parts of that URL are worth knowing. The topic name **is the password**: anybody who
 * guesses it reads every notification, so it is a random string and not "amphi". And
 * `click` is what the notification opens when it is tapped, which is where the public
 * address of the install goes — without it the tap lands in the ntfy app and stops there.
 */

const EXAMPLES = [
    {
        name: "ntfy",
        url: "https://ntfy.sh/<SECRET-TOPIC>/publish?title={title}&message={message}&click=<YOUR-AMPHI-URL>"
    },
    {
        name: "Telegram",
        url: "https://api.telegram.org/bot<TOKEN>/sendMessage?chat_id=<CHAT>&text={message}"
    },
    {
        name: "Discord",
        url: "https://discord.com/api/webhooks/<id>/<token>"
    }
];

export function WebhookExamples({ onPick }: { onPick: (url: string) => void }) {
    const { t } = useLocale();

    return (
        <div className="space-y-1 rounded-md border p-3">
            {EXAMPLES.map(example => (
                <div key={example.name} className="flex flex-wrap items-baseline gap-2 text-xs">
                    <span className="w-16 shrink-0 font-medium">{ example.name }</span>

                    <button
                        type="button"
                        className="cursor-pointer break-all text-left font-mono text-muted-foreground hover:text-foreground"
                        onClick={() => onPick(example.url)}
                        title={t("webhook.exampleTitle")}
                    >
                        { example.url }
                    </button>
                </div>
            ))}
        </div>
    );
}
