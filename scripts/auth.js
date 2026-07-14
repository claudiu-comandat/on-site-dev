// scripts/auth.js

// Acest script se va rula pe paginile protejate
// Verifica daca utilizatorul este autentificat. Daca nu, il redirectioneaza la login.
if (sessionStorage.getItem('isLoggedIn') !== 'true') {
    // Pastreaza pagina curenta pentru o eventuala redirectionare dupa login
    // sessionStorage.setItem('redirectUrl', window.location.href);
    window.location.href = 'index.html';
}
