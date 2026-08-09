import { currentUser, needsSetup, passwordLoginAllowed } from "@/lib/auth";
import { isOidcEnabled, providerName } from "@/lib/oidc";
import { loadSettings } from "@/lib/settings";
import { AuthState } from "@/types/user";

/**
 * The one endpoint that answers without a session, because it is what the login page
 * is drawn from: whether this install has been claimed yet, and which ways in are on
 * offer. Nothing here is worth hiding — a login form is public by definition, and
 * refusing to say whether single sign-on exists would only mean a button that fails.
 */
export async function GET() {
    await loadSettings();

    const user = await currentUser();

    const state: AuthState = {
        needsSetup: await needsSetup(),
        passwordLogin: passwordLoginAllowed(),
        oidc: { enabled: isOidcEnabled(), name: providerName() },
        user: user
            ? {
                id: user.id,
                email: user.email,
                name: user.name,
                role: user.role,
                isAdmin: user.isAdmin,
                hasPassword: user.hasPassword,
                linkedToProvider: user.linkedToProvider
            }
            : null
    };

    return Response.json({ success: true, ...state });
}
