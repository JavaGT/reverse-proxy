/** Reusable section toolbar: heading + actions slot. */
export class RpPanelToolbar extends HTMLElement {
    static get observedAttributes() {
        return ["heading"];
    }

    constructor() {
        super();
        const root = this.attachShadow({ mode: "open" });
        root.innerHTML = `
            <style>
                :host { display: block; }
                .mgmt-panel-head {
                    display: flex;
                    flex-wrap: wrap;
                    align-items: flex-start;
                    justify-content: space-between;
                    gap: 0.35rem 0.75rem;
                    margin-bottom: 0.35rem;
                }
                .mgmt-panel-title {
                    font-family: var(--font-sans, system-ui, sans-serif);
                    font-size: 1.05rem;
                    font-weight: 650;
                    letter-spacing: -0.02em;
                    margin: 0;
                    padding-top: 0.1rem;
                    line-height: 1.25;
                    color: var(--text, inherit);
                }
                .mgmt-panel-actions {
                    display: flex;
                    flex-wrap: wrap;
                    align-items: center;
                    gap: 0.35rem;
                    justify-content: flex-end;
                }
            </style>
            <div class="mgmt-panel-head" part="head">
                <h2 class="mgmt-panel-title"></h2>
                <div class="mgmt-panel-actions"><slot name="actions"></slot></div>
            </div>`;
    }

    connectedCallback() {
        this.#syncHeading();
    }

    attributeChangedCallback() {
        this.#syncHeading();
    }

    #syncHeading() {
        const t = this.getAttribute("heading") || "";
        const h = this.shadowRoot?.querySelector(".mgmt-panel-title");
        if (h) h.textContent = t;
    }
}
