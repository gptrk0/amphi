'use client';

import axios from "axios";
import { toast } from "sonner";

import { useWatchlist } from "@/context/watchlist";
import { Media } from "@/types/media";

/**
 * Movie download from a card or the billboard: if nothing is available the toast
 * offers the watchlist instead. Series go through the detail page, where the
 * seasons are picked first.
 */
export const useDownload = () => {
    const { add } = useWatchlist();

    return (media: Media) => {
        toast(`Searching indexers for ${ media.name }...`);

        axios.post("/api/download", { type: media.type, id: media.id })
            .then(res => {
                if (res.data.missingMovie) {
                    toast(res.data.message, {
                        action: {
                            label: "Add to watchlist",
                            onClick: () => add(media.type, media.id, media.name)
                        }
                    });

                    return;
                }

                if (res.data.message) {
                    toast(res.data.message);
                }
            })
            .catch(err => {
                console.error(err);
                toast(err.response?.data?.message || "Could not start the download.");
            });
    };
};
