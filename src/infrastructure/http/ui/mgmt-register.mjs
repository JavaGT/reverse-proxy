/** Registration page: header + form component, theme, sign-out. */

import { RpMgmtHeader } from "./components/rp-mgmt-header.mjs";
import { RpAuthRegister } from "./components/rp-auth-register.mjs";
import { initMgmtTheme } from "./mgmt-theme.mjs";
import { wireMgmtSignOut } from "./mgmt-session.mjs";

customElements.define("rp-mgmt-header", RpMgmtHeader);
customElements.define("rp-auth-register", RpAuthRegister);

wireMgmtSignOut();
initMgmtTheme();
