import fs from "node:fs";
import crypto from "node:crypto";

/**
 * SRP: Reads a secret token from a file and trims whitespace.
 */
export function readSecretFile(filePath) {
    if (!fs.existsSync(filePath)) {
        throw new Error(`Secret file ${filePath} does not exist`);
    }

    const secret = fs.readFileSync(filePath, "utf8").trim();
    if (!secret) {
        throw new Error(`Secret file ${filePath} is empty`);
    }

    return secret;
}

/**
 * SRP: Generates a cryptographically strong 32-byte hex secret.
 */
export function generateSecret() {
    return crypto.randomBytes(32).toString("hex");
}

/**
 * SRP: Writes a secret to a file with restricted (600) permissions.
 * Security: Ensures only the file owner can read/write the secret.
 */
export function writeSecretFile(filePath, secret) {
    // Write then set permissions or vice versa (better to set after write if creating)
    fs.writeFileSync(filePath, secret, { mode: 0o600 });
}
