function normalizeIp(address) {
    if (!address) return "unknown";
    return address.startsWith("::ffff:") ? address.slice(7) : address;
}

/**
 * SRP: Builds Forwarding headers for proxy requests.
 */
export function buildExtraHeaders(req) {
    const clientIp = normalizeIp(req.socket.remoteAddress);
    const existingFwd = req.headers["x-forwarded-for"];

    return {
        "X-Real-IP": clientIp,
        "X-Forwarded-For": existingFwd ? `${existingFwd}, ${clientIp}` : clientIp,
        "X-Forwarded-Proto": req.socket.encrypted ? "https" : "http",
        "X-Forwarded-Host": req.headers.host ?? "",
    };
}
