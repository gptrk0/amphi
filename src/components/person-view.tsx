'use client';

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { ExternalLink, Film, User } from "lucide-react";

import { MediaRow } from "@/components/media-row";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useLocale } from "@/context/locale";
import { Locale, Translate } from "@/i18n";
import { PersonCredit, PersonDetails } from "@/types/media";

// the same formatting the detail page uses: a date belongs to whoever is reading it
const dateLocale = (locale: Locale) => locale === "hu" ? "hu-HU" : "en-GB";

const dateText = (value: string | null, locale: Locale) => {
    if (! value) {
        return "";
    }

    return new Date(value).toLocaleDateString(dateLocale(locale), { year: "numeric", month: "short", day: "numeric" });
};

/**
 * Whole years between two dates, which is the number a person means by "age". Counted to
 * the death date when there is one — an obituary line, not a countdown.
 */
const age = (birthday: string, until: string | null) => {
    const born = new Date(birthday);
    const end = until ? new Date(until) : new Date();
    const years = end.getFullYear() - born.getFullYear();
    const beforeBirthday = end.getMonth() < born.getMonth()
        || (end.getMonth() === born.getMonth() && end.getDate() < born.getDate());

    return years - (beforeBirthday ? 1 : 0);
};

const bornText = (person: PersonDetails, locale: Locale, t: Translate) => {
    const date = dateText(person.birthday, locale);

    if (! date) {
        return "";
    }

    // the age is only worth saying while it is still going up, or once, next to the death
    return person.deathday
        ? date
        : `${ date } · ${ t("person.yearsOld", { n: age(person.birthday!, null) }) }`;
};

const diedText = (person: PersonDetails, locale: Locale, t: Translate) => {
    const date = dateText(person.deathday, locale);

    if (! date) {
        return "";
    }

    return person.birthday
        ? `${ date } · ${ t("person.agedYears", { n: age(person.birthday, person.deathday) }) }`
        : date;
};

const LinkButton = ({ href, children }: { href: string, children: React.ReactNode }) => (
    <Button variant="outline" className="cursor-pointer" asChild>
        <a href={href} target="_blank" rel="noreferrer">
            { children } <ExternalLink className="size-3.5 text-muted-foreground" />
        </a>
    </Button>
);

/**
 * A filmography, the way a person reads one: newest first, the poster next to the title so
 * a career can be recognised rather than read, and the whole card a link to the page this
 * app already has for the title. The role is the point of the line — "which one were they
 * in this" — so it is on it rather than in a tooltip.
 *
 * Long careers are cut to the first `SHOWN` cards with the rest a click away: a page that
 * opens with two hundred rows is a page you have to scroll past to find anything.
 */
const SHOWN = 12;

/**
 * A poster at thumbnail size. Titles TMDB has no image for keep the same footprint, so a
 * missing poster never shifts the card next to it out of line.
 */
function CreditPoster({ src }: { src: string }) {
    if (! src) {
        return (
            <div className="flex aspect-[2/3] w-[52px] shrink-0 items-center justify-center rounded-md bg-muted">
                <Film className="size-4 text-muted-foreground" />
            </div>
        );
    }

    return (
        <Image
            src={src}
            alt=""
            width={52}
            height={78}
            className="aspect-[2/3] w-[52px] shrink-0 rounded-md object-cover"
        />
    );
}

function CreditList({ title, credits }: { title: string, credits: PersonCredit[] }) {
    const { t } = useLocale();
    const [ showAll, setShowAll ] = useState(false);

    if (credits.length === 0) {
        return null;
    }

    const visible = showAll ? credits : credits.slice(0, SHOWN);

    return (
        <div className="min-w-0 space-y-3">
            <h3 className="text-lg font-semibold tracking-tight">{ title }</h3>

            <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {visible.map(credit => (
                    <li key={`${ credit.media.type }:${ credit.media.id }`} className="min-w-0">
                        <Link
                            href={`/details/${ credit.media.type }/${ credit.media.id }`}
                            className="flex min-w-0 cursor-pointer gap-3 rounded-lg border p-2 transition-colors hover:bg-accent"
                        >
                            <CreditPoster src={credit.media.poster_img} />

                            <div className="min-w-0 flex-1 space-y-1 py-0.5">
                                <div className="line-clamp-2 text-sm font-medium" title={credit.media.name}>
                                    { credit.media.name }
                                </div>

                                <div className="text-xs tabular-nums text-muted-foreground">
                                    { credit.year || "—" } · { credit.media.type === "tv" ? t("common.series") : t("common.movie") }
                                </div>

                                {credit.role && (
                                    <div className="truncate text-xs text-muted-foreground" title={credit.role}>
                                        { credit.role }
                                    </div>
                                )}
                            </div>
                        </Link>
                    </li>
                ))}
            </ul>

            {credits.length > SHOWN && (
                <Button
                    variant="outline"
                    size="sm"
                    className="cursor-pointer"
                    onClick={() => setShowAll(! showAll)}
                >
                    { showAll ? t("person.showLess") : t("person.showAll", { n: credits.length - SHOWN }) }
                </Button>
            )}
        </div>
    );
}

