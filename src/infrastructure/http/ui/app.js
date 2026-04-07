/**
 * Proxy Management Frontend Logic
 */

const elements = {
    secretInput: document.getElementById('secretInput'),
    refreshBtn: document.getElementById('refreshBtn'),
    addRouteBtn: document.getElementById('addRouteBtn'),
    addRouteModal: document.getElementById('addRouteModal'),
    addRouteForm: document.getElementById('addRouteForm'),
    closeModalBtn: document.getElementById('closeModalBtn'),
    subdomainInput: document.getElementById('subdomain'),
    portsInput: document.getElementById('ports'),
    
    routeTableBody: document.getElementById('routeTableBody'),
    routeCount: document.getElementById('routeCount'),
    healthyCount: document.getElementById('healthyCount'),

    // Tabs
    navTabs: document.querySelectorAll('.nav-tab'),
    tabContents: document.querySelectorAll('.tab-content'),

    // Scanner
    scanForm: document.getElementById('scanForm'),
    scanStart: document.getElementById('scanStart'),
    scanEnd: document.getElementById('scanEnd'),
    scanProgressContainer: document.getElementById('scanProgressContainer'),
    scanProgressBar: document.getElementById('scanProgressBar'),
    scanStatusText: document.getElementById('scanStatusText'),
    scanResultsList: document.getElementById('scanResultsList'),
};

// --- Initialization ---

const savedSecret = sessionStorage.getItem('mgmt_secret');
if (savedSecret) {
    elements.secretInput.value = savedSecret;
}

fetchRoutes();

// --- Event Listeners ---

elements.secretInput.addEventListener('input', (e) => {
    sessionStorage.setItem('mgmt_secret', e.target.value);
});

elements.refreshBtn.addEventListener('click', fetchRoutes);

elements.addRouteBtn.addEventListener('click', () => {
    openRouteModal();
});

elements.closeModalBtn.addEventListener('click', () => {
    elements.addRouteModal.classList.add('hidden');
});

// Tab Switching
elements.navTabs.forEach(tab => {
    tab.addEventListener('click', () => {
        const target = tab.dataset.tab;
        
        elements.navTabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');

        elements.tabContents.forEach(content => {
            content.classList.toggle('active', content.id === `${target}Tab`);
        });
    });
});

elements.addRouteForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const formData = new FormData(e.target);
    const subdomain = formData.get('subdomain');
    const ports = formData.get('ports').split(',').map(p => parseInt(p.trim(), 10));

    try {
        const response = await apiFetch('/api/v1/reserve', {
            method: 'POST',
            body: JSON.stringify({ subdomain, ports })
        });

        if (response.data) {
            elements.addRouteModal.classList.add('hidden');
            elements.addRouteForm.reset();
            fetchRoutes();
        }
    } catch (err) {
        alert(`Failed to add route: ${err.message}`);
    }
});

// Scanner Logic
elements.scanForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const start = parseInt(elements.scanStart.value);
    const end = parseInt(elements.scanEnd.value);

    if (isNaN(start) || isNaN(end) || start > end) {
        alert('Invalid range');
        return;
    }

    // UI Feedback
    elements.scanProgressContainer.classList.remove('hidden');
    elements.scanProgressBar.style.width = '0%';
    elements.scanStatusText.textContent = `Scanning ${start} to ${end}...`;
    elements.scanResultsList.innerHTML = '<div class="empty-state">Searching...</div>';

    try {
        // Mocking progress since the API is a single call
        // In a real production app, we'd use WebSockets or SSE for progress
        const progressInterval = setInterval(() => {
            const currentWidth = parseFloat(elements.scanProgressBar.style.width);
            if (currentWidth < 90) {
                elements.scanProgressBar.style.width = `${currentWidth + 2}%`;
            }
        }, 100);

        const { data } = await apiFetch('/api/v1/scan', {
            method: 'POST',
            body: JSON.stringify({ start, end })
        });

        clearInterval(progressInterval);
        elements.scanProgressBar.style.width = '100%';
        elements.scanStatusText.textContent = `Scan complete. Found ${data.openPorts.length} services.`;
        
        renderScanResults(data.openPorts);
    } catch (err) {
        elements.scanStatusText.textContent = `Scan failed: ${err.message}`;
        alert(`Scan failed: ${err.message}`);
    }
});

// --- API Helpers ---

