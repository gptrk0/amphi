'use client';

import { useState } from "react";
import { Check, ChevronDown, ChevronRight, Loader2, TriangleAlert } from "lucide-react";
import classNames from "classnames";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { useLocale } from "@/context/locale";
import { Translate } from "@/i18n";
import { DownloadPreview, GrabChoice, GrabOption } from "@/types/download";

type Props = {
    open: boolean;
    name: string;
    preview: DownloadPreview | null;
    isLoading: boolean;
    isStarting: boolean;
    picks: Record<string, string>;
    onPick: (key: string, guid: string) => void;
    onCancel: () => void;
    onConfirm: (watchMissing: boolean) => void;
};

const GB = 1024 * 1024 * 1024;

const size = (bytes: number) => {
    return bytes >= GB ? `${ (bytes / GB).toFixed(1) } GB` : `${ Math.round(bytes / (1024 * 1024)) } MB`;
};

/**
 * The language goes first, before the resolution: it is the one thing on this line
 * that decides whether the file is watchable at all, and the only one the release
 * name is the sole record of.
 */
const details = (option: GrabOption) => {
    return [ option.languages.join("/").toUpperCase(), option.resolution, size(option.size), `${ option.seeders } seeders`, option.indexer ]
        .filter(Boolean)
        .join(" · ");
};

// what counts as this person's language here — one, or every one their account accepts
const wantedText = (preview: DownloadPreview) => preview.language.wanted.join("/").toUpperCase();

/**
 * A line's own name. The api builds it from season and episode numbers, which need no
 * translating — apart from exactly two words it can put in one, and this is where those
 * two are turned back into the reader's language.
 */
const lineLabel = (label: string, t: Translate) => {
    if (label === "Movie") {
        return t("common.movie");
    }

    return label.endsWith(" pack") ? `${ label.slice(0, -5) } ${ t("download.pack") }` : label;
};

const missingText = (preview: DownloadPreview, t: Translate) => {
    if (preview.missingMovie) {
        return t("common.film");
    }

    return preview.missing
        .map(season => `S${ String(season.seasonNumber).padStart(2, "0") } ${ season.episodeNumbers.map(v => `E${ String(v).padStart(2, "0") }`).join(", ") }`)
        .join(" · ");
};

function ChoiceRow({ choice, picked, onPick, single }: {
    choice: GrabChoice;
    picked: string;
    onPick: (guid: string) => void;
    single: boolean;
}) {
    const { t } = useLocale();

    // a single line has nothing to compare itself to, so it opens straight away
    const [ isOpen, setOpen ] = useState(single);

    const selected = choice.options.find(option => option.guid === picked) || choice.options[0];

    return (
        <div className="rounded-md border">
            <button
                type="button"
                className="flex w-full cursor-pointer items-start gap-2 p-3 text-left"
                onClick={() => setOpen(! isOpen)}
            >
                {isOpen ? <ChevronDown className="mt-0.5 size-4 shrink-0" /> : <ChevronRight className="mt-0.5 size-4 shrink-0" />}

                <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                        <span className="font-medium">{ lineLabel(choice.label, t) }</span>
                        <span className="text-xs text-muted-foreground">{ t("download.releases", { n: choice.options.length }) }</span>
                    </div>

                    <div className="truncate text-sm text-muted-foreground">{ selected?.title }</div>
                    <div className="text-xs text-muted-foreground">{ selected ? details(selected) : "" }</div>
                </div>
            </button>

            {isOpen && <div className="border-t p-1">
                {choice.options.map((option, index) => (
                    <button
                        key={option.guid}
                        type="button"
                        className={classNames(
                            "flex w-full cursor-pointer items-start gap-2 rounded-sm p-2 text-left hover:bg-muted",
                            { "bg-muted": option.guid === selected?.guid }
                        )}
                        onClick={() => onPick(option.guid)}
                    >
                        <Check className={classNames("mt-0.5 size-4 shrink-0", { "invisible": option.guid !== selected?.guid })} />

                        <div className="min-w-0 flex-1">
                            <div className="truncate text-sm">{ option.title }</div>
                            <div className="text-xs text-muted-foreground">
                                { details(option) }{ index === 0 ? ` · ${ t("download.bestMatch") }` : "" }
                            </div>
                        </div>
                    </button>
                ))}

                {choice.filtered > 0 && <div className="p-2 text-xs text-muted-foreground">
                    { t(choice.filtered === 1 ? "download.filteredOne" : "download.filtered", { n: choice.filtered }) }
                </div>}
            </div>}
        </div>
    );
}

/**
 * Every download goes through this: one line per torrent that would be added, with
 * the releases found for it and the quality profile's own pick preselected. What
 * could not be found at all is offered to the watchlist instead.
 */
