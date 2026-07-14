// scripts/add-product.js
import { AppState, fetchDataAndSyncState } from './data.js';
import { resetSearchCache } from './search-handler.js';

const ADD_PRODUCT_WEBHOOK_URL = 'https://automatizare.comandat.ro/webhook/v2-register-product';
let formListenerAttached = false;

function populateManifestSkus(commandId) {
    const manifestSelect = document.getElementById('manifestsku-input');
    if (!manifestSelect) return;

    if (!commandId) {
        manifestSelect.innerHTML = '<option value="">Alege mai întâi o comandă...</option>';
        manifestSelect.disabled = true;
        return;
    }

    const command = AppState.getCommands().find(c => c.id === commandId);
    const skus = [...new Set(
        (command?.products || [])
            .map(p => p.manifestsku)
            .filter(Boolean)
    )].sort((a, b) => {
        const rank = s => s.startsWith('YELLOW') ? 0 : s.startsWith('GREY') ? 1 : 2;
        return rank(a) - rank(b) || a.localeCompare(b);
    });

    if (skus.length === 0) {
        manifestSelect.innerHTML = '<option value="">Nu există paleți în această comandă</option>';
        manifestSelect.disabled = true;
        return;
    }

    manifestSelect.disabled = false;
    manifestSelect.innerHTML = '<option value="">Alege un palet...</option>';
    skus.forEach(sku => {
        const option = document.createElement('option');
        option.value = sku;
        option.textContent = sku;
        manifestSelect.appendChild(option);
    });
}

function populateCommandsList() {
    const commandSelect = document.getElementById('command-select');
    if (!commandSelect) return;

    const commands = AppState.getCommands();

    if (!commands || commands.length === 0) {
        commandSelect.innerHTML = '<option value="">Nu există comenzi</option>';
        commandSelect.disabled = true;
        return;
    }

    commandSelect.disabled = false;
    commandSelect.innerHTML = '<option value="">Alege o comandă...</option>';
    commands.forEach(command => {
        const option = document.createElement('option');
        option.value = command.id;
        option.textContent = command.name;
        commandSelect.appendChild(option);
    });

    populateManifestSkus(commandSelect.value);
}

async function handleFormSubmit(event) {
    event.preventDefault();

    const asinInput = document.getElementById('asin-input');
    const commandSelect = document.getElementById('command-select');
    const manifestskuInput = document.getElementById('manifestsku-input');
    const insertButton = document.getElementById('insert-button');
    const buttonText = insertButton.querySelector('.button-text');
    const buttonLoader = insertButton.querySelector('.button-loader');
    const statusMessage = document.getElementById('status-message');

    const asin = asinInput.value.replace(/[^A-Za-z0-9]/g, '');
    const orderId = commandSelect.value;
    const manifestsku = manifestskuInput.value;

    if (!asin || !orderId || !manifestsku) {
        statusMessage.textContent = 'Te rugăm să completezi toate câmpurile.';
        statusMessage.className = 'text-red-600 text-center text-sm font-medium';
        return;
    }

    insertButton.disabled = true;
    buttonText.classList.add('hidden');
    buttonLoader.classList.remove('hidden');
    statusMessage.textContent = 'Se inserează...';
    statusMessage.className = 'text-gray-500 text-center text-sm font-medium';

    try {
        const payload = {
            asin_nou: asin,
            updateQuery: `INSERT INTO manifests."${orderId}" (asin, orderedquantity, suggestedcondition, manifestsku, barcode, productsku, grade, bncondition, vgcondition, gcondition, broken, unitcostwithoutvat, unitcostwithvat, totalcostwithvat, totalcostwithoutvat) VALUES ('${asin}', 0, 'New Entry', '${manifestsku}', NULL, '${asin}-${manifestsku}-MANUAL', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL)`
        };

        const response = await fetch(ADD_PRODUCT_WEBHOOK_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!response.ok) throw new Error(`Eroare HTTP: ${response.status}`);

        const result = await response.json();

        if (result.status === 'success') {
            statusMessage.textContent = 'Produsul a fost importat cu succes.';
            statusMessage.className = 'text-green-600 text-center text-sm font-medium';
            asinInput.value = '';
            commandSelect.selectedIndex = 0;
            populateManifestSkus(null);
            resetSearchCache();
            await fetchDataAndSyncState();
            populateCommandsList();
        } else {
            throw new Error(result.message || 'Eroare necunoscută de la server.');
        }
    } catch (error) {
        console.error('Eroare la inserarea produsului:', error);
        statusMessage.textContent = 'Eroare la inserare. Verifică consola.';
        statusMessage.className = 'text-red-600 text-center text-sm font-medium';
    } finally {
        insertButton.disabled = false;
        buttonText.classList.remove('hidden');
        buttonLoader.classList.add('hidden');
    }
}

export function initAddProductPage() {
    const form = document.getElementById('add-product-form');
    const commandSelect = document.getElementById('command-select');

    if (form && !formListenerAttached) {
        form.addEventListener('submit', handleFormSubmit);
        commandSelect.addEventListener('change', () => populateManifestSkus(commandSelect.value));
        formListenerAttached = true;
    }

    populateCommandsList();
}
