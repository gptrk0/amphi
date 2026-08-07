'use client';

import { Geist } from "next/font/google";
import { ThemeProvider } from "@/components/providers/theme-provider";
import { AppSidebar } from "@/components/app-sidebar";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import "./globals.css";
import { Separator } from "@radix-ui/react-separator";
import { SearchBar } from "@/components/searchbar";
import { ModeToggle } from "@/components/ui/mode-toggle";
import { Toaster } from "@/components/ui/sonner";
import { WatchlistProvider } from "@/context/watchlist";
import { DownloadProvider } from "@/context/download";

const geistSans = Geist({
    variable: "--font-geist-sans",
    subsets: ["latin"],
});

export default function RootLayout({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {
    return (
        <html lang="en" suppressHydrationWarning>
            <body className={`${geistSans.variable} antialiased`}>
                <ThemeProvider
                    attribute="class"
                    defaultTheme="system"
                    enableSystem
                    disableTransitionOnChange
                >
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

                                        <div className="flex justify-end w-full">
                                            <ModeToggle />
                                        </div>
                                    </header>

                                    { children }
                                    <Toaster />
                                </SidebarInset>
                            </SidebarProvider>
                        </DownloadProvider>
                    </WatchlistProvider>
                </ThemeProvider>
            </body>
        </html>
    );
}
