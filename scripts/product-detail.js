import { AppState, fetchDataAndSyncState, sendStockUpdate, fetchProductDetailsInBulk, addProductNote, deleteProductNote, resolveProductInCommand } from './data.js';
import { router } from './app-router.js';
import { isPrinterConnected, discoverAndConnect, printLabel, showToast, preCacheProductLabels } from './printer-handler.js';
import { track } from './analytics.js';

let currentCommandId = null, currentProductId = null, currentProduct = null;
let swiper = null, pressTimer = null, clickHandler = null;
let stockStateAtModalOpen = {}, stockStateInModal = {};
let pageElements = {};
let currentNotes = [];
let currentImages = [];
let lightboxIndex = 0;
let lightboxEl = null;

const getLatestProductData = () => {
    const command = AppState.getCommands().find(c => c.id === currentCommandId);
    if (!command) return null;
    // Scoped by palet (manifestsku), nu doar productsku - vezi resolveProductInCommand în data.js.
    return resolveProductInCommand(command, currentProductId, sessionStorage.getItem('currentManifestSku')).product;
};

const calculateDelta = (before, after) => 
    Object.keys(before).reduce((acc, key) => {
        const diff = (Number(after[key]) || 0) - (Number(before[key]) || 0);
        return diff !== 0 ? { ...acc, [key]: diff } : acc;
    }, {});

const renderPageContent = () => {
    currentProduct = getLatestProductData();
    if (!currentProduct) return;

    const { expected, suggestedcondition, found, state } = currentProduct;
    pageElements.expectedStock.textContent = expected;
    pageElements.suggestedCondition.textContent = suggestedcondition;
    pageElements.totalFound.textContent = found;

    Object.entries(state).forEach(([condition, val]) => {
        const el = document.querySelector(`[data-summary="${condition}"]`);
        if (el) el.textContent = val;
    });

    const setAsNewBtn = document.getElementById('set-as-new-button');
    if (setAsNewBtn) {
        setAsNewBtn.classList.toggle('hidden', Number(expected) !== 1 || Number(found) !== 0);
    }
};

const renderProductDetails = async (productAsin) => {
    pageElements.title.textContent = 'Se încarcă...';
    pageElements.asin.textContent = '...';

    const details = (await fetchProductDetailsInBulk([productAsin]))[productAsin];
    pageElements.title.textContent = details?.title || 'Nume indisponibil';
    pageElements.asin.textContent = productAsin || 'ASIN indisponibil';

    const images = details?.images || [];
    currentImages = images;
    pageElements.imageWrapper.innerHTML = images.length === 0
        ? `<div class="swiper-slide bg-gray-200 flex items-center justify-center"><span class="material-symbols-outlined text-gray-400 text-6xl">hide_image</span></div>`
        : images.map(img => `<div class="swiper-slide" style="background-image: url('${img}')"></div>`).join('');

    if (swiper) swiper.destroy(true, true);
    swiper = new Swiper('#image-swiper-container', { pagination: { el: '.swiper-pagination' } });

    // Notele vin din randul de comanda (unic per productsku), nu din lookup-ul de titlu/poze (unic per ASIN).
    currentNotes = Array.isArray(currentProduct?.notes) ? currentProduct.notes : [];
    renderNotes();
};

const buildLightbox = () => {
    if (lightboxEl) return lightboxEl;
    const el = document.createElement('div');
    el.id = 'image-lightbox';
    el.className = 'fixed inset-0 z-[60] hidden bg-black/90 flex items-center justify-center';
    el.innerHTML = `
        <button id="lightbox-close-btn" class="lightbox-nav-btn absolute top-4 right-4 flex h-10 w-10 items-center justify-center rounded-full bg-black/50 text-white">
            <span class="material-symbols-outlined">close</span>
        </button>
        <button id="lightbox-prev-btn" class="lightbox-nav-btn absolute left-2 top-1/2 -translate-y-1/2 flex h-10 w-10 items-center justify-center rounded-full bg-black/50 text-white">
            <span class="material-symbols-outlined">chevron_left</span>
        </button>
        <img id="lightbox-img" class="max-h-full max-w-full" style="object-fit: contain;" src="" alt="">
        <button id="lightbox-next-btn" class="lightbox-nav-btn absolute right-2 top-1/2 -translate-y-1/2 flex h-10 w-10 items-center justify-center rounded-full bg-black/50 text-white">
            <span class="material-symbols-outlined">chevron_right</span>
        </button>`;
    document.body.appendChild(el);

    el.querySelector('#lightbox-close-btn').addEventListener('click', closeLightbox);
    el.querySelector('#lightbox-prev-btn').addEventListener('click', () => showLightboxImage(lightboxIndex - 1));
    el.querySelector('#lightbox-next-btn').addEventListener('click', () => showLightboxImage(lightboxIndex + 1));
    el.addEventListener('click', (e) => {
        if (e.target === el) closeLightbox();
    });

    lightboxEl = el;
    return el;
};

