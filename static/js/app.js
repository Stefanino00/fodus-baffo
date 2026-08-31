let currentUser = null;
let stream = null;
let capturedBase64 = null;

// Calcolo Countdown al 24 Dicembre 2026
function updateCountdown() {
    const target = new Date('2026-12-24T23:59:59');
    const now = new Date();
    const diffDays = Math.ceil((target - now) / (1000 * 60 * 60 * 24));
    document.getElementById('countdown').innerText = `${diffDays} gg al 24 Dic`;
}
updateCountdown();

function showView(viewId) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.getElementById(viewId).classList.add('active');
}

// LOGIN WITH PIN
document.getElementById('btn-login').addEventListener('click', async () => {
    const pin = document.getElementById('pin-input').value;
    const res = await fetch('/api/login', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({pin})
    });
    
    if (res.ok) {
        currentUser = await res.json();
        checkStatus();
    } else {
        document.getElementById('login-error').innerText = "PIN non valido";
    }
});

// CHECK STATUS & FLOW
async function checkStatus() {
    const res = await fetch('/api/status');
    if (!res.ok) return showView('view-login');
    
    const status = await res.json();
    currentUser = status.user;

    // 1. Se non ha il soprannome -> Onboarding
    if (!currentUser.soprannome) {
        return showView('view-onboarding');
    }

    // 2. Se la sfida non è ancora sbloccata da Stefano
    if (!status.sfida_iniziata) {
        if (currentUser.is_admin) {
            document.getElementById('admin-controls').classList.remove('hidden');
        }
        return showView('view-waiting');
    }

    // 3. Se ha già fatto la foto oggi -> Feed
    if (status.has_photo_today) {
        loadFeed();
        return showView('view-feed');
    }

    // 4. Altrimenti -> Apri Fotocamera con Ghost
    if (status.ghost_url) {
        document.getElementById('ghost-overlay').style.backgroundImage = `url('${status.ghost_url}')`;
    }
    showView('view-camera');
    startCamera();
}

// ONBOARDING
document.getElementById('btn-save-nickname').addEventListener('click', async () => {
    const soprannome = document.getElementById('nickname-input').value;
    const res = await fetch('/api/set-soprannome', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({soprannome})
    });
    if (res.ok) checkStatus();
});

// ADMIN UNLOCK
document.getElementById('btn-unlock-challenge')?.addEventListener('click', async () => {
    const res = await fetch('/api/admin/start-challenge', {method: 'POST'});
    if (res.ok) checkStatus();
});

// CAMERA & CANVAS COMPRESSION
async function startCamera() {
    try {
        stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: "user", aspectRatio: 9/16 },
            audio: false
        });
        document.getElementById('camera-stream').srcObject = stream;
    } catch (err) {
        alert("Impossibile accedere alla fotocamera. Assicurati di dare i permessi.");
    }
}

// SHUTTER & RETAKE
document.getElementById('btn-capture').addEventListener('click', () => {
    const video = document.getElementById('camera-stream');
    const canvas = document.getElementById('camera-canvas');
    const ctx = canvas.getContext('2d');

    canvas.width = 720;
    canvas.height = 1280; // Forzato 9:16 HD

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    capturedBase64 = canvas.toDataURL('image/webp', 0.8); // Compressione WebP 80%

    video.classList.add('hidden');
    canvas.classList.remove('hidden');
    document.getElementById('btn-capture').classList.add('hidden');
    document.getElementById('retake-actions').classList.remove('hidden');
});

document.getElementById('btn-retake').addEventListener('click', () => {
    document.getElementById('camera-stream').classList.remove('hidden');
    document.getElementById('camera-canvas').classList.add('hidden');
    document.getElementById('btn-capture').classList.remove('hidden');
    document.getElementById('retake-actions').classList.add('hidden');
});

document.getElementById('btn-upload').addEventListener('click', async () => {
    const res = await fetch('/api/upload-photo', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({image: capturedBase64})
    });
    if (res.ok) {
        if (stream) stream.getTracks().forEach(track => track.stop());
        checkStatus();
    }
});

// FEED & 1-WORD COMMENTS
async function loadFeed() {
    const res = await fetch('/api/feed');
    const data = await res.json();
    const container = document.getElementById('feed-container');
    container.innerHTML = '';

    data.forEach(item => {
        const commentsHtml = item.comments.map(c => 
            `<div class="comment-tag"><span>${c.author}:</span> ${c.word}</div>`
        ).join('');

        const card = document.createElement('div');
        card.className = 'feed-item';
        card.innerHTML = `
            <div class="feed-user-info">
                <span>${item.author_name}</span>
                <span class="feed-time">${item.time}</span>
            </div>
            <img src="${item.url}" class="feed-img">
            <div class="feed-comments">
                <div id="comments-list-${item.photo_id}">${commentsHtml}</div>
                <div class="comment-input-box">
                    <input type="text" id="comment-input-${item.photo_id}" placeholder="Una parola..." maxlength="20">
                    <button class="btn-primary" onclick="sendComment(${item.photo_id})">💬</button>
                </div>
            </div>
        `;
        container.appendChild(card);
    });
}

async function sendComment(photoId) {
    const input = document.getElementById(`comment-input-${photoId}`);
    const word = input.value.trim();
    if (!word || word.includes(' ')) {
        return alert("Puoi inserire una sola parola (senza spazi)!");
    }

    const res = await fetch('/api/comment', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({photo_id: photoId, word})
    });

    if (res.ok) {
        input.value = '';
        loadFeed();
    } else {
        const err = await res.json();
        alert(err.error || "Errore durante l'invio");
    }
}
