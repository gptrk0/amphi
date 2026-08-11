'use client';

import { useMemo } from "react";

import { useLocale } from "@/context/locale";
import { MessageKey } from "@/i18n";
import { NOTIFY_EVENTS } from "@/types/notify";

/**
 * The events people can ask to hear about, read in the language of the page. The stored
 * value is still the event's `value` — `ready`, `started`, `dropped`, `deleted` — because
 * that is what the notifier compares against, and a word somebody translated is not a key.
 */
export const useNotifyOptions = () => {
    const { t } = useLocale();

    return useMemo(() => NOTIFY_EVENTS.map(event => ({
        value: event.value,
        label: t(`notify.${ event.value }.label` as MessageKey),
        help: t(`notify.${ event.value }.help` as MessageKey)
    })), [ t ]);
};
