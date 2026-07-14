// scripts/search-handler.js
import { AppState, fetchProductDetailsInBulk } from './data.js';
import { track } from './analytics.js';

let cachedProducts = null;

export function resetSearchCache() {
    cachedProducts = null;
}

export function initSearchHandler(navigateTo) {
    const pageContent = document.getElementById('product-detail-page-content');
    const searchTriggerButton = document.getElementById('search-trigger-button');
    const searchOverlay = document.getElementById('search-overlay');

    let openSearch;

    if (searchTriggerButton && searchOverlay && pageContent) {
        const closeSearch = () => {
            searchOverlay.classList.add('hidden');
            searchOverlay.innerHTML = '';
            pageContent.style.filter = 'none';
        };

        const selectProduct = (commandId, productId, manifestSku) => {
            sessionStorage.setItem('currentCommandId', commandId);
            sessionStorage.setItem('currentProductId', productId);
            sessionStorage.setItem('currentManifestSku', manifestSku || 'No ManifestSKU');
            navigateTo('product-detail');
            closeSearch();
        };

        const renderResults = (resultsContainer, query) => {
            if (query.length < 2) {
                resultsContainer.innerHTML = '<p class="text-gray-500 text-center">Introduceți cel puțin 2 caractere.</p>';
                return;
            }
            const filtered = cachedProducts.filter(p =>
                p.details.title.toLowerCase().includes(query) ||
                p.asin.toLowerCase().includes(query)
            );
            if (filtered.length === 0) {
                resultsContainer.innerHTML = '<p class="text-gray-500 text-center">Niciun produs găsit.</p>';
                return;
            }
            resultsContainer.innerHTML = filtered.map(product => `
                <div class="flex items-center gap-4 p-2 transition-colors rounded-lg cursor-pointer hover:bg-gray-100 search-result-item" data-command-id="${product.commandId}" data-product-id="${product.id}" data-manifest-sku="${product.manifestsku || 'No ManifestSKU'}">
                    <img alt="${product.details.title}" class="h-12 w-12 rounded-md object-cover bg-gray-200" src="${product.details.images[0] || ''}" />
                    <div class="flex-1 min-w-0">
                        <p class="font-medium text-gray-900 line-clamp-2">${product.details.title}</p>
                        <p class="text-sm text-gray-500">Comanda: ${product.commandName.replace('Comanda #', '#')} · Palet: ${product.manifestsku || 'N/A'}</p>
                        <p class="text-xs text-gray-400 font-mono truncate">${product.asin}</p>
                    </div>
                </div>
            `).join('');
            resultsContainer.querySelectorAll('.search-result-item').forEach(item => {
                item.addEventListener('click', () => selectProduct(item.dataset.commandId, item.dataset.productId, item.dataset.manifestSku));
            });
        };

        openSearch = async () => {
            track('search_opened');
            pageContent.style.filter = 'blur(5px)';
            searchOverlay.classList.remove('hidden');
            searchOverlay.innerHTML = `
                <div class="absolute inset-0 bg-gray-900 bg-opacity-50" id="search-bg"></div>
                <div class="relative w-full max-w-md p-4 mx-auto mt-16 bg-white rounded-xl shadow-lg animate-slide-down" style="animation-duration: 0.3s;">
                    <div class="flex items-center">
                        <span class="material-symbols-outlined text-gray-400 absolute left-7">search</span>
                        <input type="text" id="search-input" placeholder="Caută după nume sau ASIN..." class="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500">
                        <button id="close-search-btn" class="ml-2 p-2 text-gray-500 hover:text-gray-800">
                            <span class="material-symbols-outlined">close</span>
                        </button>
                    </div>
                    <div id="search-results-container" class="mt-4 max-h-96 overflow-y-auto">
                        <p class="text-gray-500 text-center">Introduceți cel puțin 2 caractere.</p>
                    </div>
                </div>
            `;

            const searchInput = document.getElementById('search-input');
            const resultsContainer = document.getElementById('search-results-container');
            document.getElementById('close-search-btn').addEventListener('click', closeSearch);
            document.getElementById('search-bg').addEventListener('click', closeSearch);
            searchInput.focus();

            if (cachedProducts) {
                searchInput.addEventListener('input', () => renderResults(resultsContainer, searchInput.value.toLowerCase().trim()));
                return;
            }

            const allCommands = AppState.getCommands();
            if (!allCommands || allCommands.length === 0) {
                resultsContainer.innerHTML = '<p class="text-gray-500 text-center">Nu există comenzi pentru a căuta produse.</p>';
                return;
            }

            resultsContainer.innerHTML = '<p class="text-gray-500 text-center">Se încarcă produsele...</p>';

            let allProducts = [];
            allCommands.forEach(command => {
                command.products.forEach(product => {
                    allProducts.push({ ...product, commandId: command.id, commandName: command.name });
                });
            });

            searchInput.addEventListener('input', () => {
                if (cachedProducts) renderResults(resultsContainer, searchInput.value.toLowerCase().trim());
            });

            const productDetails = await fetchProductDetailsInBulk(allProducts.map(p => p.asin));
            cachedProducts = allProducts.map(p => ({
                ...p,
                details: productDetails[p.asin] || { title: 'Nume indisponibil', images: [] }
            }));

            renderResults(resultsContainer, searchInput.value.toLowerCase().trim());
        };

        searchTriggerButton.addEventListener('click', openSearch);
    }

    // --- START: Redirection logic from other pages ---
    // (Această logică a fost înlocuită de scanner-ul LPN, 
    // dar o lăsăm aici pentru a gestiona căutarea declanșată din context)
    // De fapt, o vom scoate pentru a nu crea confuzie. 
    // Butonul de search din footer e acum scanner.
    
    // Returnăm funcția openSearch pentru a fi folosită de router
    return openSearch;
}