const showLightboxImage = (index) => {
    if (!currentImages.length) return;
    lightboxIndex = ((index % currentImages.length) + currentImages.length) % currentImages.length;
    const img = lightboxEl.querySelector('#lightbox-img');
    img.src = currentImages[lightboxIndex];
};

const openLightbox = () => {
    if (!currentImages.length) return;
    const el = buildLightbox();
    const startIndex = swiper ? (swiper.activeIndex || 0) : 0;
    showLightboxImage(startIndex);
    el.classList.remove('hidden');
};

const closeLightbox = () => {
    if (!lightboxEl) return;
    lightboxEl.classList.add('hidden');
};

const renderNotes = () => {
    const list = pageElements.notesList;
    if (!list) return;
    list.innerHTML = '';

    if (currentNotes.length === 0) {
        const empty = document.createElement('p');
        empty.className = 'text-sm text-amber-700 italic';
        empty.textContent = 'Nicio notiță momentan.';
        list.appendChild(empty);
        return;
    }

    currentNotes.forEach(note => {
        const row = document.createElement('div');
        row.className = 'flex items-start justify-between gap-2 bg-white/70 border border-amber-200 rounded-lg p-2';
        if (note.pending) row.classList.add('opacity-60');

        const textEl = document.createElement('p');
        textEl.className = 'text-sm text-amber-900 flex-1 break-words';
        textEl.textContent = note.text; // textContent only — never innerHTML for user-supplied note text
        row.appendChild(textEl);

        if (note.pending) {
            const badge = document.createElement('span');
            badge.className = 'text-xs text-amber-600 flex-shrink-0';
            badge.textContent = 'nesalvat...';
            row.appendChild(badge);
        }

        const delBtn = document.createElement('button');
        delBtn.className = 'flex-shrink-0 text-amber-600 hover:text-red-600';
        delBtn.innerHTML = '<span class="material-symbols-outlined text-lg">delete</span>';
        delBtn.onclick = () => handleDeleteNote(note.id);
        row.appendChild(delBtn);

        list.appendChild(row);
    });
};

// Persista currentNotes (deja mutat) inapoi in AppState, ca sursa unica de adevar per (comanda, productsku).
const persistCurrentNotes = () => {
    if (currentProduct) currentProduct.notes = currentNotes;
    AppState.setCommands(AppState.getCommands());
};

const handleAddNote = async () => {
    const input = pageElements.newNoteInput;
    const text = input?.value?.trim();
    if (!text) return;
    if (!currentProduct?.id) return showToast('Eroare: produsul nu are un identificator unic.');

    const note = { id: crypto.randomUUID(), text, pending: true };
    currentNotes.push(note);
    renderNotes();
    input.value = '';

    const ok = await addProductNote(currentCommandId, currentProduct.id, currentProduct.manifestsku, note.id, text);

    if (ok) {
        note.pending = false;
        persistCurrentNotes();
        renderNotes();
        showToast('Notiță salvată.', 2000);
    } else {
        note.pending = false;
        note.failed = true;
        renderNotes();
        showToast('Eroare la salvarea notiței. Încearcă din nou.', 4000);
    }
};

const handleDeleteNote = async (noteId) => {
    const idx = currentNotes.findIndex(n => n.id === noteId);
    if (idx === -1) return;
    const [removed] = currentNotes.splice(idx, 1);
    renderNotes();

    if (!currentProduct?.id) return;
    const ok = await deleteProductNote(currentCommandId, currentProduct.id, currentProduct.manifestsku, noteId);

    if (ok) {
        persistCurrentNotes();
        showToast('Notiță ștearsă.', 2000);
    } else {
        // Roll back: put the note back so the user's data isn't silently lost.
        currentNotes.splice(idx, 0, removed);
        renderNotes();
        showToast('Eroare la ștergerea notiței. Încearcă din nou.', 4000);
    }
};

