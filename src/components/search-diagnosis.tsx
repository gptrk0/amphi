'use client';

import { useEffect, useState } from "react";
import axios from "axios";
import { Check, ChevronDown, ChevronRight, Loader2, X } from "lucide-react";
import classNames from "classnames";

import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { useLocale } from "@/context/locale";
import { MessageKey, Translate } from "@/i18n";
import { CheckStep, DiagnosisLine, ReleaseTrace, WatchlistDiagnosis } from "@/types/diagnosis";

const GB = 1024 * 1024 * 1024;

const size = (bytes: number) => {
    return bytes >= GB ? `${ (bytes / GB).toFixed(1) } GB` : `${ Math.round(bytes / (1024 * 1024)) } MB`;
};

const STEPS: Record<CheckStep, MessageKey> = {
    numbering: "diagnosis.steps.numbering",
    link: "diagnosis.steps.link",
    blocked: "diagnosis.steps.blocked",
    seeders: "diagnosis.steps.seeders",
    maxSize: "diagnosis.steps.maxSize",
    keywords: "diagnosis.steps.keywords",
    title: "diagnosis.steps.title",
    languageExcluded: "diagnosis.steps.languageExcluded",
    languageRequired: "diagnosis.steps.languageRequired",
    resolution: "diagnosis.steps.resolution",
    minSize: "diagnosis.steps.minSize"
};

const meta = (trace: ReleaseTrace) => {
    return [
        trace.languages.join("/").toUpperCase(),
        trace.resolution,
        size(trace.size),
        `${ trace.seeders } seeders`,
        trace.indexer
    ].filter(Boolean).join(" · ");
};

/**
 * One release and the questions it was put to.
 *
 * The verdict line is the summary somebody came for — "thrown away by: is it this title?"
 * — and the checks underneath are the evidence, folded away because thirty releases times
 * eleven checks is not a page. A release that got through opens to the same list, all
 * ticks: that one is worth reading too, because it answers "so why was *this* not taken"
 * when something else was.
 */
