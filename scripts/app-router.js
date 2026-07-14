import { autoConnectToPrinter } from './printer-handler.js';
import { initCommandsPage } from './main.js';
import { initPalletsPage } from './pallets.js';
import { initProductsPage } from './products.js';
import { initProductDetailPage } from './product-detail.js';
import { initAddProductPage } from './add-product.js';
import { initSearchHandler } from './search-handler.js';
import { initScannerHandler, initHardwareScannerHandler } from './scanner.js';

let openSearchFunction = () => {};
let pages = {};
let suppressNextHashChange = false;

function navigateTo(pageId, context = {}) {
    Object.values(pages).forEach(page => page.classList.add('hidden'));

    const targetPage = pages[pageId];
    if (targetPage) {
        targetPage.classList.remove('hidden');
        window.scrollTo(0, 0);

        if (window.location.hash !== '#' + pageId) {
            suppressNextHashChange = true;
            window.location.hash = pageId;
        }

        switch (pageId) {
            case 'commands':
                initCommandsPage();
                break;
            case 'pallets':
                initPalletsPage();
                break;
            case 'products':
                initProductsPage();
                break;
            case 'product-detail':
                initProductDetailPage(context, openSearchFunction);
                break;
            case 'add-product':
                initAddProductPage();
                break;
        }
        
        updateFooterActiveState(pageId);

    } else {
        console.warn(`Pagina cu ID-ul '${pageId}' nu a fost găsită.`);
    }
}

function updateFooterActiveState(activePageId) {
    document.querySelectorAll('footer [data-nav]').forEach(button => {
        const page = button.dataset.nav;

        button.classList.remove('text-[var(--primary-color)]');
        button.classList.add('text-gray-500', 'hover:text-[var(--primary-color)]');

        if (page === activePageId || (activePageId.includes('product') && page === 'products')) {
             button.classList.add('text-[var(--primary-color)]');
             button.classList.remove('text-gray-500', 'hover:text-[var(--primary-color)]');
        }
        if (['commands', 'pallets', 'products', 'product-detail'].includes(activePageId) && page === 'commands') {
             button.classList.add('text-[var(--primary-color)]');
             button.classList.remove('text-gray-500', 'hover:text-[var(--primary-color)]');
        }
    });
    
    document.querySelectorAll('#footer-scan-trigger').forEach(button => {
        button.classList.remove('text-[var(--primary-color)]');
        button.classList.add('text-gray-500', 'hover:text-[var(--primary-color)]');
    });
}

function handleHashChange() {
    if (suppressNextHashChange) {
        suppressNextHashChange = false;
        return;
    }
    const pageId = window.location.hash.substring(1);
    if (pageId && pages[pageId]) {
        navigateTo(pageId);
    } else {
        navigateTo('commands');
    }
}

export const router = {
    navigateTo
};

document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('[data-page]').forEach(page => {
        pages[page.dataset.page] = page;
    });

    autoConnectToPrinter();
    
    openSearchFunction = initSearchHandler(navigateTo);
    initScannerHandler();
    initHardwareScannerHandler();

    document.body.addEventListener('click', (e) => {
        const navButton = e.target.closest('[data-nav]');
        if (navButton) {
            e.preventDefault();
            const targetPage = navButton.dataset.nav;
            navigateTo(targetPage);
        }
    });

    window.addEventListener('hashchange', handleHashChange);
    
    handleHashChange();
});
