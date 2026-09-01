// Forza il Service Worker a installarsi subito saltando la coda
self.addEventListener('install', (event) => {
    self.skipWaiting();
});

// Forza il Service Worker a prendere immediatamente il controllo della pagina aperta
self.addEventListener('activate', (event) => {
    event.waitUntil(clients.claim());
});

// Ascolta le notifiche push in arrivo dal server
self.addEventListener('push', function(event) {
    let payload = "È ora di fare la foto!"; // Testo di default
    
    if (event.data) {
        payload = event.data.text();
    }

    const options = {
        body: payload,
        icon: '/static/icons/icon-192.png', // Assicurati di avere un'icona
        badge: '/static/icons/icon-192.png',
        vibrate: [200, 100, 200],
        data: {
            url: 'https://baffo.fodus.it'
        }
    };

    event.waitUntil(
        self.registration.showNotification('Fodus Baffo 🥸', options)
    );
});

// Gestisce il click sulla notifica per aprire l'app
self.addEventListener('notificationclick', function(event) {
    event.notification.close();
    event.waitUntil(
        clients.openWindow(event.notification.data.url)
    );
});