type Props = {
    person: PersonDetails;
    // the reader's language, or English when TMDB has no translated one — resolved on the
    // server, because falling back is a second request and not the browser's job
    biography: string;
};

export function PersonView({ person, biography }: Props) {
    const { locale, t } = useLocale();
    const [ showBio, setShowBio ] = useState(false);

    const born = bornText(person, locale, t);
    const died = diedText(person, locale, t);

    // three paragraphs is where a biography stops being an introduction
    const isLong = biography.length > 700;
    const shown = ! isLong || showBio ? biography : `${ biography.slice(0, 700).trimEnd() }…`;

    return (
        <div className="space-y-10 p-4 pb-12 md:p-8">
            <div className="flex flex-col gap-6 md:flex-row md:gap-8">
                {person.profile_img
                    ? <Image
                        src={person.profile_img}
                        alt={person.name}
                        width={220}
                        height={330}
                        priority
                        className="aspect-[2/3] w-[160px] shrink-0 rounded-lg object-cover shadow-lg md:w-[220px]"
                    />
                    : <div className="flex aspect-[2/3] w-[160px] shrink-0 items-center justify-center rounded-lg bg-muted md:w-[220px]">
                        <User className="size-10 text-muted-foreground" />
                    </div>}

                <div className="min-w-0 flex-1 space-y-4">
                    <div className="space-y-1">
                        <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">{ person.name }</h1>

                        {person.department && <Badge variant="secondary">{ person.department }</Badge>}
                    </div>

                    <dl className="grid gap-x-8 gap-y-3 sm:grid-cols-2">
                        {born && <div className="border-t pt-2">
                            <dt className="text-xs uppercase tracking-wide text-muted-foreground">{ t("person.born") }</dt>
                            <dd className="text-sm">{ born }</dd>
                        </div>}

                        {died && <div className="border-t pt-2">
                            <dt className="text-xs uppercase tracking-wide text-muted-foreground">{ t("person.died") }</dt>
                            <dd className="text-sm">{ died }</dd>
                        </div>}

                        {person.place_of_birth && <div className="border-t pt-2">
                            <dt className="text-xs uppercase tracking-wide text-muted-foreground">{ t("person.birthplace") }</dt>
                            <dd className="text-sm">{ person.place_of_birth }</dd>
                        </div>}

                        <div className="border-t pt-2">
                            <dt className="text-xs uppercase tracking-wide text-muted-foreground">{ t("person.credits") }</dt>
                            <dd className="text-sm">{ t("person.creditCount", { n: person.cast.length + person.crew.length }) }</dd>
                        </div>
                    </dl>

                    {biography && <div className="max-w-3xl space-y-2">
                        <p className="text-sm leading-relaxed whitespace-pre-line">{ shown }</p>

                        {isLong && (
                            <button
                                type="button"
                                className="cursor-pointer text-sm text-muted-foreground hover:text-foreground"
                                onClick={() => setShowBio(! showBio)}
                            >
                                { showBio ? t("person.showLessBio") : t("person.showMoreBio") }
                            </button>
                        )}
                    </div>}

                    <div className="flex flex-wrap gap-3 pt-2">
                        <LinkButton href={`https://www.themoviedb.org/person/${ person.id }`}>TMDB</LinkButton>
                        {person.imdb_id && <LinkButton href={`https://www.imdb.com/name/${ person.imdb_id }`}>IMDb</LinkButton>}
                        {person.homepage && <LinkButton href={person.homepage}>{ t("person.website") }</LinkButton>}
                    </div>
                </div>
            </div>

            <MediaRow title={t("person.knownFor")} items={person.known_for} />

            <CreditList title={t("person.acting")} credits={person.cast} />

            <CreditList title={t("person.otherWork")} credits={person.crew} />
        </div>
    );
}
