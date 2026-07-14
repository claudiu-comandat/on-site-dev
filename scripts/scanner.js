import { router } from './app-router.js';
import { AppState, resolveProductInCommand } from './data.js';
import { showToast } from './printer-handler.js';
import { track } from './analytics.js';

const JOBALOTS_MANIFEST_URL = 'https://live1.jobalots.com/api/download-manifest';
const MANIFEST_PROXY_URL = 'https://automatizare.comandat.ro/webhook/manifest-proxy';
const JOBALOTS_BEARER_TOKEN = 'eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiJ9.eyJhdWQiOiI1IiwianRpIjoiN2YxZTk3YWMyMmQ3ODBhZTE4YjlkM2IwOWQ3YjMxMTliMDdmYTc0Y2ExMzQzODJkM2M5NjIwMGViY2M3MjMzMzA4YzY4NjVmZTgxM2RmMjIiLCJpYXQiOjE3ODE1NzMxNjIuNjU2MDQzLCJuYmYiOjE3ODE1NzMxNjIuNjU2MDQ2LCJleHAiOjE3OTcxMjUxNjIuNjQ3MzQ2LCJzdWIiOiI1OTg5MCIsInNjb3BlcyI6W119.GGUAdxQO0BLrZ-6NK28QZn9BoJUqFSISp06zR-Uk0987llLhN0mi7W-90gyddlCmvuajwcX5JuZczOSjTJZtTBq0ksL4H_bekr0PLrbb-5FUJ_tt6idl3bQW9jvo2nk0QAJ0kkuWHQTTgWhTEk8afcZ_4zNYtWM0CLJ77-zab8zLlLXLYCLsCpmc3iI2n9v50S2hWb5m72BfG6BCxX8TD_nPJZdU16Sl0smmg8lFJQklaZHTeFnSf3eRz5UV-cdIX1ll7HOu77UK5NoJhLEdDnc48MpRpVqi8ffn3aTdc42iKkE3rO8dqFO3smVYKoKgsqyQAJqfI_wgFNE124hnCM2roQx4CU_Aw-erG9_OuQRpxftAlUH9Odt7IPeLqSmTjSpw7X5GQXVcnvr_xVn3hd21OS2C5F8dMJTR4gqlb00yLo-jHPk97QuuM8kbSa2xBQLdQpos3Fj_ryMl8ePVAwnQAIKWevAFlY5lmTWuCQ1pL8KsSrjBPB77z0l_HVcaPirerkkNsyTFsJ2P-E4acxe-fiPbARRbmaaS31NU5HWa082w2rKEFaQB8dXW3l3gQGJ73MV5UMxy8vo8vG65rh1qTKFwbDt4RO3dky4pVZSKMDXBz2qbyk133ak0AC5QgrIsL333061bS_Vaqd_Yj9DcmJ-vo1ZyhJX0WbL9Bkk';
let html5QrCode = null;

async function findProductSkuInManifest(manifestUrl, scannedCode) {
    let fileResponse;
    try {
        fileResponse = await fetch(`${MANIFEST_PROXY_URL}?url=${encodeURIComponent(manifestUrl)}`, { method: 'POST' });
    } catch (networkError) {
        console.error('Eroare de rețea la descărcarea manifestului:', networkError);
        throw new Error('Negăsit – eroare rețea manifest');
    }
    if (!fileResponse.ok) {
        throw new Error(`Negăsit – descărcare eșuată (HTTP ${fileResponse.status})`);
    }

    let arrayBuffer;
    try {
        const data = await fileResponse.json();
        const { base64 } = Array.isArray(data) ? data[0] : data;
        arrayBuffer = Uint8Array.from(atob(base64), c => c.charCodeAt(0)).buffer;
    } catch (decodeError) {
        console.error('Eroare la decodarea manifestului:', decodeError);
        throw new Error('Negăsit – manifest nedecodabil');
    }

    let workbook;
    try {
        workbook = XLSX.read(arrayBuffer, { type: 'array' });
    } catch (parseError) {
        console.error('Eroare la citirea fișierului manifest:', parseError);
        throw new Error('Negăsit – fișier manifest invalid');
    }

    const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(firstSheet, { defval: '' });

    const normalizedCode = String(scannedCode).trim().toUpperCase();
    const matchedRow = rows.find(row => String(row['Manifest SKU'] || '').trim().toUpperCase() === normalizedCode);

    if (!matchedRow) {
        throw new Error('Negăsit – cod inexistent în manifest');
    }
    if (!matchedRow['Product SKU']) {
        throw new Error('Negăsit – rând fără Product SKU');
    }

    return matchedRow['Product SKU'];
}

