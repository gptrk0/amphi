'use client';

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useLocale } from "@/context/locale";
import { MediaVideo } from "@/types/media";

type Props = {
    video: MediaVideo | null;
    open: boolean;
    onOpenChange: (open: boolean) => void;
};

export function TrailerDialog({ video, open, onOpenChange }: Props) {
    const { t } = useLocale();

    return (
        <Dialog open={open && !! video} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-3xl">
                <DialogHeader>
                    <DialogTitle>{ video?.name || t("trailerDialog.title") }</DialogTitle>
                </DialogHeader>

                {video && <div className="aspect-video w-full overflow-hidden rounded-md">
                    {/* nocookie host, and only loaded once the dialog is open */}
                    <iframe
                        src={`https://www.youtube-nocookie.com/embed/${ video.key }?autoplay=1`}
                        title={video.name}
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                        allowFullScreen
                        className="size-full border-0"
                    />
                </div>}
            </DialogContent>
        </Dialog>
    );
}
