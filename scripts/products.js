// scripts/products.js
// --- START MODIFICARE: Importă noile funcții/constante ---
import { AppState, fetchDataAndSyncState, fetchProductDetailsInBulk } from './data.js';
import { router } from './app-router.js';
import { showToast } from './printer-handler.js'; // Refolosim funcția de notificare
// --- FINAL MODIFICARE ---

// --- START MODIFICARE: Adaugă URL-ul webhook-ului n8n ---
// (Acesta este URL-ul complet bazat pe calea 'fix-duplicate-sku' din n8n)
const FIX_DUPLICATE_SKU_URL = 'https://automatizare.comandat.ro/webhook/fix-duplicate-sku';
// --- FINAL MODIFICARE ---


// --- START MODIFICARE: Adaugă această funcție nouă ---
/**
 * Apelează webhook-ul n8n pentru a repara SKU-urile duplicate.
 */
async function handleFixDuplicates() {
    // 1. Obține datele curente
    const orderId = sessionStorage.getItem('currentCommandId');
    const manifestSkuFromStorage = sessionStorage.getItem('currentManifestSku'); // Acesta poate fi 'No ManifestSKU'

    // 2. Cere utilizatorului ASIN-ul
    const asin = prompt("Introduceți ASIN-ul care are SKU-uri duplicate în acest palet:");
    
    if (!asin || asin.trim() === '') {
        showToast('Operațiune anulată.', 2000);
        return;
    }

    // 3. Pregătește payload-ul
    const payload = {
        orderId: orderId,
        // --- AICI ESTE FIX-UL CRITIC ---
        // Trimitem 'null' către n8n dacă valoarea este 'No ManifestSKU',
        // altfel trimitem valoarea normală.
        manifestsku: manifestSkuFromStorage === 'No ManifestSKU' ? null : manifestSkuFromStorage,
        asin: asin.trim()
    };

    const button = document.getElementById('fix-duplicates-button');
    if (button) button.disabled = true;
    showToast('Se procesează...', 2000);

    try {
        // 4. Apelează Webhook-ul
        const response = await fetch(FIX_DUPLICATE_SKU_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!response.ok) throw new Error('Răspuns eșuat de la server.');
        
        const result = await response.json();
        if (result.status !== 'success') throw new Error('Serverul nu a putut executa comanda.');

        // 5. Succes: Reîncarcă lista de produse
        showToast('SKU-urile au fost reparate! Se reîncarcă lista.', 3000);
        
        // Re-rulează funcția de inițializare a paginii curente
        // pentru a prelua noile date (fetchDataAndSyncState) și a re-renda lista.
        await initProductsPage(); 

    } catch (error) {
        console.error('Eroare la fixarea SKU-urilor:', error);
        showToast(`Eroare: ${error.message}`, 4000);
    } finally {
        if (button) button.disabled = false;
    }
}
// --- FINAL MODIFICARE ---


