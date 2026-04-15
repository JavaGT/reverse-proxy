/** Marks body when management runs as same-machine local operator (health header). */

fetch("/api/v1/health", { credentials: "include" })
    .then(r => {
        if (r.ok && r.headers.get("X-Management-Local-Operator") === "1") {
            document.body.classList.add("mgmt-local-operator");
        }
    })
    .catch(() => {});
