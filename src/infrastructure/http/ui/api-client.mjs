/** HTTP helpers for the management UI (Bearer from input or session). */

function getSecret() {
    const el = document.getElementById("mgmt-secret");
    return el?.value?.trim() || sessionStorage.getItem("mgmt_secret") || "";
}

export async function apiFetch(path, options = {}) {
    const headers = {
        Accept: "application/json",
        "Content-Type": "application/json",
        ...options.headers
    };
    const s = getSecret();
    if (s) headers.Authorization = `Bearer ${s}`;

    const res = await fetch(path, { ...options, headers });
    const ct = res.headers.get("content-type") || "";
    const body = ct.includes("application/json") ? await res.json() : await res.text();

    if (!res.ok) {
        const msg =
            typeof body === "object" && body?.error?.message
                ? body.error.message
                : String(body).slice(0, 200);
        throw new Error(msg || `HTTP ${res.status}`);
    }
    return body;
}
