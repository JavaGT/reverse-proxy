import net from "node:net";

/**
 * Concurrency-safe local port scanner.
 * Scans 127.0.0.1 for open ports using net.createConnection.
 */
export class PortScanner {
    #concurrency;
    #timeout;

    constructor(concurrency = 100, timeout = 200) {
        this.#concurrency = concurrency;
        this.#timeout = timeout;
    }

    /**
     * Scans a range of ports on 127.0.0.1.
     * @param {number} start 
     * @param {number} end 
     * @param {Function} onProgress Optional callback(currentPort, total)
     * @returns {Promise<number[]>} List of open portsfound.
     */
    async scanRange(start, end, onProgress = null) {
        const openPorts = [];
        const total = end - start + 1;
        let completed = 0;

        const chunks = [];
        for (let i = start; i <= end; i += this.#concurrency) {
            chunks.push(Array.from({ length: Math.min(this.#concurrency, end - i + 1) }, (_, idx) => i + idx));
        }

        for (const chunk of chunks) {
            const results = await Promise.all(chunk.map(port => this.#checkPort(port)));
            results.forEach((isOpen, idx) => {
                const port = chunk[idx];
                if (isOpen) openPorts.push(port);
                completed++;
                if (onProgress) onProgress(completed, total);
            });
        }

        return openPorts;
    }

    #checkPort(port) {
        return new Promise((resolve) => {
            const socket = new net.Socket();
            let resolved = false;

            socket.setTimeout(this.#timeout);

            socket.on("connect", () => {
                if (resolved) return;
                resolved = true;
                socket.destroy();
                resolve(true);
            });

            socket.on("timeout", () => {
                if (resolved) return;
                resolved = true;
                socket.destroy();
                resolve(false);
            });

            socket.on("error", () => {
                if (resolved) return;
                resolved = true;
                socket.destroy();
                resolve(false);
            });

            socket.connect(port, "127.0.0.1");
        });
    }
}
