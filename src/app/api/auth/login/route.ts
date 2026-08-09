import { passwordLoginAllowed, signInWithPassword, startSession } from "@/lib/auth";
import { logInfo, logWarn } from "@/lib/log";
import { loadSettings } from "@/lib/settings";

/**
 * Guessing costs something. Ten wrong answers for one address and it stops answering
 * for a quarter of an hour — held in memory on purpose: this is about the machine
 * that is being hammered right now, and a restart clearing it is fine.
 */
const FAILURE_LIMIT = 10;
const FAILURE_WINDOW_MS = 15 * 60 * 1000;

const globalForLogin = global as unknown as { loginFailures: Map<string, number[]> };
const failures: Map<string, number[]> = globalForLogin.loginFailures || new Map();
globalForLogin.loginFailures = failures;

const recent = (key: string) => {
    const times = (failures.get(key) || []).filter(at => Date.now() - at < FAILURE_WINDOW_MS);

    if (times.length > 0) {
        failures.set(key, times);

    } else {
        failures.delete(key);
    }

    return times;
};

export async function POST(req: Request) {
    try {
        await loadSettings();

        const body = await req.json().catch(() => null);
        const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
        const password = typeof body?.password === "string" ? body.password : "";

        if (! email || ! password) {
            return Response.json({ success: false, message: "Both an email and a password, please." }, { status: 400 });
        }

        if (! passwordLoginAllowed()) {
            return Response.json({ success: false, message: "Passwords are switched off here — use single sign-on." }, { status: 403 });
        }

        if (recent(email).length >= FAILURE_LIMIT) {
            await logWarn("auth", `too many failed sign-ins for ${ email }`, "the address is locked out for fifteen minutes");

            return Response.json({ success: false, message: "Too many attempts. Try again in a few minutes." }, { status: 429 });
        }

        const user = await signInWithPassword(email, password);

        if (! user) {
            failures.set(email, [ ...recent(email), Date.now() ]);

            await logWarn("auth", `a sign-in failed for ${ email }`);

            // never which half was wrong: that is how a login form becomes a way to
            // find out which addresses have accounts
            return Response.json({ success: false, message: "That email and password do not match." }, { status: 401 });
        }

        failures.delete(email);

        await startSession(user.id);
        await logInfo("auth", `${ user.email } signed in`, "with a password");

        return Response.json({ success: true });

    } catch(err) {
        console.error(err);

        return Response.json({ success: false, message: "Signing in failed." }, { status: 500 });
    }
}
