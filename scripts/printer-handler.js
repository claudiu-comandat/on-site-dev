// scripts/printer-handler.js

// --- START MODIFICARE: Funcție ajutătoare pentru Jurnale ---
/**
 * Scrie un mesaj în consolă cu un marcaj de timp precis (HH:MM:SS.ms)
 * @param {string} message - Mesajul de afișat
 */
function logWithTimestamp(message) {
    const now = new Date();
    const time = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}.${now.getMilliseconds().toString().padStart(3, '0')}`;
    console.log(`[${time}] ${message}`);
}
// --- FINAL MODIFICARE ---

// Variabilele de stare
let niimbotCharacteristic = null;
let isConnecting = false;
let printerDevice = null;

// Cache pentru pachetele de date pre-generate
let printPacketCache = {
    asin: null,
    packets: {} // Aici vom stoca 'new', 'very-good', 'good'
};

// Contor de generație: previne ca un apel preCacheProductLabels mai vechi,
// încă în desfășurare, să suprascrie cache-ul unui apel mai nou (race condition).
let cacheGeneration = 0;


/**
 * Afișează un mesaj scurt (toast) în partea de jos a ecranului.
 */
export function showToast(message, duration = 3000) {
    const toast = document.createElement('div');
    toast.textContent = message;
    toast.className = 'fixed bottom-20 left-1/2 -translate-x-1/2 bg-gray-800 text-white px-4 py-2 rounded-lg shadow-lg z-50 animate-slide-down';
    toast.style.animationDuration = '0.3s';
    document.body.appendChild(toast);
    
    setTimeout(() => {
        toast.classList.replace('animate-slide-down', 'animate-slide-up');
        toast.style.animationDirection = 'reverse';
        setTimeout(() => toast.remove(), 300);
    }, duration);
}

/**
 * Verifică dacă imprimanta este conectată.
 */
export function isPrinterConnected() {
    return niimbotCharacteristic !== null && printerDevice && printerDevice.gatt.connected;
}

/**
 * Creează pachetul de date specific Niimbot.
 */
export function createNiimbotPacket(type, data = []) {
    const dataBytes = Array.isArray(data) ? data : [data];
    const checksum = (dataBytes.reduce((acc, byte) => acc ^ byte, type ^ dataBytes.length)) & 0xFF;
    const packet = [0x55, 0x55, type, dataBytes.length, ...dataBytes, checksum, 0xAA, 0xAA];
    return new Uint8Array(packet);
}

/**
 * Se conectează la un dispozitiv Bluetooth (imprimantă).
 */
export async function connectToDevice(device, statusCallback) {
    // ... (lăsăm neschimbat, dar adăugăm log-uri)
    logWithTimestamp("connectToDevice: Start");
    if (isConnecting) {
        logWithTimestamp("connectToDevice: Conectare deja în progres. Stop.");
        return false;
    }
    isConnecting = true;

    try {
        if (statusCallback) statusCallback(`Conectare la ${device.name}...`);
        logWithTimestamp(`connectToDevice: Apel device.gatt.connect() pentru ${device.name}...`);
        const server = await device.gatt.connect();
        logWithTimestamp("connectToDevice: Conectat la GATT. Caut servicii...");
        
        const services = await server.getPrimaryServices();
        let foundCharacteristic = null;
        logWithTimestamp(`connectToDevice: Găsit ${services.length} servicii. Caut caracteristici...`);
        for (const service of services) {
            const characteristics = await service.getCharacteristics();
            for (const char of characteristics) {
                if (char.properties.writeWithoutResponse && char.properties.notify) {
                    foundCharacteristic = char;
                    break; 
                }
            }
            if (foundCharacteristic) break;
        }

        if (!foundCharacteristic) {
            logWithTimestamp("connectToDevice: EROARE: Caracteristica necesară nu a fost găsită.");
            throw new Error('Caracteristica necesară nu a fost găsită.');
        }
        
        logWithTimestamp("connectToDevice: Caracteristică găsită. Pornire notificări...");
        niimbotCharacteristic = foundCharacteristic;
        await niimbotCharacteristic.startNotifications();
        logWithTimestamp("connectToDevice: Notificări pornite.");
        
        printerDevice = device;

        device.addEventListener('gattserverdisconnected', () => {
            logWithTimestamp("connectToDevice: Eveniment 'gattserverdisconnected' declanșat.");
            showToast('Imprimanta a fost deconectată.');
            niimbotCharacteristic = null;
            printerDevice = null;
        });

        if (statusCallback) statusCallback(`Conectat la ${device.name}.`);
        isConnecting = false;
        logWithTimestamp("connectToDevice: Conectare reușită. End.");
        return true;

    } catch (error) {
        if (statusCallback) statusCallback(`Eroare la conectare: ${error.message}`);
        isConnecting = false;
        logWithTimestamp(`connectToDevice: EROARE: ${error.message}. End.`);
        return false;
    }
}

/**
 * Caută și se conectează la o nouă imprimantă.
 */
export async function discoverAndConnect(statusCallback) {
    try {
        if (statusCallback) statusCallback('Se caută imprimante...');
        const device = await navigator.bluetooth.requestDevice({
            filters: [{ namePrefix: 'D' }],
            optionalServices: ['e7810a71-73ae-499d-8c15-faa9aef0c3f2', '49535343-fe7d-4ae5-8fa9-9fafd205e455']
        });
        return await connectToDevice(device, statusCallback);
    } catch(error) {
        if (statusCallback) statusCallback(`Eroare: ${error.message}`);
        return false;
    }
}


/**
 * Partea "grea": Generează pachetele de date pentru o etichetă.
 */
async function generateLabelPackets(productCode, conditionLabel) {
    const textToPrint = `${productCode}${conditionLabel}`;
    logWithTimestamp(`generateLabelPackets: Start pentru '${textToPrint}'`);
    
    const labelWidth = 240;
    const labelHeight = 120;
    
    const canvas = document.createElement('canvas');
    canvas.width = labelHeight;
    canvas.height = labelWidth;
    const ctx = canvas.getContext('2d');
    
    ctx.fillStyle = 'black';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate(90 * Math.PI / 180);
    const verticalOffset = 10;
    
    logWithTimestamp(`generateLabelPackets: Generare cod QR...`);
    const qr = qrcode(0, 'M');
    qr.addData(textToPrint);
    qr.make();
    const qrImg = new Image();
    qrImg.src = qr.createDataURL(6, 2);
    
    logWithTimestamp(`generateLabelPackets: Așteptare încărcare imagine QR...`);
    await new Promise(resolve => { qrImg.onload = resolve; });
    logWithTimestamp(`generateLabelPackets: Imagine QR încărcată. Desenare pe canvas...`);
    
    const qrSize = 85; 
    ctx.drawImage(qrImg, -labelWidth / 2 + 15, -labelHeight / 2 + 18 + verticalOffset, qrSize, qrSize);
    
    ctx.fillStyle = 'white';
    ctx.font = 'bold 24px Arial';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    const line1 = textToPrint.substring(0, 6);
    const line2 = textToPrint.substring(6);
    ctx.fillText(line1, -labelWidth / 2 + qrSize + 30, -15 + verticalOffset);
    ctx.fillText(line2, -labelWidth / 2 + qrSize + 30, 15 + verticalOffset);
    ctx.restore();
    logWithTimestamp(`generateLabelPackets: Canvas desenat. Începere conversie bitmap...`);
    
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const imagePackets = [];
    const widthInBytes = Math.ceil(canvas.width / 8);
    
    for (let y = 0; y < canvas.height; y++) {
        let lineBytes = new Uint8Array(widthInBytes);
        for (let x = 0; x < canvas.width; x++) {
            const pixelIndex = (y * canvas.width + x) * 4;
            const pixelValue = imageData.data[pixelIndex] > 128 ? 1 : 0;
            if (pixelValue === 1) {
                lineBytes[Math.floor(x / 8)] |= (1 << (7 - (x % 8)));
            }
        }
        const header = [(y >> 8) & 0xFF, y & 0xFF, 0, 0, 0, 1];
        const dataPayload = Array.from(new Uint8Array([...header, ...lineBytes]));
        imagePackets.push(createNiimbotPacket(0x85, dataPayload));
    }
    
    logWithTimestamp(`generateLabelPackets: Conversie bitmap finalizată. End pentru '${textToPrint}'`);
    return imagePackets;
}


/**
 * Printează o etichetă.
 */
export async function printLabel(productCode, conditionLabel, quantity = 1) {
    logWithTimestamp(`printLabel: Start pentru ${productCode} (${conditionLabel}), cant: ${quantity}`);
    if (!isPrinterConnected()) {
        logWithTimestamp(`printLabel: EROARE: Imprimanta nu este conectată. Stop.`);
        throw new Error("Imprimanta nu este conectată.");
    }

    const conditionKeyMap = { 'CN': 'new', 'FB': 'very-good', 'B': 'good' };
    const cacheKey = conditionKeyMap[conditionLabel];
    
    if (!cacheKey) {
        logWithTimestamp(`printLabel: EROARE: Condiție necunoscută ${conditionLabel}. Stop.`);
        throw new Error(`Condiție necunoscută pentru printare: ${conditionLabel}`);
    }

    const writeAndDelay = async (packet, ms = 5) => {
        await niimbotCharacteristic.writeValueWithoutResponse(packet);
        await new Promise(res => setTimeout(res, ms));
    };

    try {
        let imagePackets;
        
        // 1. Verificăm cache-ul
        logWithTimestamp(`printLabel: Verificare cache pentru ${productCode} - ${cacheKey}...`);
        if (printPacketCache.asin === productCode && printPacketCache.packets[cacheKey]) {
            // Folosim pachetele din cache. Acest pas e instantaneu.
            imagePackets = printPacketCache.packets[cacheKey];
            logWithTimestamp(`printLabel: Cache HIT. Se folosesc pachetele pre-generate.`);
        } else {
            // Cache-ul e invalid sau gol
            logWithTimestamp(`printLabel: Cache MISS. (Cache ASIN: ${printPacketCache.asin}, Cache Keys: ${Object.keys(printPacketCache.packets)})`);
            logWithTimestamp(`printLabel: Se apelează 'generateLabelPackets' ACUM (proces lent)...`);
            showToast(`Generez datele pt ${productCode}...`);
            imagePackets = await generateLabelPackets(productCode, conditionLabel);
            logWithTimestamp(`printLabel: Răspuns 'generateLabelPackets'. Se stochează în cache...`);
            // Stocăm în cache pentru viitor
            printPacketCache.asin = productCode;
            printPacketCache.packets[cacheKey] = imagePackets;
        }

        // 2. Trimitere comenzi (partea "ușoară" și rapidă)
        const canvasWidth = 120;
        const canvasHeight = 240;
        
        logWithTimestamp(`printLabel: Începere buclă de trimitere comenzi (writeAndDelay)...`);
        
        await writeAndDelay(createNiimbotPacket(0x21, [3]));
        await writeAndDelay(createNiimbotPacket(0x23, [1]));
        await writeAndDelay(createNiimbotPacket(0x01, [1]));
        await writeAndDelay(createNiimbotPacket(0x03, [1]));
        
        const dimensionData = [(canvasHeight >> 8) & 0xFF, canvasHeight & 0xFF, (canvasWidth >> 8) & 0xFF, canvasWidth & 0xFF];
        await writeAndDelay(createNiimbotPacket(0x13, dimensionData));
        await writeAndDelay(createNiimbotPacket(0x15, [0, quantity]));
        
        logWithTimestamp(`printLabel: Trimitere pachete imagine (${imagePackets.length} pachete)...`);
        for (const packet of imagePackets) {
            await writeAndDelay(packet, 20); 
        }
        logWithTimestamp(`printLabel: Pachete imagine trimise.`);

        await writeAndDelay(createNiimbotPacket(0xE3, [1]));
        await writeAndDelay(createNiimbotPacket(0xF3, [1]));
        
        logWithTimestamp(`printLabel: Comenzi finale trimise. End pentru ${productCode}`);

    } catch (error) {
        console.error(`Eroare critică la printarea etichetei: ${productCode}${conditionLabel}`, error);
        logWithTimestamp(`printLabel: EROARE CRITICĂ: ${error.message}`);
        throw error;
    }
}


/**
 * Funcție publică pentru a pre-genera etichete în fundal.
 */
export async function preCacheProductLabels(asin) {
    logWithTimestamp(`preCache: Start pentru ASIN: ${asin}`);
    
    if (printPacketCache.asin === asin && printPacketCache.packets['new']) {
        logWithTimestamp(`preCache: Cache HIT. Pachetele sunt deja generate pentru ${asin}. Stop.`);
        return;
    }
    
    logWithTimestamp(`preCache: Cache MISS sau incomplet. Resetare și începere generare...`);

    // Marcăm acest apel ca fiind cea mai recentă generație. Dacă un alt apel
    // preCacheProductLabels pornește după acesta, va incrementa din nou
    // cacheGeneration, iar acest apel va deveni "stale" (învechit).
    const myGeneration = ++cacheGeneration;
    printPacketCache = { asin: asin, packets: {} };

    const conditionMap = {
        'new': 'CN',
        'very-good': 'FB',
        'good': 'B'
    };

    try {
        for (const key in conditionMap) {
            const conditionLabel = conditionMap[key];
            logWithTimestamp(`preCache: Generare pentru ${key} ('${conditionLabel}')...`);

            const packets = await generateLabelPackets(asin, conditionLabel);

            if (myGeneration !== cacheGeneration) {
                logWithTimestamp(`preCache: Apel învechit (generație ${myGeneration} != ${cacheGeneration}) pentru ${asin}. Abandonare fără a atinge cache-ul.`);
                return;
            }

            logWithTimestamp(`preCache: Stocare în cache pentru ${key}.`);
            printPacketCache.packets[key] = packets;

            await new Promise(res => setTimeout(res, 50)); // Pauză mică

            if (myGeneration !== cacheGeneration) {
                logWithTimestamp(`preCache: Apel învechit (generație ${myGeneration} != ${cacheGeneration}) pentru ${asin}. Abandonare fără a atinge cache-ul.`);
                return;
            }
        }
        logWithTimestamp(`preCache: Finalizat cu succes pentru ASIN: ${asin}`);
    } catch (error) {
        console.error(`Eroare la pre-caching-ul etichetelor: ${error}`);
        logWithTimestamp(`preCache: EROARE: ${error.message}. Resetare cache.`);
        if (myGeneration === cacheGeneration) {
            printPacketCache = { asin: null, packets: {} };
        }
    }
}


/**
 * Încearcă să se reconecteze automat la ultima imprimantă cunoscută.
 */
export async function autoConnectToPrinter() {
    if (navigator.bluetooth && typeof navigator.bluetooth.getDevices === 'function') {
        try {
            const devices = await navigator.bluetooth.getDevices();
            if (devices.length > 0) {
                const device = devices[0];
                showToast(`Se reconectează la ${device.name}...`);
                const success = await connectToDevice(device, (message) => console.log(message));
                if (success) {
                    showToast("Imprimanta a fost reconectată automat.");
                } else {
                    showToast("Reconectarea automată a eșuat.", 4000);
                }
            }
        } catch(error) {
            console.error("Eroare la reconectarea automată:", error);
        }
    }
}
