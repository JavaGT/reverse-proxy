#!/usr/bin/env node
/**
 * Interactive helper: seeds SQLite `meta.server_settings` for first boot (TLS dir, apex list, secrets).
 * The reverse-proxy process always uses `./reverse-proxy.db` relative to its working directory — run
 * the server from the project root, or copy the DB there after running this script.
 *
 * Run: `npm run setup:env` or `node scripts/setup-env.mjs`
 *
 * Options:
 *   --dry-run   Print the JSON that would be stored (does not write)
 *   --help      Show usage
 */

import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { SqlitePersistence } from "../src/infrastructure/persistence/SqlitePersistence.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");
const DEFAULT_DB = join(REPO_ROOT, "reverse-proxy.db");

function parseArgs(argv) {
    const dryRun = argv.includes("--dry-run");
    const help = argv.includes("--help") || argv.includes("-h");
    return { dryRun, help };
}

function usage() {
    console.log(`Usage: node scripts/setup-env.mjs [options]

Writes server settings into SQLite (meta.server_settings) at ${DEFAULT_DB}
(process cwd should be the repo root when starting the server).

Options:
  --dry-run   Print JSON only; does not write the database
  --help, -h  Show this message
`);
}

function randomSecret() {
    return randomBytes(32).toString("base64url");
}

function trimOrEmpty(s) {
    return String(s ?? "").trim();
}

async function main() {
    const argv = process.argv.slice(2);
    const { dryRun, help } = parseArgs(argv);
    if (help) {
        usage();
        process.exit(0);
    }

    const rl = readline.createInterface({ input, output });

    try {
        console.log("");
        console.log("Reverse proxy — seed SQLite server settings");
        console.log(`Database: ${DEFAULT_DB}`);
        console.log("");

        if (!dryRun && existsSync(DEFAULT_DB)) {
            const ow = trimOrEmpty(await rl.question("Database already exists. Merge settings into server_settings? [y/N]: "));
            if (ow.toLowerCase() !== "y" && ow.toLowerCase() !== "yes") {
                console.log("Aborted.");
                process.exit(0);
            }
        }

        let tlsCertDir = trimOrEmpty(
            await rl.question("TLS certificate directory (e.g. /etc/letsencrypt/live/your-domain.com): ")
        );
        while (!tlsCertDir) {
            tlsCertDir = trimOrEmpty(await rl.question("tlsCertDir is required: "));
        }

        let primary = trimOrEmpty(await rl.question("Primary apex domain (e.g. example.com): "));
        while (!primary) {
            primary = trimOrEmpty(await rl.question("Primary apex domain: "));
        }
        const more = trimOrEmpty(await rl.question("Additional apex domains, comma-separated (or empty): "));
        const rootDomains = more ? `${primary},${more.split(",").map(s => s.trim()).filter(Boolean).join(",")}` : primary;

        const genSessAns = trimOrEmpty(await rl.question("Generate managementSessionSecret? [Y/n]: ")).toLowerCase();
        const genSess = genSessAns !== "n" && genSessAns !== "no";
        let sessionSecret;
        if (genSess) {
            sessionSecret = randomSecret();
        } else {
            sessionSecret = trimOrEmpty(await rl.question("Paste managementSessionSecret: "));
            if (!sessionSecret) {
                console.log("Generating session secret.");
                sessionSecret = randomSecret();
            }
        }

        let registrationSecret = null;
        const reg = trimOrEmpty(await rl.question("Set managementRegistrationSecret now? [y/N]: "));
        if (reg.toLowerCase() === "y" || reg.toLowerCase() === "yes") {
            const g = trimOrEmpty(await rl.question("Generate random invite secret? [Y/n]: ")).toLowerCase() !== "n";
            registrationSecret = g ? randomSecret() : trimOrEmpty(await rl.question("Paste invite secret: "));
            if (!registrationSecret) registrationSecret = randomSecret();
        }

        /** @type {Record<string, unknown>} */
        const partial = {
            tlsCertDir,
            rootDomains,
            managementSessionSecret: sessionSecret
        };
        if (registrationSecret) {
            partial.managementRegistrationSecret = registrationSecret;
        }

        if (dryRun) {
            console.log(JSON.stringify(partial, null, 2));
        } else {
            const persistence = new SqlitePersistence(DEFAULT_DB);
            persistence.saveServerSettingsPartial(partial);
            console.log("");
            console.log(`Merged keys into ${DEFAULT_DB} (meta.server_settings).`);
            console.log("Start the server from this directory (`npm start`), then open /settings.html for further tuning.");
        }
    } finally {
        rl.close();
    }
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
