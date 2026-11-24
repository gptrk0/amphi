import type { Metadata, Viewport } from "next";
import { Geist } from "next/font/google";

import { Shell } from "@/components/shell";
import { readerLocale } from "@/lib/locale";
import "./globals.css";

const geistSans = Geist({
    variable: "--font-geist-sans",
    subsets: ["latin"],
});

/**
 * What the page says about itself before anybody has signed in. The title is the first
 * of these the app ever had: it had been running as "Create Next App" for as long as
 * there were tabs to read it in, which nobody notices on a desktop and everybody notices
 * the moment the name ends up under an icon on a home screen.
 *
 * The rest is what turns the page into something a phone will install. `appleWebApp` is
 * iOS's half of the manifest — Android reads `app/manifest.ts` and Safari does not, so
 * the name on the home screen has to be stated twice. `black-translucent` lets the app
 * draw underneath the status bar, which is the look worth having and the reason the
 * header and the sidebar pad themselves with `env(safe-area-inset-top)`: without that
 * padding the clock sits on top of the search field.
 */
export const metadata: Metadata = {
    title: "Amphi",
    description: "Browse films and series, put them on a watchlist, and let the box fetch them on its own.",
    applicationName: "Amphi",
    appleWebApp: {
        capable: true,
        title: "Amphi",
        statusBarStyle: "black-translucent"
    },
    icons: {
        icon: [ { url: "/icon-192.png", sizes: "192x192", type: "image/png" } ],
        apple: [ { url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" } ]
    },
    // Next writes the standard `mobile-web-app-capable` and no longer the apple spelling
    // of it, which is right and is also not what an iPhone on iOS 16 or 17 reads. Both
    // say the same thing, the old one costs a line, and the phones that need it are
    // exactly the ones nobody upgrades.
    other: { "apple-mobile-web-app-capable": "yes" }
};

/**
 * `viewport-fit=cover` is what makes `env(safe-area-inset-*)` anything other than zero,
 * so it is the switch the whole safe area arrangement hangs on.
 *
 * The theme colour is given twice because the app follows the system theme and this is
 * the one piece of chrome the browser paints itself: one value would mean a white bar
 * above a black app on half the phones that open it. The manifest cannot do this — it
 * takes a single colour — which is why the two files disagree and should.
 */
export const viewport: Viewport = {
    width: "device-width",
    initialScale: 1,
    viewportFit: "cover",
    themeColor: [
        { media: "(prefers-color-scheme: light)", color: "#ffffff" },
        { media: "(prefers-color-scheme: dark)", color: "#030712" }
    ]
};

/**
 * A server component again, for one reason: the chosen language is in a cookie, and only
 * this side can read one. Everything it used to do is in `Shell`, which is still a client
 * component — so the whole app is drawn in the right language on the first paint and
 * `<html lang>` says which one it is.
 *
 * The same `readerLocale` the TMDB reads go through, so the metadata a page shows and the
 * words around it can never end up in two different languages.
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
