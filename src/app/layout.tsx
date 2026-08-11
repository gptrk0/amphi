import { Geist } from "next/font/google";

import { Shell } from "@/components/shell";
import { readerLocale } from "@/lib/locale";
import "./globals.css";

const geistSans = Geist({
    variable: "--font-geist-sans",
    subsets: ["latin"],
});

/**
 * A server component again, for one reason: the chosen language is in a cookie, and only
 * this side can read one. Everything it used to do is in `Shell`, which is still a client
 * component — so the whole app is drawn in the right language on the first paint and
 * `<html lang>` says which one it is.
 *
 * The same `readerLocale` the TMDB reads go through, so the metadata on a page and the words
 * around it can never end up in two different languages.
 */
export default async function RootLayout({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {
    const locale = await readerLocale();

    return (
        <html lang={locale} suppressHydrationWarning>
            <body className={`${geistSans.variable} antialiased`}>
                <Shell locale={locale}>{ children }</Shell>
            </body>
        </html>
    );
}
