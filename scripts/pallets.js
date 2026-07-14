// scripts/pallets.js
import { AppState, fetchDataAndSyncState, fetchProductDetailsInBulk } from './data.js';
import { router } from './app-router.js'; // Importăm router-ul

// Funcția este acum exportată pentru a fi apelată de router
export async function initPalletsPage() {
    const container = document.getElementById('pallets-list-container');
    const commandId = sessionStorage.getItem('currentCommandId');
    
    // Funcția a fost redenumită
    if (!container || !commandId) {
        router.navigateTo('commands'); // Redirecționăm la comenzi dacă lipsește ID-ul
        return;
    }

    container.innerHTML = '<p class="p-4 text-center text-gray-500">Se încarcă paleții...</p>';
    
    await fetchDataAndSyncState();

    const command = AppState.getCommands().find(c => c.id === commandId);
    if (!command || !command.products || command.products.length === 0) {
        container.innerHTML = '<p class="p-4 text-center text-gray-500">Comanda nu are produse.</p>';
        return;
    }

    // 1. Grupează produsele după manifestsku
    const pallets = new Map();
    command.products.forEach(product => {
        const key = product.manifestsku || 'No ManifestSKU';
        if (!pallets.has(key)) {
            pallets.set(key, []);
        }
        pallets.get(key).push(product);
    });

    // 2. Extrage ASIN-ul primului produs din fiecare palet pentru imagine
    const asinsToFetch = Array.from(pallets.values())
        .map(products => products[0]?.asin)
        .filter(Boolean); // Filtrează ASIN-urile nule sau goale

    const allProductDetails = await fetchProductDetailsInBulk(asinsToFetch);
    
    container.innerHTML = '';

    // 3. Afișează fiecare palet
    for (const [manifestSku, products] of pallets.entries()) {
        
        // Calculează totalurile pentru progres
        const totalExpected = products.reduce((sum, p) => sum + Number(p.expected), 0);
        const totalFound = products.reduce((sum, p) => sum + Number(p.found), 0);
        const progress = (totalExpected > 0) ? (totalFound / totalExpected) * 100 : 0;

        // Obține imaginea
        const firstProduct = products[0];
        const details = firstProduct ? allProductDetails[firstProduct.asin] : null;
        const imageUrl = details?.images?.[0] || '';

        const palletEl = document.createElement('a');
        palletEl.href = `#`; // Nu mai folosim href
        palletEl.className = 'flex items-center gap-4 bg-white p-4 transition-colors hover:bg-gray-50';
        
        palletEl.innerHTML = `
            <img alt="${manifestSku}" class="h-14 w-14 rounded-md object-cover bg-gray-200" src="${imageUrl}" />
            <div class="flex-1 min-w-0">
                <h2 class="font-medium text-gray-900 line-clamp-2">${manifestSku}</h2>
                
                <div class="w-full bg-gray-200 rounded-full h-1.5 mt-1.5">
                    <div class="bg-green-500 h-1.5 rounded-full" style="width: ${progress}%"></div>
                </div>
                
                <p class="text-sm text-gray-500 mt-1">${totalFound} din ${totalExpected}</p>
            </div>
            <span class="material-symbols-outlined text-gray-400">chevron_right</span>`;

        palletEl.addEventListener('click', (event) => {
            event.preventDefault();
            // Salvăm manifestsku-ul selectat pentru a filtra în pagina următoare
            sessionStorage.setItem('currentManifestSku', manifestSku);
            sessionStorage.setItem('currentProductId', null); // Curățăm un eventual produs selectat
            // --- START MODIFICARE ---
            // Folosim router-ul
            router.navigateTo('products');
            // --- FINAL MODIFICARE ---
        });
        container.appendChild(palletEl);
    }
}