async function onScanSuccess(decodedText, decodedResult) {
    stopScanner();
    showToast('Cod scanat. Se caută produsul...');
    try {
        let response;
        try {
            response = await fetch(JOBALOTS_MANIFEST_URL, {
                method: 'POST',
                headers: {
                    'accept': 'application/json',
                    'accept-currency': 'gbp',
                    'accept-language': 'en',
                    'authorization': `Bearer ${JOBALOTS_BEARER_TOKEN}`,
                    'cache-control': 's-maxage=30',
                    'content-type': 'application/json',
                    'url-accept-currency': '',
                    'url-accept-language': 'en',
                },
                body: JSON.stringify({ manifest_spw: decodedText }),
            });
        } catch (networkError) {
            console.error('Eroare de rețea la apelul către jobalots:', networkError);
            throw new Error('Negăsit – eroare rețea jobalots');
        }

        if (!response.ok) {
            throw new Error(`Negăsit – eroare jobalots (HTTP ${response.status})`);
        }

        let responseData;
        try {
            responseData = await response.json();
        } catch (parseError) {
            console.error('Răspuns invalid de la jobalots:', parseError);
            throw new Error('Negăsit – răspuns invalid jobalots');
        }

        if (responseData.error !== false || responseData.status !== 200) {
            console.error('Jobalots a răspuns cu eroare:', responseData);
            throw new Error('Negăsit – cod respins de jobalots');
        }
        if (!responseData.result?.manifest_url) {
            throw new Error('Negăsit – manifest lipsă în răspuns');
        }

        const productSku = await findProductSkuInManifest(responseData.result.manifest_url, decodedText);
        const allCommands = AppState.getCommands();
        const currentManifestSku = sessionStorage.getItem('currentManifestSku');
        let foundProduct = null;
        let foundCommandId = null;
        let ambiguous = false;

        // Același productsku poate apărea în mai multe paleti (același ASIN, paleti diferiti) -
        // vezi resolveProductInCommand în data.js. Dacă e ambiguu, nu ghicim paletul.
        for (const command of allCommands) {
            const result = resolveProductInCommand(command, productSku, currentManifestSku);
            if (result.product) {
                foundProduct = result.product;
                foundCommandId = command.id;
                break;
            }
            if (result.ambiguous) {
                ambiguous = true;
                break;
            }
        }

        if (foundProduct && foundCommandId) {
            sessionStorage.setItem('currentCommandId', foundCommandId);
            sessionStorage.setItem('currentProductId', foundProduct.id);
            sessionStorage.setItem('currentManifestSku', foundProduct.manifestsku || 'No ManifestSKU');
            track('scan_matched', { scanner_kind: decodedResult ? 'camera' : 'hw', lpn: decodedText });
            showToast('Produs găsit! Se deschide...');
            router.navigateTo('product-detail');
        } else if (ambiguous) {
            track('scan_ambiguous_sku', { scanner_kind: decodedResult ? 'camera' : 'hw', lpn: decodedText, raw_api_sku: productSku });
            showToast('Acest produs există în mai mulți paleti. Deschide paletul corect din listă și scanează din pagina lui.', 6000);
        } else {
            track('scan_found_not_in_orders', { scanner_kind: decodedResult ? 'camera' : 'hw', lpn: decodedText, raw_api_sku: productSku });
            showToast(`Produsul (SKU: ...${productSku.slice(-6)}) nu e în comenzile curente.`, 5000);
            console.error('Produsul (SKU: ' + productSku + ') a fost găsit în API, dar nu există în comenzile încărcate în AppState.');
        }
    } catch (error) {
        track('scan_failed', { scanner_kind: decodedResult ? 'camera' : 'hw', lpn: decodedText, error_message: error.message });
        console.error('Eroare la procesarea LPN:', error);
        showToast(error.message, 5000);
    }
}

function onScanFailure(error) { }

function startScanner() {
    const scannerContainer = document.getElementById('scanner-container');
    if (!scannerContainer) return;
    scannerContainer.classList.remove('hidden');
    if (!html5QrCode) {
        html5QrCode = new Html5Qrcode("reader");
    }
    const config = { fps: 10 };
    html5QrCode.start({ facingMode: "environment" }, config, onScanSuccess, onScanFailure)
        .catch(err => {
            console.warn("Camera 'environment' nu a putut fi pornită, se încearcă camera default:", err);
            html5QrCode.start(undefined, config, onScanSuccess, onScanFailure)
                .catch(err2 => {
                    console.error("Eroare la pornirea scannerului (și pe default):", err2);
                    showToast("Nu s-a putut porni camera.", 3000);
                    stopScanner();
                });
        });
}

function stopScanner() {
    const scannerContainer = document.getElementById('scanner-container');
    if (scannerContainer) scannerContainer.classList.add('hidden');
    if (html5QrCode && html5QrCode.isScanning) {
        html5QrCode.stop().catch(err => console.error("Eroare la oprirea scannerului:", err));
    }
}

export function initScannerHandler() {
    const closeScannerButton = document.getElementById('close-scanner-button');
    if (closeScannerButton) {
        closeScannerButton.addEventListener('click', stopScanner);
    }
    document.body.addEventListener('click', (e) => {
        const scanButton = e.target.closest('#footer-scan-trigger');
        if (scanButton) {
            e.preventDefault();
            startScanner();
        }
    });
}

export function initHardwareScannerHandler() {
    let scanBuffer = "";
    let lastKeyTime = 0;

    document.addEventListener("keydown", (e) => {
        const now = Date.now();
        scanBuffer = now - lastKeyTime > 300 ? "" : scanBuffer;
        lastKeyTime = now;

        if (e.key === "Enter") {
            if (scanBuffer.length > 2) {
                e.preventDefault();
                e.stopPropagation();

                const scannedCode = scanBuffer.trim();
                scanBuffer = "";

                if (document.activeElement && document.activeElement.tagName === 'INPUT') {
                    document.activeElement.blur();
                }

                console.log("Cod preluat de la scanerul hardware:", scannedCode);
                onScanSuccess(scannedCode);
            }
            scanBuffer = "";
            return;
        }

        if (!["Unidentified", "Shift", "Control", "Alt", "Meta", "CapsLock", "Tab"].includes(e.key)) {
            scanBuffer += e.key;
        }
    });
}
