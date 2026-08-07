import * as React from "react"
import { usePathname } from "next/navigation";
import { Teko } from "next/font/google";

import {
    Sidebar,
    SidebarContent,
    SidebarGroup,
    SidebarGroupContent,
    SidebarGroupLabel,
    SidebarHeader,
    SidebarMenu,
    SidebarMenuButton,
    SidebarMenuItem,
    SidebarRail,
} from "@/components/ui/sidebar"
import Link from "next/link";
import classNames from "classnames";

const teko = Teko({ subsets: [ 'latin' ] });

const menus: {
    title: string,
    url: string,
    items: {
        title: string;
        url: string
    }[]
}[] = [
    {
        title: "DISCOVER",
        url: "#",
        items: [
            {
                title: "All",
                url: "/"
            },
            {
                title: "Movies",
                url: "/movies"
            },
            {
                title: "Series",
                url: "/series"
            }
        ]
    },
    {
        title: "LIBRARY",
        url: "#",
        items: [
            {
                title: "Watchlist",
                url: "/watchlist"
            },
            {
                title: "Library",
                url: "/library"
            }
        ]
    }
];

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
    const pathname = usePathname();

    return (
        <Sidebar {...props}>
            <SidebarHeader className="px-5 pt-4 pb-2">
                <span className={classNames(teko.className, "text-5xl text-center")}>aioseerr</span>
            </SidebarHeader>

            <SidebarContent>
                {menus.map((item, i) => (
                    <SidebarGroup key={i}>
                        <SidebarGroupLabel>{item.title}</SidebarGroupLabel>

                        <SidebarGroupContent>
                            <SidebarMenu>
                                {item.items.map((item, i) => (
                                    <SidebarMenuItem key={i}>
                                        <SidebarMenuButton asChild isActive={ pathname === item.url }>
                                            <Link href={ item.url }>
                                                { item.title }
                                            </Link>
                                        </SidebarMenuButton>
                                    </SidebarMenuItem>
                                ))}
                            </SidebarMenu>
                        </SidebarGroupContent>
                    </SidebarGroup>
                ))}
            </SidebarContent>

            <SidebarRail />
        </Sidebar>
    )
}