// Funcția este acum exportată pentru a fi apelată de router
export async function initProductsPage() {
    const container = document.getElementById('products-list-container');
    const commandId = sessionStorage.getItem('currentCommandId');
    
    // --- START MODIFICARE ---
    // Preluăm manifest-ul selectat
    const manifestSku = sessionStorage.getItem('currentManifestSku');
    
    // Actualizăm butonul "înapoi" și titlul
    const backButton = document.getElementById('back-to-pallets-button');
    const pageTitle = document.getElementById('products-page-title');

    if (pageTitle) {
        pageTitle.textContent = manifestSku ? `Produse - ${manifestSku.substring(0, 15)}...` : 'Produse';
    }
    
    // Modificăm listener-ul butonului de back să folosească router-ul
    if (backButton) {
        // Setăm listener pentru a curăța manifestSku la întoarcere
        // Folosim .onclick pentru a suprascrie listenerii anteriori și a evita dublarea
        backButton.onclick = (e) => {
            e.preventDefault();
            sessionStorage.removeItem('currentManifestSku');
            router.navigateTo('pallets');
        };
    }
    
    // --- START MODIFICARE: Adaugă listener pentru noul buton ---
    const fixDuplicatesButton = document.getElementById('fix-duplicates-button');
    if (fixDuplicatesButton) {
        fixDuplicatesButton.onclick = handleFixDuplicates;
    }
    // --- FINAL MODIFICARE ---
    
    if (!manifestSku) {
        console.warn('Niciun manifest SKU selectat. Se afișează toate produsele.');
        // Opțional, ai putea redirecționa înapoi la paleți
        // router.navigateTo('pallets');
        // return;
    }
    // --- FINAL MODIFICARE ---

    // Funcția de randare rămâne în interiorul inițializatorului
    async function renderProductsList() {
        if (!container || !commandId) return;

        container.innerHTML = '<p class="p-4 text-center text-gray-500">Se actualizează...</p>';
        
        await fetchDataAndSyncState();

        const command = AppState.getCommands().find(c => c.id === commandId);
        if (!command || !command.products || command.products.length === 0) {
            container.innerHTML = '<p class="p-4 text-center text-gray-500">Comanda nu are produse.</p>';
            return;
        }

        // --- START MODIFICARE ---
        // Filtrăm produsele pe baza manifestSku-ului selectat
        let filteredProducts = command.products.filter(p => {
            if (manifestSku === 'No ManifestSKU') {
                return !p.manifestsku; // Potrivire pentru cele nule sau goale
            }
            return p.manifestsku === manifestSku;
        });

        // --- START MODIFICARE (Sortare) ---
// --- START MODIFICARE (Sortare) ---
        // Sortăm lista
        filteredProducts.sort((a, b) => {
            const aComplete = Number(a.found) >= Number(a.expected);
            const bComplete = Number(b.found) >= Number(b.expected);

            // 1. Logica principală: Produsele complete merg la final
            const primarySort = aComplete - bComplete;
            
            if (primarySort !== 0) {
                // Unul este complet și celălalt nu, deci sortarea principală se aplică
                return primarySort; 
            }

            // 2. Logica secundară: Ambele sunt la fel (fie complete, fie incomplete)
            
            // Dacă ambele sunt INCOMPLETE (!aComplete este adevărat)
            if (!aComplete) {
                // Le sortăm descrescător după cantitatea 'expected'
                return Number(b.expected) - Number(a.expected);
            }
            
            // Altfel, ambele sunt complete. Nu se aplică o sortare suplimentară.
            return 0;
        });
        // --- FINAL MODIFICARE (Sortare) ---

        if (filteredProducts.length === 0) {
            container.innerHTML = '<p class="p-4 text-center text-gray-500">Acest palet nu are produse.</p>';
            return;
        }

        const asins = filteredProducts.map(p => p.asin);
        // --- FINAL MODIFICARE ---
        
        const allProductDetails = await fetchProductDetailsInBulk(asins);
        
        container.innerHTML = '';

        // --- START MODIFICARE ---
        // Folosim `filteredProducts` în loc de `command.products`
        filteredProducts.forEach(product => {
        // --- FINAL MODIFICARE ---
            const details = allProductDetails[product.asin];
            const productName = details?.title || 'Nume indisponibil';
            const imageUrl = details?.images?.[0] || '';

            const productEl = document.createElement('a');
            productEl.href = `#`; // Nu mai folosim href
            productEl.className = 'flex items-center gap-4 bg-white p-4 transition-colors hover:bg-gray-50';
            
            // --- START MODIFICARE: Adăugăm o clasă pentru produsele complete ---
            // Adăugăm un fundal verde pal și opacitate redusă pentru produsele complete
            if (Number(product.found) >= Number(product.expected)) {
                 productEl.className += ' bg-green-50 opacity-80';
            }
            // --- FINAL MODIFICARE ---

            productEl.innerHTML = `
                <img alt="${productName}" class="h-14 w-14 rounded-md object-cover bg-gray-200" src="${imageUrl}" />
                <div class="flex-1 min-w-0">
                    <p class="font-medium text-gray-900 line-clamp-2">${productName}</p>
                    <p class="text-sm text-gray-500">${product.found} din ${product.expected}</p>
                    <p class="text-xs text-gray-400 font-mono truncate">${product.asin}</p>
                </div>
                <span class="material-symbols-outlined text-gray-400">chevron_right</span>`;

            productEl.addEventListener('click', (event) => {
                event.preventDefault();
                sessionStorage.setItem('currentProductId', product.id);
                sessionStorage.setItem('currentManifestSku', manifestSku);
                // --- START MODIFICARE ---
                // Folosim router-ul
                router.navigateTo('product-detail');
                // --- FINAL MODIFICARE ---
            });
            container.appendChild(productEl);
        });
    }

    await renderProductsList(); // Apelăm funcția de randare
}

