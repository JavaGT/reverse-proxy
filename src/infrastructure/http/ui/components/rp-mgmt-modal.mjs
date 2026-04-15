/**
 * Modal shell using native &lt;dialog&gt;. Default slot = body; slot name="footer" = action row.
 * Methods: showModal(), close()
 */
export class RpMgmtModal extends HTMLElement {
    static get observedAttributes() {
        return ["title", "label", "density"];
    }

    constructor() {
        super();
        const root = this.attachShadow({ mode: "open" });
        root.innerHTML = `
            <style>
                dialog {
                    max-width: min(32rem, calc(100vw - 2rem));
                    width: 100%;
                    padding: 0;
                    border: 1px solid var(--border, #a7a7a7);
                    background: var(--panel, #fff);
                    color: var(--text, #202122);
                    font-family: system-ui, sans-serif;
                    font-size: 0.9rem;
                }
                :host([density="compact"]) dialog {
                    max-width: min(40rem, calc(100vw - 1.5rem));
                    font-size: 0.8rem;
                }
                dialog::backdrop {
                    background: rgba(0, 0, 0, 0.45);
                }
                .mgmt-dialog-header {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    gap: 0.5rem;
                    padding: 0.5rem 0.75rem;
                    border-bottom: 1px solid var(--border, #a7a7a7);
                    background: var(--thead, #eaecf0);
                }
                :host([density="compact"]) .mgmt-dialog-header {
                    padding: 0.35rem 0.5rem;
                }
                .mgmt-dialog-header h3 {
                    margin: 0;
                    font-size: 1rem;
                    font-weight: 600;
                    text-wrap: balance;
                }
                :host([density="compact"]) .mgmt-dialog-header h3 {
                    font-size: 0.88rem;
                }
                .mgmt-dialog-close {
                    margin: 0;
                    padding: 0.1rem 0.45rem;
                    line-height: 1.2;
                    font-size: 1.1rem;
                    border: 1px solid var(--border, #a7a7a7);
                    background: var(--btn-bg, #f8f9fa);
                    color: var(--text, #202122);
                    cursor: pointer;
                }
                .mgmt-dialog-close:hover { background: var(--btn-hover, #eaecf0); }
                .mgmt-dialog-body {
                    padding: 0.75rem;
                    max-height: min(70vh, 28rem);
                    overflow-y: auto;
                    overscroll-behavior: contain;
                }
                :host([density="compact"]) .mgmt-dialog-body {
                    padding: 0.45rem 0.55rem;
                    max-height: min(82vh, 40rem);
                }
                .mgmt-dialog-footer {
                    display: flex;
                    flex-wrap: wrap;
                    justify-content: flex-end;
                    gap: 0.35rem;
                    padding: 0.5rem 0.75rem;
                    border-top: 1px solid var(--border, #a7a7a7);
                }
                :host([density="compact"]) .mgmt-dialog-footer {
                    padding: 0.35rem 0.5rem;
                }
                .mgmt-dialog-footer:empty { display: none; }
            </style>
            <dialog part="dialog" aria-labelledby="ttl">
                <div class="mgmt-dialog-header">
                    <h3 id="ttl"></h3>
                    <button type="button" class="mgmt-dialog-close" aria-label="Close">×</button>
                </div>
                <div class="mgmt-dialog-body"><slot></slot></div>
                <div class="mgmt-dialog-footer"><slot name="footer"></slot></div>
            </dialog>`;
    }

    connectedCallback() {
        const dlg = this.#dlg();
        this.shadowRoot.querySelector(".mgmt-dialog-close").addEventListener("click", () => dlg.close());
        dlg.addEventListener("cancel", e => {
            e.preventDefault();
            dlg.close();
        });
        this.#syncTitle();
    }

    attributeChangedCallback() {
        this.#syncTitle();
    }

    #dlg() {
        return this.shadowRoot.querySelector("dialog");
    }

    #syncTitle() {
        const t = this.getAttribute("title") || "";
        const h = this.shadowRoot?.querySelector("#ttl");
        if (h) {
            h.textContent = t;
            const lab = this.getAttribute("label");
            if (lab) h.id = lab;
        }
    }

    showModal() {
        this.#dlg().showModal();
    }

    close() {
        this.#dlg().close();
    }
}
