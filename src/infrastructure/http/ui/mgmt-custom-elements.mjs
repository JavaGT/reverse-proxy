/** Registers management dashboard custom elements. */

import { RpMgmtHeader } from "./components/rp-mgmt-header.mjs";
import { RpMgmtSidebar } from "./components/rp-mgmt-sidebar.mjs";
import { RpPanelToolbar } from "./components/rp-panel-toolbar.mjs";
import { RpMgmtModal } from "./components/rp-mgmt-modal.mjs";
import { RpApexDomainsPanel } from "./components/rp-apex-domains-panel.mjs";
import { RpRoutesPanel } from "./components/rp-routes-panel.mjs";
import { RpReserveForm } from "./components/rp-reserve-form.mjs";
import { RpScanPanel } from "./components/rp-scan-panel.mjs";
import { RpDdnsPanel } from "./components/rp-ddns-panel.mjs";
import { RpNetworkPanel } from "./components/rp-network-panel.mjs";
import { RpAccountsApp } from "./components/rp-accounts-app.mjs";
import { RpSettingsApp } from "./components/rp-settings-app.mjs";

customElements.define("rp-mgmt-header", RpMgmtHeader);
customElements.define("rp-mgmt-sidebar", RpMgmtSidebar);
customElements.define("rp-panel-toolbar", RpPanelToolbar);
customElements.define("rp-mgmt-modal", RpMgmtModal);
customElements.define("rp-apex-domains-panel", RpApexDomainsPanel);
customElements.define("rp-routes-panel", RpRoutesPanel);
customElements.define("rp-reserve-form", RpReserveForm);
customElements.define("rp-scan-panel", RpScanPanel);
customElements.define("rp-ddns-panel", RpDdnsPanel);
customElements.define("rp-network-panel", RpNetworkPanel);
customElements.define("rp-accounts-app", RpAccountsApp);
customElements.define("rp-settings-app", RpSettingsApp);