const conditionMap = { 'new': 'CN', 'very-good': 'FB', 'good': 'B' };

const handleSaveChanges = () => {
    const saveButton = document.getElementById('save-btn');
    saveButton.disabled = true;
    saveButton.textContent = 'Se salvează...';

    const asin = currentProduct?.asin;
    if (!asin?.trim()) {
        alert(`EROARE: ASIN invalid.`);
        saveButton.disabled = false;
        saveButton.textContent = 'Salvează';
        return;
    }

    const delta = calculateDelta(stockStateAtModalOpen, stockStateInModal);
    if (Object.keys(delta).length === 0) return hideModal();

    const printQueue = Object.entries(delta)
        .filter(([cond, qty]) => qty > 0 && conditionMap[cond])
        .map(([cond, quantity]) => ({ code: asin, conditionLabel: conditionMap[cond], quantity }));

    hideModal();

    (async () => {
        if (!printQueue.length) return;
        showToast(`Se inițiază imprimarea pentru ${printQueue.reduce((acc, item) => acc + item.quantity, 0)} etichete...`);
        for (const { code, conditionLabel, quantity } of printQueue) {
            try {
                showToast(`Se printează ${quantity} etichete pentru ${code}`);
                await printLabel(code, conditionLabel, quantity);
                await new Promise(res => setTimeout(res, 3000));
            } catch (e) {
                showToast(`Eroare la imprimare.`);
                return;
            }
        }
        showToast(`S-a finalizat imprimarea.`);
    })();

    (async () => {
        try {
            if (await sendStockUpdate(currentCommandId, currentProduct.id, asin, currentProduct.manifestsku, delta)) {
                await fetchDataAndSyncState();
                renderPageContent();
            } else alert('EROARE la salvarea datelor!');
        } catch (error) {
            alert(`EROARE CRITICĂ: ${error.message}`);
        }
    })();
};

const showPrinterModal = () => {
    pageElements.printerModal.classList.remove('hidden');
    pageElements.printerModal.innerHTML = `
        <div class="absolute bottom-0 w-full max-w-md mx-auto left-0 right-0 bg-white rounded-t-2xl shadow-lg p-4 animate-slide-down">
            <div class="text-center mb-4">
                <span class="material-symbols-outlined text-6xl text-blue-600">print</span>
                <h2 id="printer-status" class="text-gray-500 mt-2">Apasă pentru a te conecta</h2>
            </div>
            <div class="mt-6 space-y-3">
                <button id="connect-btn" class="w-full flex items-center justify-center gap-2 rounded-lg bg-blue-600 py-3 text-base font-bold text-white shadow-md hover:bg-blue-700">
                    <span class="material-symbols-outlined">bluetooth_searching</span>
                    Caută Imprimantă
                </button>
                <button id="close-printer-modal-btn" class="w-full mt-2 rounded-lg bg-gray-200 py-3 font-bold text-gray-700">Anulează</button>
            </div>
        </div>`;
        
    const connectBtn = document.getElementById('connect-btn');
    connectBtn.onclick = async () => {
        connectBtn.disabled = true;
        connectBtn.textContent = 'Se conectează...';
        await discoverAndConnect(msg => {
            document.getElementById('printer-status').textContent = msg;
            if (isPrinterConnected()) {
                hidePrinterModal();
                showModal();
            }
        });
        connectBtn.disabled = false;
        connectBtn.textContent = 'Caută Imprimantă';
    };
    document.getElementById('close-printer-modal-btn').onclick = hidePrinterModal;
};

const hidePrinterModal = () => {
    const modalContent = pageElements.printerModal.querySelector('div');
    if (!modalContent) return;
    modalContent.classList.replace('animate-slide-down', 'animate-slide-up');
    setTimeout(() => {
        pageElements.printerModal.classList.add('hidden');
        pageElements.printerModal.innerHTML = '';
    }, 300);
};

