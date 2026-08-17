'use client';

import { useLocale } from "@/context/locale";

/**
 * What to paste, for the two services anybody actually uses. Clicking one fills the field
 * in — the placeholder syntax is the part nobody guesses right from a help text, and a
 * starting point with the token spelt `<TOKEN>` is read as a starting point.
 *
 * One component for both webhook fields: the install's under Settings / Notifications and
 * each person's on their account page. They are the same field with the same rules, and two
 * copies of this list would be two places for a URL shape to go stale in.
 */

const EXAMPLES = [
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
