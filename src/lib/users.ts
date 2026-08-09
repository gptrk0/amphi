import { User, UserRole } from "../../prisma/generated/client";
import { prisma } from "@/lib/prisma";
import { endAllSessions } from "@/lib/auth";
import { hashPassword, passwordProblem } from "@/lib/password";
import { UserItem } from "@/types/user";

/**
 * The accounts themselves. The rule that runs through all of it: **the last
 * administrator cannot be taken away** — not by demotion, not by disabling, not by
 * deletion, and not by an identity provider whose group mapping was typed in wrong.
 * There is no console to recover from, so an install with nobody who can reach the
 * settings page is an install that has to be fixed in the database by hand.
 */

export class UserError extends Error {}

const normalize = (email: string) => email.trim().toLowerCase();

// deliberately loose: the address is an identifier here, and a rule strict enough to
// argue with is a rule that rejects somebody's real address
const looksLikeEmail = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

export const toUserItem = (user: User): UserItem => ({
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    disabled: user.disabled,
    hasPassword: !! user.passwordHash,
    linkedToProvider: !! user.oidcSubject,
    createdAt: user.createdAt.toISOString(),
    lastLoginAt: user.lastLoginAt ? user.lastLoginAt.toISOString() : null
});

export const listUsers = async () => {
    const users = await prisma.user.findMany({ orderBy: [ { role: "asc" }, { email: "asc" } ] });

    return users.map(toUserItem);
};

const otherAdmins = async (exceptId: number) => {
    return await prisma.user.count({
        where: { role: UserRole.ADMIN, disabled: false, id: { not: exceptId } }
    });
};

/** Throws if this change would leave the install with nobody who can administer it. */
const keepAnAdmin = async (user: User, message: string) => {
    if (user.role !== UserRole.ADMIN || user.disabled) {
        return;
    }

    if (await otherAdmins(user.id) === 0) {
        throw new UserError(message);
    }
};

export const createUser = async (input: {
    email: string;
    name: string;
    password?: string;
    role?: UserRole;
}) => {
    const email = normalize(input.email);
    const name = input.name.trim();

    if (! looksLikeEmail(email)) {
        throw new UserError("That does not look like an email address.");
    }

    if (! name) {
        throw new UserError("A name, please — it is what the log will call them.");
    }

    if (await prisma.user.findUnique({ where: { email } })) {
        throw new UserError("Somebody already has that address.");
    }

    // no password is a real choice: an account that only ever arrives through the
    // provider has nothing to guess
    let passwordHash: string | null = null;

    if (input.password) {
        const problem = passwordProblem(input.password);

        if (problem) {
            throw new UserError(problem);
        }

        passwordHash = await hashPassword(input.password);
    }

    return await prisma.user.create({
        data: {
            email,
            name,
            role: input.role || UserRole.USER,
            passwordHash
        }
    });
};

/** The first account, and the only one that is created without anybody being signed in. */
export const createFirstAdmin = async (input: { email: string, name: string, password: string }) => {
    if (await prisma.user.count() > 0) {
        throw new UserError("This install already has an administrator.");
    }

    if (! input.password) {
        throw new UserError("Pick a password.");
    }

    return await createUser({ ...input, role: UserRole.ADMIN });
};

export const updateUser = async (id: number, changes: {
    name?: string;
    role?: UserRole;
    disabled?: boolean;
    password?: string | null;
}) => {
    const user = await prisma.user.findUnique({ where: { id } });

    if (! user) {
        throw new UserError("No such user.");
    }

    if (changes.role !== undefined && changes.role !== user.role) {
        await keepAnAdmin(user, "This is the only administrator left — make somebody else one first.");
    }

    if (changes.disabled === true && ! user.disabled) {
        await keepAnAdmin(user, "This is the only administrator left, so switching them off would lock everybody out.");
    }

    const data: Record<string, unknown> = {};

    if (changes.name !== undefined) {
        if (! changes.name.trim()) {
            throw new UserError("A name, please — it is what the log will call them.");
        }

        data.name = changes.name.trim();
    }

    if (changes.role !== undefined) {
        data.role = changes.role;
    }

    if (changes.disabled !== undefined) {
        data.disabled = changes.disabled;
    }

    if (changes.password !== undefined) {
        if (changes.password === null || changes.password === "") {
            if (! user.oidcSubject) {
                throw new UserError("Taking the password away would leave no way to sign in to this account.");
            }

            data.passwordHash = null;

        } else {
            const problem = passwordProblem(changes.password);

            if (problem) {
                throw new UserError(problem);
            }

            data.passwordHash = await hashPassword(changes.password);
        }
    }

    const updated = await prisma.user.update({ where: { id }, data });

    // a password change and a switch-off both mean "not this browser any more", and a
    // session that survived either would be the hole they were meant to close
    if (changes.password !== undefined || changes.disabled === true) {
        await endAllSessions(id);
    }

    return updated;
};

export const deleteUser = async (id: number) => {
    const user = await prisma.user.findUnique({ where: { id } });

    if (! user) {
        throw new UserError("No such user.");
    }

    await keepAnAdmin(user, "This is the only administrator left and cannot be deleted.");

    // the sessions go with the row through the foreign key
    return await prisma.user.delete({ where: { id } });
};
