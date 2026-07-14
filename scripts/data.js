// scripts/data.js

// --- CONFIGURARE WEBHOOKS ---
const DATA_FETCH_URL = 'https://automatizare.comandat.ro/webhook/5a447557-8d52-463e-8a26-5902ccee8177';
const PRODUCT_DETAILS_URL = 'https://automatizare.comandat.ro/webhook/v2-product-details';
const STOCK_UPDATE_URL = 'https://automatizare.comandat.ro/webhook/4bef3762-2d4f-437d-a05c-001ccb597ab9';
export const FIX_DUPLICATE_SKU_URL = 'https://automatizare.comandat.ro/webhook/fix-duplicate-sku';
export const NOTES_UPDATE_URL = 'https://automatizare.comandat.ro/webhook/v2-product-notes';

let _commandsCache = null;

export const AppState = {
    getCommands: () => {
        if (_commandsCache) return _commandsCache;
        try { return JSON.parse(sessionStorage.getItem('liveCommandsData') || '[]'); } catch (_) { return []; }
    },
    setCommands: (commands) => {
        _commandsCache = commands;
        try { sessionStorage.setItem('liveCommandsData', JSON.stringify(commands)); } catch (_) {}
    }
};

export async function fetchDataAndSyncState() {
    const accessCode = sessionStorage.getItem('lastAccessCode');
    if (!accessCode) return false;

    try {
        // Adăugăm opțiunea 'cache: 'no-store'' pentru a forța reîncărcarea datelor proaspete
        const response = await fetch(DATA_FETCH_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain' },
            body: JSON.stringify({ code: accessCode }),
            cache: 'no-store' 
        });

        if (!response.ok) throw new Error('Network error during data fetch');
        
        const responseData = await response.json();
        
        console.log("RAW DATA RECEIVED FROM SERVER:", JSON.stringify(responseData.data, null, 2));

        if (responseData.status !== 'success' || !responseData.data) throw new Error('Invalid data from server');

        const commands = Object.keys(responseData.data).map(commandId => {
            const products = responseData.data[commandId] || [];
            return {
                id: commandId,
                name: `Comanda #${commandId.substring(0, 12)}`,
                products: products.map(p => {
                    const state = {
                        'new': p.bncondition || 0,
                        'very-good': p.vgcondition || 0,
                        'good': p.gcondition || 0,
                        'broken': p.broken || 0
                    };
                    const found = Object.values(state).reduce((sum, val) => Number(sum) + Number(val), 0);
                    return {
                        id: p.productsku,
                        asin: p.asin,
                        manifestsku: p.manifestsku || null, // Aici citim manifestsku
                        expected: p.orderedquantity || 0,
                        found: found,
                        state: state,
                        suggestedcondition: p.suggestedcondition || 'N/A',
                        notes: Array.isArray(p.notes) ? p.notes : []
                    };
                })
            };
        });
        
        AppState.setCommands(commands);
        return true;
    } catch (error) {
        console.error('Data sync failed:', error);
        return false;
    }
}

// Mai multe rânduri din aceeași comandă pot avea același productsku (același ASIN,
// paleti diferiti) - importul automat din manifestul furnizorului nu il face unic per palet.
// Rezolvăm mereu (productsku + manifestsku), altfel .find() nimerește primul palet găsit.
export function resolveProductInCommand(command, productSku, manifestSku) {
    const matches = command.products.filter(p => p.id === productSku);
    if (matches.length === 0) return { product: null, ambiguous: false };
    if (matches.length === 1) return { product: matches[0], ambiguous: false };

    const scoped = manifestSku && matches.find(p => (p.manifestsku || 'No ManifestSKU') === manifestSku);
    return scoped ? { product: scoped, ambiguous: false } : { product: null, ambiguous: true };
}

export async function sendStockUpdate(commandId, productSku, productAsin, manifestSku, stockDelta) {
    const changes = [];
    for (const condition in stockDelta) {
        const value = stockDelta[condition];
        if (value !== 0) {
            changes.push({
                condition: condition,
                changeValue: value
            });
        }
    }

    if (changes.length === 0) return true;

    const payload = {
        orderId: commandId,
        productsku: productSku,
        asin: productAsin,
        manifestsku: manifestSku || null, // scopează update-ul pe paletul corect (vezi resolveProductInCommand)
        changes: changes
    };

    try {
        const response = await fetch(STOCK_UPDATE_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (!response.ok) {
             console.error(`Failed to update stock:`, await response.text());
             return false;
        }
        return true;
    } catch (error) {
        console.error('Network error during stock update:', error);
        return false;
    }
}

export async function fetchProductDetailsInBulk(asins) {
    const results = {};
    const asinsToFetch = asins.filter(asin => !sessionStorage.getItem(`product_${asin}`));

    asins.forEach(asin => {
        if(sessionStorage.getItem(`product_${asin}`)){
            results[asin] = JSON.parse(sessionStorage.getItem(`product_${asin}`));
        }
    });

    if (asinsToFetch.length === 0) return results;

    try {
        const response = await fetch(PRODUCT_DETAILS_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ asins: asinsToFetch }),
        });
        if (!response.ok) throw new Error(`Network response was not ok`);

        const responseData = await response.json();
        const firstItem = Array.isArray(responseData) ? responseData[0] : responseData;
        const bulkData = firstItem?.get_product_details_v2?.products || firstItem?.products || firstItem;

        for (const asin of asinsToFetch) {
            const productData = bulkData[asin] || { title: 'Nume indisponibil', images: [] };
            try { sessionStorage.setItem(`product_${asin}`, JSON.stringify(productData)); } catch (_) {}
            results[asin] = productData;
        }
    } catch (error) {
        console.error('Eroare la preluarea detaliilor produselor (bulk):', error);
        for (const asin of asinsToFetch) {
            results[asin] = { title: 'Eroare la încărcare', images: [] };
        }
    }

    return results;
}

export async function addProductNote(commandId, productSku, id, note) {
    try {
        const response = await fetch(NOTES_UPDATE_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ commandId, productSku, id, note })
        });
        if (!response.ok) throw new Error(`Eroare HTTP: ${response.status}`);
        return true;
    } catch (error) {
        console.error('Network error during note add:', error);
        return false;
    }
}

export async function deleteProductNote(commandId, productSku, noteId) {
    try {
        const response = await fetch(NOTES_UPDATE_URL, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ commandId, productSku, noteId })
        });
        if (!response.ok) throw new Error(`Eroare HTTP: ${response.status}`);
        return true;
    } catch (error) {
        console.error('Network error during note delete:', error);
        return false;
    }
}

