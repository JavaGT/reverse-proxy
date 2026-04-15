/** @returns {typeof fetch} */
export function getFetch() {
    const f = globalThis.fetch;
    if (typeof f !== "function") {
        throw new Error("globalThis.fetch is not available; use Node.js 18+ or provide fetch in createHttpClient/createAutoClient");
    }
    return f;
}
