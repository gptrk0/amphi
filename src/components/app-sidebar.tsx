import * as React from "react"
import { usePathname } from "next/navigation";
import { Teko } from "next/font/google";

import {
    Sidebar,
    SidebarContent,
    SidebarFooter,
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

import { Button } from "@/components/ui/button";
import { useLocale } from "@/context/locale";
import { useSession } from "@/context/session";
import { LOCALES, LOCALE_NAMES, MessageKey } from "@/i18n";

const teko = Teko({ subsets: [ 'latin' ] });

// the labels are keys now, translated where they are drawn — a menu built at module load
// would be built once, in whatever language the first render happened to be in
const menus: {
    title: MessageKey,
    url: string,
    // hidden from a plain user, because every page under it answers them with a 403
    admin?: boolean,
    items: {
        title: MessageKey;
        url: string
    }[]
}[] = [
    {
        title: "nav.discover",
        url: "#",
        items: [
            {
                title: "nav.all",
                url: "/"
            },
            {
                title: "nav.movies",
                url: "/movies"
            },
            {
                title: "nav.series",
                url: "/series"
            }
        ]
    },
    {
        title: "nav.collection",
        url: "#",
        items: [
            {
                title: "nav.watchlist",
                url: "/watchlist"
            },
            {
                title: "nav.library",
                url: "/library"
            }
        ]
    },
    {
        title: "nav.admin",
        url: "#",
        admin: true,
        items: [
            {
                title: "nav.users",
                url: "/users"
            },
            {
                title: "nav.settings",
                url: "/settings"
            },
            {
                title: "nav.log",
                url: "/log"
            }
        ]
    }
];

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
    const pathname = usePathname();
    const { isAdmin } = useSession();
    const { isMobile, setOpenMobile } = useSidebar();
    const { locale, setLocale, t } = useLocale();

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
                        <SidebarGroupLabel>{ t(item.title) }</SidebarGroupLabel>

                        <SidebarGroupContent>
                            <SidebarMenu>
                                {item.items.map((item, i) => (
                                    <SidebarMenuItem key={i}>
                                        <SidebarMenuButton asChild isActive={ pathname === item.url }>
                                            {/* onClick as well as the effect below: tapping the page
                                                you are already on changes no pathname, and the sheet
                                                would sit there as if the tap had missed */}
                                            <Link href={ item.url } onClick={leave}>
                                                { t(item.title) }
                                            </Link>
                                        </SidebarMenuButton>
                                    </SidebarMenuItem>
                                ))}
                            </SidebarMenu>
                        </SidebarGroupContent>
                    </SidebarGroup>
                ))}
            </SidebarContent>

            {/* At the bottom, because it is set once and then never again — and in every
                language's own name, since somebody looking for Hungarian is looking for
                "Magyar". Two languages is two buttons; a dropdown for two things is a
                click to find out what the two things are. */}
            <SidebarFooter>
                <div className="space-y-1 px-2 pb-1">
                    <span className="text-muted-foreground text-xs">{ t("nav.language") }</span>

                    <div className="flex gap-1">
                        {LOCALES.map(code => (
                            <Button
                                key={code}
                                size="sm"
                                variant={locale === code ? "default" : "outline"}
                                className="flex-1 cursor-pointer"
                                onClick={() => setLocale(code)}
                            >
                                { LOCALE_NAMES[code] }
                            </Button>
                        ))}
                    </div>
                </div>
            </SidebarFooter>

            <SidebarRail />
        </Sidebar>
    )
}
