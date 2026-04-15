#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { createAutoClient, createDbClient, createHttpClient, ManagementApiError } from "../src/index.mjs";

/** @param {string} path */
function readJsonFile(path) {
    return JSON.parse(readFileSync(path, "utf-8"));
}

function parseArgs(argv) {
    const args = argv.slice(2);
    const flags = {};
    const positional = [];
    for (let i = 0; i < args.length; i++) {
        const a = args[i];
        if (a === "--json") {
            flags.json = true;
        } else if (a === "--url") {
            flags.url = args[++i];
        } else if (a === "--db") {
            flags.db = args[++i];
        } else if (a === "--mode") {
            flags.mode = args[++i];
        } else if (a === "--file") {
            flags.file = args[++i];
        } else if (a === "--job") {
            flags.job = args[++i];
        } else if (a === "--subdomain") {
            flags.subdomain = args[++i];
        } else if (a === "--base-domain") {
            flags.baseDomain = args[++i];
        } else if (a === "--port") {
            flags.port = args[++i];
        } else if (a.startsWith("-")) {
            console.error(`Unknown flag: ${a}`);
            process.exit(2);
        } else {
            positional.push(a);
        }
    }
    return { flags, positional };
}

function printHelp() {
    console.log(`reverse-proxy-mgmt — management CLI (HTTP and/or SQLite)

Usage:
  reverse-proxy-mgmt [options] <command> [args]

Options:
  --url <url>           Management base URL (default http://127.0.0.1:24789)
  --db <path>           SQLite path (default ./reverse-proxy.db)
  --mode auto|http|db   Transport (default auto: probe /api/v1/health, else SQLite)
  --json                Print JSON only (no hints)

Commands:
  health
  domains get
  domains set           Requires --file <path.json> with { apexDomains, dnsConsole? }
  routes list
  reserve               Use --subdomain, --base-domain, --port OR --file <body.json>
  release <subdomain>   Requires --base-domain
  network               HTTP only (fails in db mode unless --mode http)
  scan                  Optional body: --file <json> (default range)
  kill <port>           HTTP only
  ddns get
  ddns set             Requires --file <body.json> (same fields as PUT /api/v1/ddns)
  ddns sync            HTTP only — POST /api/v1/ddns/sync (optional --job <jobId>)
  ddns clear

Database writes: stop the reverse-proxy process before using db mode for reserve/release/domains set/ddns set|clear.
`);
}

async function main() {
    const { flags, positional } = parseArgs(process.argv);
    if (positional[0] === "help" || positional[0] === "--help" || positional[0] === "-h" || positional.length === 0) {
        printHelp();
        process.exit(0);
    }

    const baseUrl = flags.url ?? "http://127.0.0.1:24789";
    const dbPath = flags.db ?? "./reverse-proxy.db";
    const mode = (flags.mode ?? "auto").toLowerCase();

    if (!["auto", "http", "db"].includes(mode)) {
        console.error('Invalid --mode (use auto, http, or db)');
        process.exit(2);
    }

    let client;
    if (mode === "http") {
        client = createHttpClient({ baseUrl });
    } else if (mode === "db") {
        client = createDbClient({ dbPath });
        if (!flags.json) {
            console.error("Note: database mode — stop the proxy before mutating routes or domains.");
        }
    } else {
        client = createAutoClient({ baseUrl, dbPath });
    }

    const cmd = positional.join(" ");
    const jsonOut = flags.json;

    const requireHttpManagement = what => {
        if (mode === "db") {
            console.error(`${what} requires HTTP management server`);
            process.exit(2);
        }
    };

    const out = (data, hint) => {
        console.log(jsonOut ? JSON.stringify(data) : JSON.stringify(data, null, 2));
        if (hint && !jsonOut) console.error(hint);
    };

    try {
        if (cmd === "health") {
            const r = await client.health();
            const m = mode === "auto" && typeof client.resolveMode === "function" ? await client.resolveMode() : mode;
            out(r, mode === "auto" ? `Transport: ${m}` : null);
            return;
        }

        if (cmd === "domains get") {
            out(await client.getDomains());
            return;
        }

        if (cmd === "domains set") {
            if (!flags.file) {
                console.error("domains set requires --file <path.json>");
                process.exit(2);
            }
            const body = readJsonFile(flags.file);
            out(await client.putDomains(body));
            return;
        }

        if (cmd === "routes list") {
            out(await client.getRoutes());
            return;
        }

        if (cmd === "reserve") {
            let body;
            if (flags.file) {
                body = readJsonFile(flags.file);
            } else if (flags.subdomain && flags.baseDomain && flags.port != null) {
                body = {
                    subdomain: flags.subdomain,
                    baseDomain: flags.baseDomain,
                    port: parseInt(String(flags.port), 10)
                };
            } else {
                console.error("reserve requires (--subdomain, --base-domain, --port) or --file <body.json>");
                process.exit(2);
            }
            out(await client.reserve(body));
            return;
        }

        if (positional[0] === "release") {
            const sub = positional[1];
            if (!sub || !flags.baseDomain) {
                console.error("release <subdomain> requires --base-domain");
                process.exit(2);
            }
            out(await client.release(sub, flags.baseDomain));
            return;
        }

        if (cmd === "network") {
            requireHttpManagement("network");
            out(await client.getNetwork());
            return;
        }

        if (cmd === "scan") {
            requireHttpManagement("scan");
            const body = flags.file ? readJsonFile(flags.file) : {};
            out(await client.scanPorts(body));
            return;
        }

        if (positional[0] === "kill") {
            requireHttpManagement("kill");
            const port = positional[1];
            if (port == null) {
                console.error("kill <port> requires a port");
                process.exit(2);
            }
            out(await client.killProcess(port));
            return;
        }

        if (cmd === "ddns get") {
            out(await client.getDdns());
            return;
        }

        if (cmd === "ddns set") {
            if (!flags.file) {
                console.error("ddns set requires --file <body.json>");
                process.exit(2);
            }
            const body = readJsonFile(flags.file);
            out(await client.putDdns(body));
            return;
        }

        if (cmd === "ddns sync") {
            requireHttpManagement("ddns sync");
            out(await client.postDdnsSync(flags.job));
            return;
        }

        if (cmd === "ddns clear") {
            out(await client.deleteDdns());
            return;
        }

        console.error(`Unknown command: ${cmd}`);
        printHelp();
        process.exit(2);
    } catch (e) {
        if (e instanceof ManagementApiError) {
            console.error(JSON.stringify({ error: { code: e.code, message: e.message, details: e.details, resolution: e.resolution } }, null, 2));
            process.exit(1);
        }
        console.error(e?.message ?? e);
        process.exit(1);
    }
}

main();
