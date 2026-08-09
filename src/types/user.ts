export type UserRoleName = "ADMIN" | "USER";

export type UserItem = {
    id: number;
    email: string;
    name: string;
    role: UserRoleName;
    disabled: boolean;
    hasPassword: boolean;
    linkedToProvider: boolean;
    createdAt: string;
    lastLoginAt: string | null;
};

/** What the browser is told about itself and about the ways in that are on offer. */
export type AuthState = {
    needsSetup: boolean;
    passwordLogin: boolean;
    oidc: { enabled: boolean, name: string };
    user: {
        id: number;
        email: string;
        name: string;
        role: UserRoleName;
        isAdmin: boolean;
        hasPassword: boolean;
        linkedToProvider: boolean;
    } | null;
};
