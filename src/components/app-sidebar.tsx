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
    useSidebar,
} from "@/components/ui/sidebar"
import Link from "next/link";
import classNames from "classnames";

import { useSession } from "@/context/session";

const teko = Teko({ subsets: [ 'latin' ] });

const menus: {
    title: string,
    url: string,
    // hidden from a plain user, because every page under it answers them with a 403
    admin?: boolean,
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
    },
    {
        title: "ADMIN",
        url: "#",
        admin: true,
        items: [
            {
                title: "Users",
                url: "/users"
            },
            {
                title: "Settings",
                url: "/settings"
            },
            {
                title: "Log",
                url: "/log"
            }
        ]
    }
];

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
    const pathname = usePathname();
    const { isAdmin } = useSession();
    const { isMobile, setOpenMobile } = useSidebar();

    const visible = menus.filter(menu => ! menu.admin || isAdmin);

    /**
     * On a phone this sidebar is a sheet over the whole screen, so leaving it open after
     * a tap means the page you just asked for is behind it and the next thing you do is
     * dismiss it by hand. On a desktop it is a column next to the page and closing it
     * would be the wrong answer, hence the check.
     */
    const leave = () => {
        if (isMobile) {
            setOpenMobile(false);
        }
    };

    // the backstop: anything that navigates while the sheet is open — a link somewhere
    // inside it, the browser's own history — ends up here too
    React.useEffect(() => {
        setOpenMobile(false);
    }, [ pathname, setOpenMobile ]);

    return (
        <Sidebar {...props}>
            <SidebarHeader className="px-5 pt-4 pb-2">
                {/* the name at the top of a page is a way home everywhere else on the web */}
                <Link href="/" className={classNames(teko.className, "text-5xl text-center")} onClick={leave}>
                    aioseerr
                </Link>
            </SidebarHeader>

            <SidebarContent>
                {visible.map((item, i) => (
                    <SidebarGroup key={i}>
                        <SidebarGroupLabel>{item.title}</SidebarGroupLabel>

                        <SidebarGroupContent>
                            <SidebarMenu>
                                {item.items.map((item, i) => (
                                    <SidebarMenuItem key={i}>
                                        <SidebarMenuButton asChild isActive={ pathname === item.url }>
                                            {/* onClick as well as the effect below: tapping the page
                                                you are already on changes no pathname, and the sheet
                                                would sit there as if the tap had missed */}
                                            <Link href={ item.url } onClick={leave}>
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