const createCounter = (id, label, value, isDanger = false) => `
    <div class="flex items-center justify-between py-3 border-b">
        <span class="text-lg font-medium ${isDanger ? 'text-red-600' : 'text-gray-800'}">${label}</span>
        <div class="flex items-center gap-3">
            ${conditionMap[id] ? `<button data-print-condition="${conditionMap[id]}" class="print-one-btn rounded-full bg-gray-100 border border-gray-300 w-8 h-8 flex items-center justify-center text-gray-600 hover:bg-gray-200" title="Printează 1 etichetă">
                <span class="material-symbols-outlined text-base">print</span>
            </button>` : ''}
            <button data-action="minus" data-target="${id}" class="control-btn rounded-full bg-gray-200 w-8 h-8 flex items-center justify-center text-lg font-bold select-none">-</button>
            <input type="number" id="count-${id}" value="${value}" class="text-xl font-bold w-16 text-center border-gray-300 rounded-md shadow-sm">
            <button data-action="plus" data-target="${id}" class="control-btn rounded-full bg-gray-200 w-8 h-8 flex items-center justify-center text-lg font-bold select-none">+</button>
        </div>
    </div>`;

const updateValue = (target, newValue) => {
    const cleanValue = Math.max(0, parseInt(newValue, 10) || 0);
    stockStateInModal[target] = cleanValue;
    document.getElementById(`count-${target}`).value = cleanValue;
};

const showModal = () => {
    currentProduct = getLatestProductData();
    if (!currentProduct) return;
    
    stockStateAtModalOpen = { ...currentProduct.state };
    stockStateInModal = { ...currentProduct.state };

    track('stock_modal_opened', { asin: currentProduct.asin, state_at_open: stockStateAtModalOpen });

    pageElements.stockModal.innerHTML = `
        <div class="absolute bottom-0 w-full max-w-md mx-auto left-0 right-0 bg-white rounded-t-2xl shadow-lg p-4 animate-slide-down">
            <h3 class="text-xl font-bold text-center mb-4">Adaugă / Modifică Stoc</h3>
            ${createCounter('new', 'Ca Nou', stockStateInModal['new'])}
            ${createCounter('very-good', 'Foarte Bun', stockStateInModal['very-good'])}
            ${createCounter('good', 'Bun', stockStateInModal['good'])}
            ${createCounter('broken', 'Defect', stockStateInModal['broken'], true)}
            <div class="flex gap-3 mt-6">
                <button id="close-modal-btn" class="w-1/2 rounded-lg bg-gray-200 py-3 font-bold text-gray-700">Anulează</button>
                <button id="save-btn" class="w-1/2 rounded-lg bg-[var(--primary-color)] py-3 font-bold text-white">Salvează</button>
            </div>
        </div>`;
        
    addModalEventListeners();
    pageElements.stockModal.classList.remove('hidden');
};

const hideModal = () => {
    const modalContent = pageElements.stockModal.querySelector('div');
    if (!modalContent) return;
    modalContent.classList.replace('animate-slide-down', 'animate-slide-up');
    setTimeout(() => {
        pageElements.stockModal.classList.add('hidden');
        pageElements.stockModal.innerHTML = '';
    }, 300);
};

const addModalEventListeners = () => {
    pageElements.stockModal.querySelectorAll('.control-btn').forEach(btn => {
        const { action, target } = btn.dataset;
        let longPressFired = false;
        const clickHnd = () => {
            if (longPressFired) {
                longPressFired = false;
                return;
            }
            const currentVal = Number(stockStateInModal[target]) || 0;
            updateValue(target, action === 'plus' ? currentVal + 1 : currentVal - 1);
        };
        const startPress = (e) => {
            e.preventDefault();
            longPressFired = false;
            pressTimer = setTimeout(() => {
                longPressFired = true;
                updateValue(target, action === 'minus' ? 0 : currentProduct.expected);
            }, 3000);
        };
        const endPress = () => {
            clearTimeout(pressTimer);
        };

        btn.addEventListener('mousedown', startPress);
        btn.addEventListener('mouseup', endPress);
        btn.addEventListener('mouseleave', endPress);
        btn.addEventListener('touchstart', startPress, { passive: false });
        btn.addEventListener('touchend', endPress);
        btn.addEventListener('click', clickHnd);
    });

    pageElements.stockModal.querySelectorAll('input[type="number"]').forEach(input =>
        input.addEventListener('input', e => updateValue(e.target.id.replace('count-', ''), e.target.value))
    );

    pageElements.stockModal.querySelectorAll('.print-one-btn').forEach(btn => {
        btn.addEventListener('click', () => handlePrintOne(btn.dataset.printCondition));
    });

    document.getElementById('save-btn').onclick = handleSaveChanges;
    document.getElementById('close-modal-btn').onclick = hideModal;
};

