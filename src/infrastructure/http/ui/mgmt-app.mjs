/**
 * Management UI entry: registers custom elements and global listeners (theme, refresh, help).
 */

import "./mgmt-local-operator.mjs";
import "./mgmt-custom-elements.mjs";
import { initMgmtSessionBar } from "./mgmt-session.mjs";
import { initMgmtTheme } from "./mgmt-theme.mjs";
import { initMgmtHelpModal } from "./mgmt-help.mjs";

initMgmtSessionBar();
initMgmtTheme();
initMgmtHelpModal();

/* Initial data load: each panel’s connectedCallback already calls render/load.
   A duplicate mgmt-refresh here re-fetched everything and could replace the DDNS
   form mid-interaction (checkbox appeared to “do nothing” until refresh). */
