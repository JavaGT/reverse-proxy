import { execSync } from "node:child_process";

/**
 * Utility to identify which processes are listening on which ports.
 * Specifically designed for macOS/Unix 'lsof' output.
 */
export class ProcessInfoProvider {
    /**
     * Scans the system for all listening TCP processes.
     * @returns {Map<number, { command: string, pid: string }>} Map of port to process info.
     */
    static getListeningProcesses() {
        const processMap = new Map();
        
        try {
            // -iTCP -sTCP:LISTEN : only listening TCP sockets
            // -P -n : don't resolve ports/hostnames (faster and easier to parse)
            const output = execSync("lsof -iTCP -sTCP:LISTEN -P -n", { encoding: "utf8" });
            const lines = output.split("\n");

            // Skip header
            for (let i = 1; i < lines.length; i++) {
                const line = lines[i].trim();
                if (!line) continue;

                const parts = line.split(/\s+/);
                if (parts.length < 9) continue;

                const command = parts[0];
                const pid = parts[1];
                
                // The address:port is usually the penultimate column if (LISTEN) is present
                // e.g., "node 82041 root ... TCP *:80 (LISTEN)"
                const name = parts[parts.length - 2]; 

                const portMatch = name.match(/:(\d+)$/);
                if (portMatch) {
                    const port = parseInt(portMatch[1], 10);
                    processMap.set(port, { command, pid });
                }
            }
        } catch (err) {
            // lsof returns exit code 1 if no matches are found, which is not an error for us.
            if (err.status !== 1) {
                console.error("Failed to execute lsof:", err.message);
            }
        }

        return processMap;
    }
}
