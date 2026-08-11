import { cookies } from "next/headers";
import { Geist } from "next/font/google";

import { Shell } from "@/components/shell";
import { localeFrom, LOCALE_COOKIE } from "@/i18n";
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
 */
export default async function RootLayout({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {
    const locale = localeFrom((await cookies()).get(LOCALE_COOKIE)?.value);

    return (
        <html lang={locale} suppressHydrationWarning>
            <body className={`${geistSans.variable} antialiased`}>
                <Shell locale={locale}>{ children }</Shell>
            </body>
        </html>
    );
}
