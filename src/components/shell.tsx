'use client';

import { usePathname } from "next/navigation";

import { ThemeProvider } from "@/components/providers/theme-provider";
import { AppSidebar } from "@/components/app-sidebar";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@radix-ui/react-separator";
import { SearchBar } from "@/components/searchbar";
import { ScrollRestoration } from "@/components/scroll-restoration";
import { ModeToggle } from "@/components/ui/mode-toggle";
import { Toaster } from "@/components/ui/sonner";
import { UserMenu } from "@/components/user-menu";
import { LocaleProvider } from "@/context/locale";
import { SessionProvider } from "@/context/session";
import { WatchlistProvider } from "@/context/watchlist";
import { DownloadProvider } from "@/context/download";
import { Locale } from "@/i18n";

/**
 * Everything inside `<body>`. It was the root layout itself until the interface learned a
 * second language: the chosen language lives in a cookie, only a server component may read
 * one, and `'use client'` on the layout meant nothing above this could.
 *
 * The two pages that are reached without being signed in get no sidebar, no search and none
 * of the providers behind them — every one of those asks the server for something the
 * caller is not allowed to have yet, and a login page that fires three 401s before it draws
 * is a login page that looks broken. The language provider is not one of those: it asks
 * nothing of anybody, and the login page has words on it too.
 */
const BARE = [ "/login", "/setup" ];

export function Shell({ locale, children }: { locale: Locale, children: React.ReactNode }) {
    const pathname = usePathname();
    const bare = BARE.includes(pathname);

    return (
        <ThemeProvider
            attribute="class"
            defaultTheme="system"
            enableSystem
            disableTransitionOnChange
        >
            <LocaleProvider initial={locale}>
                {bare && <>
                    { children }
                    <Toaster />
                </>}

                {! bare && <SessionProvider>
                    <WatchlistProvider>
                        <DownloadProvider>
                            <SidebarProvider>
                                <AppSidebar />

                                <SidebarInset>
                                    <header className="flex h-16 shrink-0 items-center gap-2 border-b px-4">
                                        <SidebarTrigger className="-ml-1" />

                                        <Separator
                                            orientation="vertical"
                                            className="mr-2 data-[orientation=vertical]:h-4"
                                        />

                                        <SearchBar />

                                        <div className="flex w-full items-center justify-end gap-1">
                                            <UserMenu />
                                            <ModeToggle />
                                        </div>
                                    </header>

                                    { children }
                                    <Toaster />

                                    {/* stepping back into a listing lands where you
                                        were, which no listing here can do on its own */}
                                    <ScrollRestoration />
                                </SidebarInset>
                            </SidebarProvider>
                        </DownloadProvider>
                    </WatchlistProvider>
                </SessionProvider>}
            </LocaleProvider>
        </ThemeProvider>
    );
}
