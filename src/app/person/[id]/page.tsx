import { notFound } from "next/navigation";

import { getPersonBiography, getPersonDetails } from "@/lib/media";
import { PersonView } from "@/components/person-view";

/**
 * Server rendered like the title page, and for the same reason: the whole page is one
 * cached TMDB read, so waiting for javascript before starting it would only add a wait.
 */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const personId = Number(id);

    if (! personId) {
        notFound();
    }

    const person = await getPersonDetails(personId);

    if (! person) {
        notFound();
    }

    return (
        <PersonView
            person={person}
            // TMDB has few biographies translated, and an empty one would look like the
            // page failed rather than like nobody wrote it in this language
            biography={await getPersonBiography(person)}
        />
    );
}
