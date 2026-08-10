/**
 * What there is to hear about, in one place. Three things read this list and must not
 * drift apart: the install's own events in the settings registry, a person's
 * `notifyEvents` on their account, and the two forms that tick them.
 *
 * The stored value is still a comma separated list of these `value`s — `*` means all of
 * them, which is what an install that asked for everything before this had — so nothing
 * about the storage changed when the boxes replaced the text field.
 */
export const NOTIFY_EVENTS = [
    { value: "ready", label: "Ready to watch", help: "a download finished and can be watched" },
    { value: "started", label: "Download started", help: "the scanner grabbed something, or somebody asked for it by hand" },
    { value: "dropped", label: "Release dropped", help: "a grab turned out to be fake or dead and went back to being searched for" },
    { value: "deleted", label: "Deleted", help: "a download left the library, by hand or because its time was up" }
] as const;

export type NotifyEvent = typeof NOTIFY_EVENTS[number]["value"];

export const NOTIFY_EVENT_VALUES: string[] = NOTIFY_EVENTS.map(event => event.value);
