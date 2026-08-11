'use client';

import { useId } from "react";
import { Check, ChevronsUpDown } from "lucide-react";

import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";
import { useLocale } from "@/context/locale";
import { Locale, LOCALES, LOCALE_NAMES } from "@/i18n";

/**
 * The language chooser at the bottom of the navbar: the current flag and the language's own
 * name, and the rest under it.
 *
 * **The flags are drawn, not written.** 🇭🇺 is two regional indicator letters, and Segoe UI
 * Emoji — the font every browser on Windows reaches for — has no glyph that turns a pair of
 * them into a flag, so the emoji shows up as the bare letters `HU`. That is most of this
 * app's audience seeing text where a flag was promised, so both flags are svg. Both are 2:1,
 * which is the real ratio of each, so nothing is squashed to fit a shared box.
 */

/**
 * The frame both flags are drawn into.
 *
 * The svg keeps a `size-` class and sits inside a span rather than beside the label, because
 * both the sidebar button and the dropdown row force a square 16px on any svg they find —
 * `[&>svg]:size-4` and `[&_svg:not([class*='size-'])]:size-4`. That is right for an icon and
 * wrong for a flag: it would squash a 2:1 rectangle into a square.
 */
function Frame({ children }: { children: React.ReactNode }) {
    return (
        <span className="ring-black/20 h-2.5 w-5 shrink-0 overflow-hidden rounded-[2px] ring-1">
            <svg viewBox="0 0 60 30" className="size-full" aria-hidden="true">
                { children }
            </svg>
        </span>
    );
}

function UnionJack() {
    // two of these render at once — the trigger and the menu row — and an id repeated is a
    // clip path pointing at whichever one mounted first
    const clip = useId();

    return (
        <Frame>
            <clipPath id={clip}>
                <path d="M30,15 h30 v15 z v15 h-30 z h-30 v-15 z v-15 h30 z" />
            </clipPath>

            <rect width="60" height="30" fill="#012169" />
            <path d="M0,0 L60,30 M60,0 L0,30" stroke="#fff" strokeWidth="6" />
            <path d="M0,0 L60,30 M60,0 L0,30" clipPath={`url(#${ clip })`} stroke="#c8102e" strokeWidth="4" />
            <path d="M30,0 v30 M0,15 h60" stroke="#fff" strokeWidth="10" />
            <path d="M30,0 v30 M0,15 h60" stroke="#c8102e" strokeWidth="6" />
        </Frame>
    );
}

function Hungarian() {
    return (
        <Frame>
            <rect width="60" height="30" fill="#fff" />
            <rect width="60" height="10" fill="#ce2939" />
            <rect width="60" height="10" y="20" fill="#477050" />
        </Frame>
    );
}

const FLAGS: Record<Locale, () => React.ReactElement> = { en: UnionJack, hu: Hungarian };

function Flag({ locale }: { locale: Locale }) {
    const Drawing = FLAGS[locale];

    return <Drawing />;
}

export function LanguagePicker() {
    const { locale, setLocale, t } = useLocale();

    return (
        <SidebarMenu>
            <SidebarMenuItem>
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        {/* the visible text is the language, so the label is what the row is
                            for — otherwise a screen reader reads out "Magyar" and nothing
                            about why it is there */}
                        <SidebarMenuButton className="cursor-pointer" aria-label={t("nav.language")}>
                            <Flag locale={locale} />
                            <span>{ LOCALE_NAMES[locale] }</span>
                            <ChevronsUpDown className="ml-auto opacity-60" />
                        </SidebarMenuButton>
                    </DropdownMenuTrigger>

                    {/* upwards, because the trigger sits at the bottom of the screen, and as
                        wide as the trigger so it reads as the same control opened */}
                    <DropdownMenuContent
                        side="top"
                        align="start"
                        className="w-(--radix-dropdown-menu-trigger-width)"
                    >
                        {LOCALES.map(code => (
                            <DropdownMenuItem
                                key={code}
                                className="cursor-pointer gap-2"
                                onClick={() => setLocale(code)}
                            >
                                <Flag locale={code} />
                                <span>{ LOCALE_NAMES[code] }</span>

                                {locale === code && <Check className="ml-auto size-4" />}
                            </DropdownMenuItem>
                        ))}
                    </DropdownMenuContent>
                </DropdownMenu>
            </SidebarMenuItem>
        </SidebarMenu>
    );
}
