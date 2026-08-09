'use client';

import { Geist } from "next/font/google";
import { usePathname } from "next/navigation";
import { ThemeProvider } from "@/components/providers/theme-provider";
import { AppSidebar } from "@/components/app-sidebar";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import "./globals.css";
import { Separator } from "@radix-ui/react-separator";
import { SearchBar } from "@/components/searchbar";
import { ModeToggle } from "@/components/ui/mode-toggle";
import { Toaster } from "@/components/ui/sonner";
import { UserMenu } from "@/components/user-menu";
import { SessionProvider } from "@/context/session";
import { WatchlistProvider } from "@/context/watchlist";
import { DownloadProvider } from "@/context/download";

const geistSans = Geist({
    variable: "--font-geist-sans",
    subsets: ["latin"],
});

/**
 * The two pages that are reached without being signed in. They get no sidebar, no
 * search and none of the providers behind them — every one of those asks the server
 * for something the caller is not allowed to have yet, and a login page that fires
 * three 401s before it draws is a login page that looks broken.
 */
const BARE = [ "/login", "/setup" ];

export default function RootLayout({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {
    const pathname = usePathname();
    const bare = BARE.includes(pathname);

    return (
        <html lang="en" suppressHydrationWarning>
            <body className={`${geistSans.variable} antialiased`}>
                <ThemeProvider
                    attribute="class"
                    defaultTheme="system"
                    enableSystem
                    disableTransitionOnChange
                >
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
                                    </SidebarInset>
                                </SidebarProvider>
                            </DownloadProvider>
                        </WatchlistProvider>
                    </SessionProvider>}
                </ThemeProvider>
            </body>
        </html>
    );
}