export function ReleasePicker({ open, name, preview, isLoading, isStarting, picks, onPick, onCancel, onConfirm }: Props) {
    const { t } = useLocale();
    const [ watchMissing, setWatchMissing ] = useState(false);
    const [ acceptOtherLanguage, setAcceptOtherLanguage ] = useState(false);
    const [ acceptDuplicate, setAcceptDuplicate ] = useState(false);

    const choices = preview?.choices || [];
    const hasMissing = !! preview && (preview.missingMovie || preview.missing.length > 0);
    const held = preview?.held || [];

    // nothing left to offer because it is all already downloaded, which is a different
    // answer from "your indexers do not have it" and has to read like one
    const haveItAll = !! preview && choices.length === 0 && held.length > 0;
    const nothingFound = !! preview && choices.length === 0 && ! haveItAll;

    // Nothing here is in the language this account actually wants. Left alone, the
    // scanner would have gone on waiting for one — so starting anyway is a decision,
    // and it is asked for rather than assumed.
    const wrongLanguage = ! isLoading && ! nothingFound && ! haveItAll && (preview?.language.missing.length || 0) > 0;

    // a film that is already on the shelf can be fetched again — sometimes the first
    // copy is a bad rip — but not without saying so
    const duplicate = ! isLoading && choices.length > 0 && held.length > 0;

    const close = () => {
        setWatchMissing(false);
        setAcceptOtherLanguage(false);
        setAcceptDuplicate(false);
        onCancel();
    };

    const confirm = () => {
        const wanted = watchMissing;

        setWatchMissing(false);
        setAcceptOtherLanguage(false);
        setAcceptDuplicate(false);
        onConfirm(wanted);
    };

    return (
        <Dialog open={open} onOpenChange={(next) => { if (! next) { close(); } }}>
            <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
                <DialogHeader>
                    <DialogTitle>
                        { t(haveItAll ? "download.titleHave" : nothingFound ? "download.titleNothing" : "download.titleDownload", { name }) }
                    </DialogTitle>

                    <DialogDescription>
                        {isLoading && t("download.searching")}

                        {! isLoading && haveItAll && t("download.haveAll", {
                            lines: held.map(label => lineLabel(label, t)).join(", "),
                            languages: wantedText(preview!)
                        })}

                        {! isLoading && nothingFound && (preview && preview.filtered > 0
                            ? t("download.notFoundFiltered", { n: preview.filtered })
                            : t("download.notFound"))}

                        {! isLoading && ! nothingFound && ! haveItAll && t("download.pickHint")}
                    </DialogDescription>
                </DialogHeader>

                {isLoading && <div className="space-y-2">
                    {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}
                </div>}

                {! isLoading && choices.length > 0 && <div className="space-y-2">
                    {choices.map(choice => (
                        <ChoiceRow
                            key={choice.key}
                            choice={choice}
                            picked={picks[choice.key]}
                            single={choices.length === 1}
                            onPick={(guid) => onPick(choice.key, guid)}
                        />
                    ))}
                </div>}

                {duplicate && <div className="space-y-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3">
                    <div className="flex items-start gap-2 text-sm">
                        <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-500" />

                        <span>{ t("download.duplicate", {
                            lines: held.map(label => lineLabel(label, t)).join(", "),
                            languages: wantedText(preview!)
                        }) }</span>
                    </div>

                    <label className="flex cursor-pointer items-start gap-2 pl-6 text-sm">
                        <Checkbox
                            checked={acceptDuplicate}
                            onCheckedChange={(value) => setAcceptDuplicate(value === true)}
                            className="mt-0.5"
                        />

                        <span>{ t("download.duplicateAccept") }</span>
                    </label>
                </div>}

                {wrongLanguage && <div className="space-y-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3">
                    <div className="flex items-start gap-2 text-sm">
                        <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-500" />

                        <span>{ t("download.wrongLanguage", {
                            languages: wantedText(preview!),
                            lines: preview!.language.missing.map(label => lineLabel(label, t)).join(", ")
                        }) }</span>
                    </div>

                    <label className="flex cursor-pointer items-start gap-2 pl-6 text-sm">
                        <Checkbox
                            checked={acceptOtherLanguage}
                            onCheckedChange={(value) => setAcceptOtherLanguage(value === true)}
                            className="mt-0.5"
                        />

                        <span>{ t("download.wrongLanguageAccept") }</span>
                    </label>
                </div>}

                {! isLoading && hasMissing && ! nothingFound && <>
                    <Separator />

                    <label className="flex cursor-pointer items-start gap-2 text-sm">
                        <Checkbox
                            checked={watchMissing}
                            onCheckedChange={(value) => setWatchMissing(value === true)}
                            className="mt-0.5"
                        />

                        <span>{ t("download.watchMissing", { lines: missingText(preview!, t) }) }</span>
                    </label>
                </>}

                <DialogFooter>
                    <Button variant="outline" className="cursor-pointer" onClick={close}>
                        { nothingFound ? t("download.noThanks") : haveItAll ? t("download.close") : t("common.cancel") }
                    </Button>

                    {haveItAll
                        ? null
                        : nothingFound
                        ? <Button
                            className="cursor-pointer"
                            disabled={isStarting}
                            onClick={() => onConfirm(true)}
                        >
                            <Loader2 className={classNames("animate-spin", { "hidden": ! isStarting })} />
                            { t("download.addToWatchlist") }
                        </Button>
                        : <Button
                            className="cursor-pointer"
                            disabled={isLoading
                                || isStarting
                                || choices.length === 0
                                || (wrongLanguage && ! acceptOtherLanguage)
                                || (duplicate && ! acceptDuplicate)}
                            onClick={confirm}
                        >
                            <Loader2 className={classNames("animate-spin", { "hidden": ! isStarting })} />
                            { choices.length > 1 ? t("download.confirmMany", { n: choices.length }) : t("download.confirm") }
                        </Button>}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
