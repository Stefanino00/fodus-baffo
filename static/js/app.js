let currentUser = null;
let stream = null;
let capturedBase64 = null;

function showView(viewId) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.getElementById(viewId).classList.add('active');
}

// LOGIN
document.getElementById('btn-login').addEventListener('click', async () => {
    const pin = document.getElementById('pin-input').value;
    const res = await fetch('/api/login', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({pin})
    });
    if (res.ok) { currentUser = await res.json(); checkStatus(); } 
    else { document.getElementById('login-error').innerText = "PIN errato"; }
});

async function checkStatus() {
    const res = await fetch('/api/status');
    if (!res.ok) return showView('view-login');
    
    const status = await res.json();
    currentUser = status.user;

    if (!currentUser.soprannome) return showView('view-onboarding');

    // Popola Home Page
    const s = status.stats;
    document.getElementById('stat-photos-today').innerText = `${s.photos_today}/${s.total_users}`;
    document.getElementById('stat-days-passed').innerText = `Giorno ${s.days_passed}`;
    
    // Gestione Colore Countdown
    const pill = document.getElementById('countdown-pill');
    pill.innerText = `${s.days_remaining} gg a Natale`;
    
    if (s.days_remaining <= 15) pill.style.backgroundColor = 'var(--color-danger)';
    else if (s.days_remaining <= 31) pill.style.backgroundColor = 'var(--color-medium)';
    else pill.style.backgroundColor = 'var(--color-safe)';

    // BYPASS PREVIEW SEGRETAMENTE (Il pezzo che mancava!)
    const urlParams = new URLSearchParams(window.location.search);
    const isPreview = urlParams.get('preview') === '1' && currentUser.is_admin;

    const actionCard = document.getElementById('home-action-card');
    
    // Se la sfida non è iniziata (e non sei in modalità preview)
    if (!status.sfida_iniziata && !isPreview) {
        actionCard.innerHTML = `<h3>In attesa... ⏳</h3><p class="stat-desc">Stefano deve sbloccare la sfida.</p>`;
        if (currentUser.is_admin) document.getElementById('admin-controls').classList.remove('hidden');
    } 
    // Se la sfida è iniziata (o sei in preview) e HA già fatto la foto
    else if (status.has_photo_today) {
        actionCard.innerHTML = `<h3>Grande! 🎉</h3><p class="stat-desc">Hai già fatto la tua foto oggi.</p>`;
    } 
// Se NON ha ancora fatto la foto
    else {
        actionCard.innerHTML = `<h3>Tocca a te! 📸</h3><button id="btn-go-camera" class="btn-primary">Scatta la foto di oggi</button>`;
        document.getElementById('btn-go-camera').addEventListener('click', () => {
            
            // LA SAGOMA DI DEFAULT PER IL GIORNO 1
            const defaultGhost = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 720 1280'%3E%3Cellipse cx='360' cy='500' rx='180' ry='240' fill='none' stroke='white' stroke-width='6' stroke-dasharray='15,15' opacity='0.7'/%3E%3Cpath d='M100,1280 C100,950 220,850 360,850 C500,850 620,950 620,1280' fill='none' stroke='white' stroke-width='6' stroke-dasharray='15,15' opacity='0.7'/%3E%3C/svg%3E";
            
            // Usa la foto di ieri, o la sagoma di default se è il giorno 1
            document.getElementById('ghost-overlay').style.backgroundImage = `url('${status.ghost_url || defaultGhost}')`;
            
            showView('view-camera');
            startCamera();
        });
    }

    showView('view-home');
}

// ADMIN UNLOCK
document.getElementById('btn-unlock-challenge')?.addEventListener('click', async () => {
    await fetch('/api/admin/start-challenge', {method: 'POST'});
    checkStatus();
});

document.getElementById('btn-save-nickname').addEventListener('click', async () => {
    const soprannome = document.getElementById('nickname-input').value;
    const res = await fetch('/api/set-soprannome', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({soprannome}) });
    if (res.ok) checkStatus();
});

// FIX: CAMERA START SENZA ZOOM
async function startCamera() {
    try {
        // Richiediamo solo la frontale senza forzare aspectRatio, così il telefono usa tutto il sensore
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" }, audio: false });
        const video = document.getElementById('camera-stream');
        video.srcObject = stream;
        video.classList.remove('hidden');
        document.getElementById('camera-canvas').classList.add('hidden');
        document.getElementById('btn-capture').classList.remove('hidden');
        document.getElementById('retake-actions').classList.add('hidden');
    } catch (err) {
        alert("Errore fotocamera. Controlla i permessi.");
    }
}

// FIX: TAGLIO 9:16 E SPECCHIO PERFETTO
document.getElementById('btn-capture').addEventListener('click', () => {
    const video = document.getElementById('camera-stream');
    const canvas = document.getElementById('camera-canvas');
    const ctx = canvas.getContext('2d');

    // Dimensioni finali target (9:16)
    canvas.width = 720;
    canvas.height = 1280; 

    // Calcolo per il crop centrale (evita lo zoom)
    const videoRatio = video.videoWidth / video.videoHeight;
    const targetRatio = 9 / 16;
    let sWidth = video.videoWidth;
    let sHeight = video.videoHeight;
    let sx = 0; let sy = 0;

    if (videoRatio > targetRatio) {
        sWidth = sHeight * targetRatio;
        sx = (video.videoWidth - sWidth) / 2;
    } else {
        sHeight = sWidth / targetRatio;
        sy = (video.videoHeight - sHeight) / 2;
    }

    // Applica l'effetto specchio anche sul canvas finale
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
    
    // Disegna ritagliando il centro perfetto
    ctx.drawImage(video, sx, sy, sWidth, sHeight, 0, 0, canvas.width, canvas.height);

    capturedBase64 = canvas.toDataURL('image/webp', 0.8); 

    video.classList.add('hidden');
    canvas.classList.remove('hidden');
    document.getElementById('btn-capture').classList.add('hidden');
    document.getElementById('retake-actions').classList.remove('hidden');
});

document.getElementById('btn-retake').addEventListener('click', startCamera);

document.getElementById('btn-upload').addEventListener('click', async () => {
    const res = await fetch('/api/upload-photo', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({image: capturedBase64}) });
    if (res.ok) {
        if (stream) stream.getTracks().forEach(track => track.stop());
        checkStatus();
    }
});

// CALENDARIO
document.getElementById('btn-open-calendar').addEventListener('click', async () => {
    const res = await fetch('/api/calendar');
    const data = await res.json();
    const container = document.getElementById('calendar-container');
    container.innerHTML = '';

    for (const [date, photos] of Object.entries(data)) {
        const photosHtml = photos.map(p => `
            <div class="photo-item">
                <img src="${p.url}">
                <div class="photo-author">${p.author_name} - ${p.time}</div>
            </div>
        `).join('');

        container.innerHTML += `
            <div class="day-group">
                <div class="day-title">${date}</div>
                <div class="photo-grid">${photosHtml}</div>
            </div>
        `;
    }
    showView('view-calendar');
});

checkStatus();
