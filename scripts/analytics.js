// scripts/analytics.js
// Colectare evenimente pentru analytics. Non-blocant si nu arunca niciodata:
// analytics nu are voie sa strice fluxul din depozit.

const TRACK_URL = 'https://automatizare.comandat.ro/webhook/track-event';
const APP_VERSION = '2026-07-02'; // bump manual la fiecare deploy relevant

// sessionStorage poate contine literalul "null"/"undefined" (ex. produs curand curatat).
function ss(key) {
    const v = sessionStorage.getItem(key);
    return (v && v !== 'null' && v !== 'undefined') ? v : null;
}

function uuid() {
    return (crypto.randomUUID && crypto.randomUUID()) || (Date.now() + '-' + Math.random());
}

// Deriva tipul paletului din prefixul manifestsku (aceeasi logica ca add-product.js).
export function palletType(manifestSku) {
    if (!manifestSku || manifestSku === 'No ManifestSKU') return null;
    const s = manifestSku.toUpperCase();
    if (s.startsWith('YELLOW')) return 'yellow';
    if (s.startsWith('GREY')) return 'grey';
    return 'red';
}

// Id de sesiune analytics; se genereaza la login si moare cu tab-ul.
export function ensureSessionId() {
    let id = ss('analyticsSessionId');
    if (!id) {
        id = uuid();
        sessionStorage.setItem('analyticsSessionId', id);
    }
    return id;
}

// Identificatorii de corelare pusi in payload-urile webhook-urilor existente
// (ca serverul sa lege evenimentul de bani de evenimentele de timp de pe client).
export function analyticsMeta() {
    return { session_id: ss('analyticsSessionId'), operator_code: ss('lastAccessCode') };
}

export function track(type, extra = {}) {
    try {
        const manifest = ss('currentManifestSku');
        const envelope = {
            event_uuid: uuid(),
            event_type: type,
            session_id: ensureSessionId(),
            operator_code: ss('lastAccessCode'),
            operator_name: ss('loggedInUser'),
            command_id: ss('currentCommandId'),
            manifest_sku: manifest && manifest !== 'No ManifestSKU' ? manifest : null,
            pallet_type: palletType(manifest),
            product_sku: ss('currentProductId'),
            client_ts: new Date().toISOString(),
            app_version: APP_VERSION,
            ...extra
        };
        const body = JSON.stringify(envelope);
        const blob = new Blob([body], { type: 'application/json' });
        if (!(navigator.sendBeacon && navigator.sendBeacon(TRACK_URL, blob))) {
            fetch(TRACK_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body,
                keepalive: true
            }).catch(() => {});
        }
    } catch (e) {
        console.debug('track failed', e);
    }
}

// self-check: deschide orice pagina cu ?selftest pentru a verifica tiparea paletului in consola.
try {
    if (typeof location !== 'undefined' && new URLSearchParams(location.search).has('selftest')) {
        console.assert(palletType('YELLOW-123') === 'yellow', 'yellow');
        console.assert(palletType('GREY-9') === 'grey', 'grey');
        console.assert(palletType('RED-1') === 'red', 'red');
        console.assert(palletType('X-1') === 'red', 'default->red');
        console.assert(palletType('No ManifestSKU') === null, 'no-manifest->null');
        console.assert(palletType(null) === null, 'null');
        console.log('[analytics] self-check passed');
    }
} catch (_) {}