const handlePrintOne = async (conditionLabel) => {
    const asin = currentProduct?.asin;
    if (!asin?.trim()) return showToast('Eroare: ASIN invalid.', 4000);

    if (!isPrinterConnected()) {
        showToast('Conectează imprimanta înainte de a printa.', 4000);
        showPrinterModal();
        return;
    }

    try {
        showToast(`Se printează 1 etichetă (${conditionLabel})...`);
        await printLabel(asin, conditionLabel, 1);
        showToast('Eticheta a fost printată.', 2000);
    } catch (e) {
        showToast('Eroare la imprimare.', 4000);
    }
};

const initializePageContent = async () => {
    currentCommandId = sessionStorage.getItem('currentCommandId');
    currentProductId = sessionStorage.getItem('currentProductId');
    
    if (!currentCommandId || !currentProductId) return router.navigateTo('commands');
    
    await fetchDataAndSyncState();
    currentProduct = getLatestProductData();
    
    if (!currentProduct) {
        alert('Produsul nu a fost gasit');
        return router.navigateTo('products');
    }
    
    renderPageContent();
    await renderProductDetails(currentProduct.asin);
    if (currentProduct.asin) preCacheProductLabels(currentProduct.asin);

    track('product_detail_opened', { asin: currentProduct.asin });
};

export const initProductDetailPage = async (context = {}, openSearch) => {
    pageElements = {
        title: document.getElementById('product-detail-title'),
        asin: document.getElementById('product-detail-asin'),
        expectedStock: document.getElementById('expected-stock'),
        suggestedCondition: document.getElementById('suggested-condition'),
        totalFound: document.getElementById('total-found'),
        imageWrapper: document.getElementById('product-image-wrapper'),
        imageSwiperContainer: document.getElementById('image-swiper-container'),
        stockModal: document.getElementById('stock-modal'),
        printerModal: document.getElementById('printer-modal'),
        openModalButton: document.getElementById('open-stock-modal-button'),
        searchTriggerButton: document.getElementById('search-trigger-button'),
        notesList: document.getElementById('product-notes-list'),
        newNoteInput: document.getElementById('new-note-input'),
        addNoteButton: document.getElementById('add-note-button')
    };

    document.getElementById('back-to-list-button').onclick = e => {
        e.preventDefault();
        router.navigateTo('products');
    };

    if (pageElements.addNoteButton) pageElements.addNoteButton.onclick = handleAddNote;
    if (pageElements.newNoteInput) {
        pageElements.newNoteInput.onkeydown = (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                handleAddNote();
            }
        };
    }
    if (pageElements.searchTriggerButton && openSearch) pageElements.searchTriggerButton.onclick = openSearch;
    pageElements.openModalButton.onclick = () => isPrinterConnected() ? showModal() : showPrinterModal();

    if (pageElements.imageSwiperContainer) {
        pageElements.imageSwiperContainer.addEventListener('click', (e) => {
            if (e.target.closest('.swiper-pagination')) return;
            openLightbox();
        });
    }

    const setAsNewButton = document.getElementById('set-as-new-button');
    if (setAsNewButton) {
        setAsNewButton.onclick = async () => {
            if (!currentProduct?.asin) return showToast('ASIN indisponibil.', 4000);
            if (!isPrinterConnected()) return showToast('Atenție: Imprimanta nu este conectată!', 5000);

            setAsNewButton.disabled = true;
            setAsNewButton.textContent = 'Se procesează...';

            const asin = currentProduct.asin;
            
            (async () => {
                try {
                    showToast(`Se printează eticheta pentru ${asin}...`);
                    await printLabel(asin, 'CN', 1);
                    showToast('S-a finalizat imprimarea.');
                } catch {
                    showToast('Eroare la imprimare.');
                }
            })();

            (async () => {
                try {
                    if (await sendStockUpdate(currentCommandId, currentProduct.id, asin, currentProduct.manifestsku, { new: 1 })) {
                        await fetchDataAndSyncState();
                        renderPageContent();
                    } else alert('EROARE la salvarea datelor!');
                } catch (err) {
                    alert(`EROARE CRITICĂ: ${err.message}`);
                } finally {
                    setAsNewButton.disabled = false;
                    setAsNewButton.textContent = 'E Ca Nou';
                }
            })();
        };
    }
    
    await initializePageContent();
    if (context.search && openSearch) openSearch();
};
