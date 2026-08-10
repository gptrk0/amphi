-- Three OpenID Connect settings that stopped being settings: the scopes (always
-- `openid profile email`), the claim the groups are read from (all the known ones are
-- read), and the name on the login button. The registry no longer knows these keys, so a
-- row left behind is a value nothing reads — and one that would come back to life,
-- silently, if a later version ever used the same key for something else.

-- No schema change, and nothing to undo: every one of them is derivable again from the
-- code that replaced it.
DELETE FROM "Setting" WHERE "key" IN ('AUTH_OIDC_SCOPES', 'AUTH_OIDC_GROUPS_CLAIM', 'AUTH_OIDC_NAME');
