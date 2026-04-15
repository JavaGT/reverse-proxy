/** Login page: header + auth component, theme, sign-out. */

import { RpMgmtHeader } from "./components/rp-mgmt-header.mjs";
import { RpAuthLogin } from "./components/rp-auth-login.mjs";
import { initMgmtTheme } from "./mgmt-theme.mjs";
import { wireMgmtSignOut } from "./mgmt-session.mjs";

customElements.define("rp-mgmt-header", RpMgmtHeader);
customElements.define("rp-auth-login", RpAuthLogin);

wireMgmtSignOut();
initMgmtTheme();