async function apiFetch(endpoint, options = {}) {
    const secret = elements.secretInput.value;
    const headers = {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        ...options.headers
    };

    if (secret) {
        headers['Authorization'] = `Bearer ${secret}`;
    }

    const response = await fetch(endpoint, { ...options, headers });
    const contentType = response.headers.get('content-type');
    let result;

    if (contentType && contentType.includes('application/json')) {
        result = await response.json();
    } else {
        const text = await response.text();
        throw new Error(`Server returned non-JSON response (${response.status}): ${text.substring(0, 50)}`);
    }

    if (!response.ok) {
        throw new Error(result.error?.message || 'API request failed');
    }

    return result;
}

async function fetchRoutes() {
    try {
        const { data: routes } = await apiFetch('/api/v1/routes');
        renderRoutes(routes);
    } catch (err) {
        console.error('Failed to fetch routes:', err);
    }
}

async function releaseRoute(subdomain) {
    if (!confirm(`Are you sure you want to release ${subdomain}?`)) return;

    try {
        await apiFetch(`/api/v1/reserve/${subdomain}`, { method: 'DELETE' });
        fetchRoutes();
    } catch (err) {
        alert(`Failed to release route: ${err.message}`);
    }
}

async function killProcess(port) {
    if (!confirm(`Are you sure you want to terminate the process on port ${port}? This action cannot be undone.`)) return;

    try {
        await apiFetch(`/api/v1/process/${port}`, { method: 'DELETE' });
        // Refresh scan if possible or just remove the card
        alert(`Process on port ${port} killed.`);
        // Simple way to refresh: trigger the scan form again if we wanted to be fancy, 
        // but for now just showing an alert is a good start.
    } catch (err) {
        alert(`Failed to kill process: ${err.message}`);
    }
}

function openRouteModal(prefilledSubdomain = '', prefilledPorts = '') {
    elements.subdomainInput.value = prefilledSubdomain;
    elements.portsInput.value = prefilledPorts;
    elements.addRouteModal.classList.remove('hidden');
}

// --- UI Rendering ---

function renderRoutes(routes) {
    elements.routeTableBody.innerHTML = '';
    let healthyTotal = 0;

    routes.forEach(route => {
        const tr = document.createElement('tr');
        
        const targetsHtml = route.targets.map(t => {
            if (t.healthy !== false) healthyTotal++;
            const statusClass = t.healthy !== false ? 'badge-healthy' : 'badge-unhealthy';
            const statusLabel = t.healthy !== false ? 'Healthy' : 'Unhealthy';
            return `
                <div class="target-item">
                    <code>${t.url}</code>
                    <span class="badge ${statusClass}">${statusLabel}</span>
                </div>
            `;
        }).join('');

        const typeClass = route.type === 'persistent' ? 'badge-type' : '';
        const subdomain = route.host.split('.')[0];

        tr.innerHTML = `
            <td><strong>${route.host}</strong></td>
            <td><div class="target-list">${targetsHtml}</div></td>
            <td><span class="badge ${typeClass}">${route.type}</span></td>
            <td>
                ${route.type === 'persistent' ? 
                    `<button class="btn btn-secondary btn-sm" onclick="releaseRoute('${subdomain}')">🗑️ Release</button>` : 
                    '<span class="text-muted">Built-in</span>'
                }
            </td>
        `;
        elements.routeTableBody.appendChild(tr);
    });

    elements.routeCount.textContent = routes.length;
    elements.healthyCount.textContent = healthyTotal;
}

function renderScanResults(openPorts) {
    elements.scanResultsList.innerHTML = '';
    
    if (openPorts.length === 0) {
        elements.scanResultsList.innerHTML = '<div class="empty-state">No open ports found in this range.</div>';
        return;
    }

    openPorts.forEach(item => {
        const { port, process } = item;
        const card = document.createElement('div');
        card.className = 'result-card';
        card.innerHTML = `
            <div class="result-info">
                <span>Port <strong>${port}</strong></span>
                <span class="badge badge-type">${process.command}</span>
            </div>
            <div class="result-actions">
                <button class="btn btn-primary btn-sm" onclick="openRouteModal('', '${port}')">🔗 Proxy It</button>
                <button class="btn btn-danger btn-sm" onclick="killProcess('${port}')">💀 Kill</button>
            </div>
        `;
        elements.scanResultsList.appendChild(card);
    });
}

// Expose to window for inline onclick handlers
window.releaseRoute = releaseRoute;
window.killProcess = killProcess;
window.fetchRoutes = fetchRoutes;
window.openRouteModal = openRouteModal;
