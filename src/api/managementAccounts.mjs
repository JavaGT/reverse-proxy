import { authDb } from "@javagt/express-easy-auth";

/**
 * Lists management UI accounts (express-easy-auth `users` table). No password material.
 * @returns {Array<{ id: string, username: string, email: string, totpEnabled: boolean, mfaRequired: boolean, passkeyCount: number, createdAt: number, updatedAt: number }>}
 */
export function listManagementAccounts() {
    const rows = authDb
        .prepare(
            `SELECT u.id, u.username, u.email, u.totp_enabled, u.mfa_required, u.created_at, u.updated_at,
            (SELECT COUNT(*) FROM passkeys p WHERE p.user_id = u.id) AS passkey_count
            FROM users u
            ORDER BY u.username COLLATE NOCASE`
        )
        .all();
    return rows.map(r => ({
        id: r.id,
        username: r.username,
        email: r.email,
        totpEnabled: !!r.totp_enabled,
        mfaRequired: !!r.mfa_required,
        passkeyCount: Number(r.passkey_count) || 0,
        createdAt: r.created_at,
        updatedAt: r.updated_at
    }));
}

/**
 * @param {string} userId
 * @returns {{ ok: true } | { ok: false, code: "NOT_FOUND" | "LAST_ACCOUNT" }}
 */
export function deleteManagementAccount(userId) {
    if (typeof userId !== "string" || !userId.trim()) {
        return { ok: false, code: "NOT_FOUND" };
    }
    const id = userId.trim();
    const found = authDb.prepare("SELECT id FROM users WHERE id = ?").get(id);
    if (!found) {
        return { ok: false, code: "NOT_FOUND" };
    }
    const { c } = authDb.prepare("SELECT COUNT(*) AS c FROM users").get();
    if (c <= 1) {
        return { ok: false, code: "LAST_ACCOUNT" };
    }
    try {
        authDb.exec("PRAGMA foreign_keys = ON");
    } catch {
        /* ignore */
    }
    authDb.prepare("DELETE FROM users WHERE id = ?").run(id);
    return { ok: true };
}
