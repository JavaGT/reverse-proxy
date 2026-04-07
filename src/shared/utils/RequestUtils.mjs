/**
 * SRP: Logic for determining if a request is from the local loopback interface.
 */
export function isLocalRequest(req) {
    const remoteAddress = req.socket.remoteAddress;
    return (
        remoteAddress === "127.0.0.1" ||
        remoteAddress === "::ffff:127.0.0.1" ||
        remoteAddress === "::1"
    );
}
