// scripts/login.js
import { fetchDataAndSyncState } from './data.js';
import { track, ensureSessionId } from './analytics.js';

document.addEventListener('DOMContentLoaded', () => {
    if (sessionStorage.getItem('isLoggedIn') === 'true') {
        window.location.href = 'app.html';
        return;
    }

    const loginForm = document.getElementById('login-form');
    const accessCodeInput = document.getElementById('access-code');
    const errorMessage = document.getElementById('error-message');
    const loginButton = document.getElementById('login-button');
    const buttonText = loginButton.querySelector('.button-text');
    const buttonLoader = loginButton.querySelector('.button-loader');

    const loginWebhookUrl = 'https://automatizare.comandat.ro/webhook/637e1f6e-7beb-4295-89bd-4d7022f12d45';

    const performLogin = async (accessCode) => {
        errorMessage.textContent = '';
        loginButton.disabled = true;
        buttonText.classList.add('hidden');
        buttonLoader.classList.remove('hidden');

        try {
            // PAS 1: Validare cod de acces
            const loginResponse = await fetch(loginWebhookUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain' },
                body: JSON.stringify({ code: accessCode }),
            });

            if (!loginResponse.ok) throw new Error(`Eroare de rețea la login: ${loginResponse.status}`);
            
            const loginData = await loginResponse.json();
            if (loginData?.status !== 'success') {
                errorMessage.textContent = 'Cod de acces incorect.';
                throw new Error('Login failed');
            }

            sessionStorage.setItem('loggedInUser', loginData.user);
            sessionStorage.setItem('lastAccessCode', accessCode);

            ensureSessionId();
            track('login');

            // PAS 2: Sincronizare completă a datelor folosind funcția cu numele corect
            const syncSuccess = await fetchDataAndSyncState();

            if (syncSuccess) {
                sessionStorage.setItem('isLoggedIn', 'true');
                window.location.href = 'app.html';
            } else {
                errorMessage.textContent = 'Autentificare reușită, dar eroare la sincronizarea datelor.';
            }

        } catch (error) {
            console.error('Eroare la autentificare:', error);
            if (!errorMessage.textContent) {
                errorMessage.textContent = 'Eroare la conectare. Vă rugăm încercați din nou.';
            }
        } finally {
            loginButton.disabled = false;
            buttonText.classList.remove('hidden');
            buttonLoader.classList.add('hidden');
        }
    };

    loginForm.addEventListener('submit', (event) => {
        event.preventDefault();
        const accessCode = accessCodeInput.value.trim();
        if (accessCode) {
            performLogin(accessCode);
        } else {
            errorMessage.textContent = 'Vă rugăm introduceți un cod.';
        }
    });
});

