'use client';

import Image from "next/image";
import Link from "next/link";
import { User } from "lucide-react";

import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { MediaPerson } from "@/types/media";

type Props = {
    title: string;
    people: MediaPerson[];
};

export function CastRow({ title, people }: Props) {
    if (people.length === 0) {
        return null;
    }

    return (
        <div className="space-y-3">
            <h3 className="text-lg font-semibold tracking-tight">{ title }</h3>

            <ScrollArea>
                <div className="flex space-x-4 pb-4">
                    {/* the whole card is the link, poster included: on this row the face is
                        what people aim at, not the name under it */}
                    {people.map(person => (
                        <Link
                            key={`${ person.id }-${ person.role }`}
                            href={`/person/${ person.id }`}
                            className="group w-[120px] shrink-0 space-y-2"
                        >
                            {person.profile_img
                                ? <Image
                                    src={person.profile_img}
                                    alt={person.name}
                                    width={120}
                                    height={180}
                                    className="aspect-[2/3] w-full rounded-md object-cover transition-opacity group-hover:opacity-80"
                                />
                                : <div className="flex aspect-[2/3] w-full items-center justify-center rounded-md bg-muted transition-colors group-hover:bg-muted/70">
                                    <User className="size-8 text-muted-foreground" />
                                </div>}

                            <div className="space-y-0.5">
                                <div className="text-sm font-medium leading-tight group-hover:underline">{ person.name }</div>
                                <div className="text-xs leading-tight text-muted-foreground">{ person.role }</div>
                            </div>
                        </Link>
                    ))}
                </div>

                <ScrollBar orientation="horizontal" />
            </ScrollArea>
        </div>
    );
}
