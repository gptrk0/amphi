'use client';

import Image from "next/image";
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
                    {people.map(person => (
                        <div key={`${ person.id }-${ person.role }`} className="w-[120px] shrink-0 space-y-2">
                            {person.profile_img
                                ? <Image
                                    src={person.profile_img}
                                    alt={person.name}
                                    width={120}
                                    height={180}
                                    className="aspect-[2/3] w-full rounded-md object-cover"
                                />
                                : <div className="flex aspect-[2/3] w-full items-center justify-center rounded-md bg-muted">
                                    <User className="size-8 text-muted-foreground" />
                                </div>}

                            <div className="space-y-0.5">
                                <div className="text-sm font-medium leading-tight">{ person.name }</div>
                                <div className="text-xs leading-tight text-muted-foreground">{ person.role }</div>
                            </div>
                        </div>
                    ))}
                </div>

                <ScrollBar orientation="horizontal" />
            </ScrollArea>
        </div>
    );
}