function ReleaseRow({ trace }: { trace: ReleaseTrace }) {
    const { t } = useLocale();
    const [ isOpen, setOpen ] = useState(false);

    const failed = trace.steps.filter(step => ! step.ok);
    const accepted = failed.length === 0;

    return (
        <div className="border-b py-2 last:border-b-0">
            <div className="min-w-0 text-sm break-all" title={trace.title}>{ trace.title }</div>
            <div className="text-xs text-muted-foreground">{ meta(trace) }</div>

            <div className={classNames("mt-0.5 text-xs", accepted ? "text-emerald-600 dark:text-emerald-500" : "text-amber-500")}>
                { accepted
                    ? t("diagnosis.passed", { score: trace.score ?? 0 })
                    : t("diagnosis.failedAt", { steps: failed.map(step => t(STEPS[step.step])).join(", ") }) }
            </div>

            <button
                type="button"
                className="mt-1 flex cursor-pointer items-center gap-1 text-xs text-muted-foreground hover:underline"
                onClick={() => setOpen(prev => ! prev)}
            >
                {isOpen ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
                { t(isOpen ? "diagnosis.hideSteps" : "diagnosis.showSteps") }
            </button>

            {isOpen && <div className="mt-1 flex flex-col gap-0.5 pl-4">
                {trace.steps.map(step => (
                    <div key={step.step} className="flex items-start gap-2 text-xs">
                        {step.ok
                            ? <Check className="mt-0.5 size-3 shrink-0 text-emerald-600 dark:text-emerald-500" />
                            : <X className="mt-0.5 size-3 shrink-0 text-amber-500" />}

                        <span className="shrink-0">{ t(STEPS[step.step]) }</span>
                        {/* the server's own words, with the numbers in them — a record of
                            a run, like the log, so it is not translated */}
                        <span className="min-w-0 text-muted-foreground">{ step.detail }</span>
                    </div>
                ))}
            </div>}
        </div>
    );
}

function Line({ line, t }: { line: DiagnosisLine, t: Translate }) {
    return (
        <div className="space-y-1">
            <div className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-medium">{ line.label }</span>

                <span className="text-xs text-muted-foreground">
                    { line.found === 0 ? t("diagnosis.foundNone") : t("diagnosis.found", { n: line.found }) }
                    { line.found > 0 ? ` — ${ line.accepted === 0 ? t("diagnosis.acceptedNone") : t("diagnosis.accepted", { n: line.accepted }) }` : "" }
                    { line.releases.length < line.found ? ` · ${ t("diagnosis.shown", { n: line.releases.length }) }` : "" }
                </span>
            </div>

            <div className="text-xs break-all text-muted-foreground">{ t("diagnosis.query", { query: line.query }) }</div>

            {line.releases.length > 0 && <div className="rounded-sm border px-3">
                {line.releases.map(trace => <ReleaseRow key={`${ trace.indexer }:${ trace.title }`} trace={trace} />)}
            </div>}
        </div>
    );
}

type Props = {
    // the row to explain; null closes the dialog
    watchlistId: number | null;
    name: string;
    onClose: () => void;
};

/**
 * Administrators only, and opened from the watchlist — see the api route. It searches on
 * open rather than on a button inside, because the dialog has nothing to show until it
 * has, and an empty dialog with a "search" button in it is one more click before the only
 * thing anybody opened it for.
 */
export function SearchDiagnosis({ watchlistId, name, onClose }: Props) {
    const { t } = useLocale();
    const [ result, setResult ] = useState<WatchlistDiagnosis | null>(null);
    const [ isLoading, setLoading ] = useState(false);
    const [ error, setError ] = useState("");

    useEffect(() => {
        if (! watchlistId) {
            return;
        }

        // every open is a fresh search: the whole point is what the indexers say *now*
        setResult(null);
        setError("");
        setLoading(true);

        let current = true;

        axios.get(`/api/watchlist/${ watchlistId }/diagnose`)
            .then(res => {
                if (current) {
                    setResult(res.data.result);
                }
            })
            .catch(err => {
                console.error(err);

                if (current) {
                    setError(axios.isAxiosError(err) && err.response?.data?.message || t("diagnosis.failed"));
                }
            })
            .finally(() => {
                if (current) {
                    setLoading(false);
                }
            });

        return () => {
            current = false;
        };
        // `t` is read only inside the handlers and would re-run this on a language
        // change, which is a second round of every indexer for a translated error
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [ watchlistId ])

    return (
        <Dialog open={!! watchlistId} onOpenChange={(open) => ! open && onClose()}>
            <DialogContent className="max-h-[85vh] overflow-x-hidden overflow-y-auto sm:max-w-3xl">
                <DialogHeader>
                    <DialogTitle>{ t("diagnosis.title", { name }) }</DialogTitle>
                    <DialogDescription>{ t("diagnosis.description") }</DialogDescription>
                </DialogHeader>

                {isLoading && <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
                    <Loader2 className="size-4 animate-spin" /> { t("diagnosis.running") }
                </div>}

                {error && <p className="py-4 text-sm text-amber-500">{ error }</p>}

                {result && <div className="space-y-4">
                    <div className="space-y-2 text-sm">
                        <div>
                            <div className="font-medium">{ t("diagnosis.titles") }</div>

                            {result.titles.map(title => (
                                <div key={title.normalized} className="text-xs">
                                    <span className="break-all">{ title.name }</span>
                                    <span className="text-muted-foreground"> → </span>
                                    <span className="font-mono break-all text-muted-foreground">{ title.normalized }</span>
                                </div>
                            ))}

                            <p className="mt-1 text-xs text-muted-foreground">{ t("diagnosis.titlesHint") }</p>
                        </div>

                        <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted-foreground">
                            <span>
                                { t("diagnosis.language") }: { result.languages.length > 0
                                    ? result.languages.join("/").toUpperCase()
                                    : t("diagnosis.languageAny") }
                            </span>

                            <span>{ t("diagnosis.imdb") }: { result.imdbId || t("diagnosis.imdbNone") }</span>
                        </div>
                    </div>

                    <Separator />

                    {result.lines.length === 0
                        ? <p className="text-sm text-muted-foreground">{ t("diagnosis.empty") }</p>
                        : result.lines.map(line => <Line key={line.key} line={line} t={t} />)}

                    {result.skipped > 0 && (
                        <p className="text-xs text-muted-foreground">{ t("diagnosis.skipped", { n: result.skipped }) }</p>
                    )}
                </div>}

                <DialogFooter>
                    <Button variant="outline" className="cursor-pointer" onClick={onClose}>
                        { t("diagnosis.close") }
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
