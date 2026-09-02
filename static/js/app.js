
let currentUser = null;
let stream = null;
let capturedBase64 = null;
let midnightInterval = null;

const VAPID_PUBLIC_KEY = "BCdWDfFOUdE48sgpzDCkzR99SHBDr6fbzdRyKFdYp3ZGJAXRrsB0xz4huC5Hceh9yqANvz3-CgdPgnsPAPgnsPAJr5fn0";

function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding).replace(/\-/g, '+').replace(/_/g, '/');
    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; ++i) {
        outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
}

if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(err => console.error(err));
}

function setButtonLoading(btn, isLoading, loadingText = "Attendi...") {
    if (isLoading) {
        btn.dataset.originalText = btn.innerHTML;
        btn.innerHTML = loadingText;
        btn.disabled = true;
    } else {
        btn.innerHTML = btn.dataset.originalText || btn.innerHTML;
        btn.disabled = false;
    }
}

function showView(viewId) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.getElementById(viewId).classList.add('active');
}

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

    const s = status.stats;
    document.getElementById('stat-photos-today').innerText = `${s.photos_today}/${s.total_users}`;
    document.getElementById('stat-days-passed').innerText = `Giorno ${s.days_passed}`;

    const progressPct = Math.min(100, (s.days_passed / s.total_days) * 100);
    const progressBar = document.getElementById('progress-bar-fill');
    if (progressBar) progressBar.style.width = `${progressPct}%`;
    
    const pill = document.getElementById('countdown-pill');
    pill.innerText = `${s.days_remaining} gg a Natale`;
    if (s.days_remaining <= 15) pill.style.backgroundColor = 'var(--color-danger)';
    else if (s.days_remaining <= 31) pill.style.backgroundColor = 'var(--color-medium)';
    else pill.style.backgroundColor = 'var(--color-safe)';

    // POPOLA AVATAR UTENTI MANCANTI
    const missingContainer = document.getElementById('missing-users-container');
    if (missingContainer) {
        if (s.missing_users && s.missing_users.length > 0) {
            missingContainer.innerHTML = s.missing_users.map(u => 
                `<div class="avatar" title="${u.nome}">${u.iniziali}</div>`
            ).join('');
        } else {
            missingContainer.innerHTML = `<div style="font-size: 0.9rem; color: var(--color-safe); font-weight: 700; margin-top: 8px;">Tutti hanno scattato! 🎉</div>`;
        }
    }

    const actionCard = document.getElementById('home-action-card');
    const urlParams = new URLSearchParams(window.location.search);
    const isPreview = urlParams.get('preview') === '1' && currentUser.is_admin;

    const notifPrompt = document.getElementById('notification-prompt');
    if ('Notification' in window && Notification.permission === 'default') {
        notifPrompt.classList.remove('hidden');
    } else {
        notifPrompt.classList.add('hidden');
    }

    if (midnightInterval) clearInterval(midnightInterval);

    if (!status.sfida_iniziata && !isPreview) {
        actionCard.innerHTML = `<h3>In attesa... ⏳</h3><p class="stat-desc">Stefano deve sbloccare la sfida.</p>`;
        if (currentUser.is_admin) document.getElementById('admin-controls').classList.remove('hidden');
    } 
    else if (status.has_photo_today) {
        actionCard.innerHTML = `<h3>Grande! 🎉</h3><p class="stat-desc">Hai già fatto la tua foto oggi.</p>`;
    } 
    else {
        const hour = new Date().getHours();
        const urgent = hour >= 20; 
        const urgencyText = urgent ? "⏰ Ultime ore prima che scada la giornata!" : "Non dimenticare il tuo scatto di oggi";

        // AGGIUNTO TIMER E ANIMAZIONI BOUNCE/PULSE
        actionCard.innerHTML = `
            <h3 class="bounce-text" style="color: var(--primary);">Tocca a te! 📸</h3>
            <p class="stat-desc">${urgencyText}</p>
            <div id="midnight-timer" class="midnight-timer">--:--:--</div>
            <button id="btn-go-camera" class="btn-primary pulse-bounce" style="margin-top: 12px;">Scatta la foto di oggi</button>
        `;

        midnightInterval = setInterval(() => {
            const timerEl = document.getElementById('midnight-timer');
            if (timerEl) {
                const now = new Date();
                const midnight = new Date();
                midnight.setHours(23, 59, 59, 999);
                const diff = midnight - now;
                if (diff <= 0) {
                    timerEl.innerText = "00:00:00";
                } else {
                    const h = Math.floor(diff / (1000 * 60 * 60)).toString().padStart(2, '0');
                    const m = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60)).toString().padStart(2, '0');
                    const s = Math.floor((diff % (1000 * 60)) / 1000).toString().padStart(2, '0');
                    timerEl.innerText = `${h}:${m}:${s}`;
                }
            }
        }, 1000);

        document.getElementById('btn-go-camera').addEventListener('click', () => {
            const urlGhostShape = "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA4MDAgMTAwMCI+PGVsbGlwc2UgY3g9IjQwMCIgY3k9IjQ1MCIgcng9IjIyMCIgcnk9IjMwMCIgZmlsbD0ibm9uZSIgc3Ryb2tlPSJ3aGl0ZSIgc3Ryb2tlLXdpZHRoPSI4IiBzdHJva2UtZGFzaGFycmF5PSIxNSwxNSIgb3BhY2l0eT0iMC44Ii8+PC9zdmc+";
            const urlGhostPhoto = status.ghost_url || null;
            
            // Setup pulsanti Fantasma/Sagoma
            const btnPhoto = document.getElementById('btn-ghost-photo');
            const btnShape = document.getElementById('btn-ghost-shape');
            
            btnPhoto.onclick = () => {
                btnPhoto.classList.add('active'); btnShape.classList.remove('active');
                document.getElementById('ghost-overlay').style.backgroundImage = urlGhostPhoto ? `url("${urlGhostPhoto}")` : 'none';
            };
            btnShape.onclick = () => {
                btnShape.classList.add('active'); btnPhoto.classList.remove('active');
                document.getElementById('ghost-overlay').style.backgroundImage = `url("${urlGhostShape}")`;
            };

            // Se non c'è una foto di ieri, nascondi il bottone "Foto di ieri"
            if (urlGhostPhoto) {
                btnPhoto.style.display = 'block';
                btnPhoto.click(); // Default a foto di ieri
            } else {
                btnPhoto.style.display = 'none';
                btnShape.click(); // Default a sagoma
            }

            document.getElementById('ghost-overlay').classList.remove('hidden');
            showView('view-camera');
            startCamera();
        });
    }
    showView('view-home');
}

document.getElementById('btn-enable-notif')?.addEventListener('click', async () => {
    const btn = document.getElementById('btn-enable-notif');
    setButtonLoading(btn, true, "Attivazione...");
    try {
        const permission = await Notification.requestPermission();
        if (permission === 'granted') {
            const reg = await navigator.serviceWorker.ready;
            let sub = await reg.pushManager.getSubscription();
            if (!sub) {
                sub = await reg.pushManager.subscribe({
                    userVisibleOnly: true,
                    applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
                });
            }
            await fetch('/api/subscribe', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify(sub)
            });
            checkStatus();
        }
    } catch (err) {
        console.error("Errore notifiche:", err);
    } finally {
        setButtonLoading(btn, false);
    }
});

document.getElementById('btn-unlock-challenge')?.addEventListener('click', async () => {
    await fetch('/api/admin/start-challenge', {method: 'POST'});
    checkStatus();
});

document.getElementById('btn-save-nickname').addEventListener('click', async () => {
    const soprannome = document.getElementById('nickname-input').value;
    const res = await fetch('/api/set-soprannome', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({soprannome}) });
    if (res.ok) checkStatus();
});

async function startCamera() {
    try {
        stream = await navigator.mediaDevices.getUserMedia({ 
            video: { facingMode: "user", aspectRatio: { ideal: 4/5 } }, 
            audio: false 
        });
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

document.getElementById('btn-capture').addEventListener('click', () => {
    const video = document.getElementById('camera-stream');
    const canvas = document.getElementById('camera-canvas');
    const ctx = canvas.getContext('2d');
    const flash = document.getElementById('screen-flash');

    flash.classList.add('flash-active');
    setTimeout(() => {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        ctx.translate(canvas.width, 0);
        ctx.scale(-1, 1);
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        capturedBase64 = canvas.toDataURL('image/webp', 0.8); 
        document.getElementById('ghost-overlay').classList.add('hidden');
        video.classList.add('hidden');
        canvas.classList.remove('hidden');
        document.getElementById('btn-capture').classList.add('hidden');
        document.getElementById('retake-actions').classList.remove('hidden');
        flash.classList.remove('flash-active');
    }, 150);
});

document.getElementById('btn-retake').addEventListener('click', startCamera);
document.getElementById('btn-retake').addEventListener('click', () => {
    document.getElementById('ghost-overlay').classList.remove('hidden');
    startCamera();
});

document.getElementById('btn-upload').addEventListener('click', async () => {
    const btn = document.getElementById('btn-upload');
    setButtonLoading(btn, true, "Invio...");
    try {
        const res = await fetch('/api/upload-photo', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({image: capturedBase64}) });
        if (res.ok) {
            if (stream) stream.getTracks().forEach(track => track.stop());
            const overlay = document.getElementById('success-overlay');
            overlay.classList.add('active');
            setTimeout(() => {
                overlay.classList.remove('active');
                checkStatus();
            }, 1300);
        }
    } finally {
        setButtonLoading(btn, false);
    }
});

document.getElementById('btn-open-calendar').addEventListener('click', async () => {
    const btn = document.getElementById('btn-open-calendar');
    setButtonLoading(btn, true, "Carico...");
    try {
        const res = await fetch('/api/calendar');
        const data = await res.json();
        renderCalendar(data);
        showView('view-calendar');
    } finally {
        setButtonLoading(btn, false);
    }
});

const MESI_IT = ["Gennaio","Febbraio","Marzo","Aprile","Maggio","Giugno","Luglio","Agosto","Settembre","Ottobre","Novembre","Dicembre"];
const GIORNI_IT = ["L","M","M","G","V","S","D"];

function renderCalendar(data) {
    const container = document.getElementById('calendar-container');
    container.innerHTML = '';
    const today = data.today;
    const dayKeys = Object.keys(data.days).sort();
    const months = {};
    
    dayKeys.forEach(key => {
        const d = new Date(key + 'T00:00:00');
        const mk = `${d.getFullYear()}-${d.getMonth()}`;
        if (!months[mk]) months[mk] = { year: d.getFullYear(), month: d.getMonth(), days: [] };
        months[mk].days.push(key);
    });

    Object.values(months).forEach(m => {
        const monthBlock = document.createElement('div');
        monthBlock.className = 'month-block';
        const title = document.createElement('div');
        title.className = 'month-title';
        title.innerText = `${MESI_IT[m.month]} ${m.year}`;
        monthBlock.appendChild(title);
        
        const weekdaysRow = document.createElement('div');
        weekdaysRow.className = 'calendar-grid weekday-row';
        GIORNI_IT.forEach(g => {
            const cell = document.createElement('div');
            cell.className = 'weekday-label';
            cell.innerText = g;
            weekdaysRow.appendChild(cell);
        });
        monthBlock.appendChild(weekdaysRow);
        
        const grid = document.createElement('div');
        grid.className = 'calendar-grid';
        const firstDay = new Date(m.days[0] + 'T00:00:00');
        let firstWeekday = firstDay.getDay();
        firstWeekday = (firstWeekday === 0) ? 6 : firstWeekday - 1; 
        for (let i = 0; i < firstWeekday; i++) {
            const empty = document.createElement('div');
            empty.className = 'day-cell empty';
            grid.appendChild(empty);
        }
        
        m.days.forEach(key => {
            const info = data.days[key];
            const dayNum = parseInt(key.split('-')[2]);
            const cell = document.createElement('div');
            cell.className = 'day-cell';
            cell.classList.add(key < today ? 'past' : 'upcoming');
            if (key === today) cell.classList.add('today');
            cell.innerHTML = `<span class="day-number">${dayNum}</span>`;
            if (info.count > 0) {
                cell.innerHTML += `<span class="day-count">${info.count}</span>`;
                cell.classList.add('has-photos');
                if (info.count === 4) cell.classList.add('all-done');
                cell.addEventListener('click', () => showDayPhotos(key, info.photos));
            }
            grid.appendChild(cell);
        });
        monthBlock.appendChild(grid);
        container.appendChild(monthBlock);
    });
    const detailBox = document.createElement('div');
    detailBox.id = 'day-detail';
    container.appendChild(detailBox);
}

function showDayPhotos(dateKey, photos) {
    const detailBox = document.getElementById('day-detail');
    if (!photos.length) return;
    const [y, mo, d] = dateKey.split('-');
    const photosHtml = photos.map(p => `
        <div class="photo-item">
            <img src="${p.url}">
            <div class="photo-author">${p.author_name} - ${p.time}</div>
        </div>
    `).join('');
    detailBox.innerHTML = `
        <div class="day-title">${d}/${mo}/${y}</div>
        <div class="photo-grid">${photosHtml}</div>
    `;
    detailBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

checkStatus();


let currentPhotoIdForComment = null;

// Sostituisci il vecchio photosHtml dentro showDayPhotos con questo:
function showDayPhotos(dateKey, photos) {
    const detailBox = document.getElementById('day-detail');
    if (!photos.length) return;
    const [y, mo, d] = dateKey.split('-');
    const photosHtml = photos.map(p => {
        const commentsJson = JSON.stringify(p.comments).replace(/"/g, '&quot;');
        return `
            <div class="photo-item" onclick="openPhotoModal(${p.photo_id}, '${p.url}', '${p.author_name}', ${commentsJson})" style="cursor:pointer;">
                <img src="${p.url}">
                <div class="photo-author">${p.author_name} - ${p.time}</div>
            </div>
        `;
    }).join('');
    detailBox.innerHTML = `
        <div class="day-title">${d}/${mo}/${y} <span style="font-size:0.8rem; color:var(--text-muted); font-weight:normal; margin-left:8px;">(Tocca una foto per ingrandirla)</span></div>
        <div class="photo-grid">${photosHtml}</div>
    `;
    detailBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// Logica Apertura Popup
window.openPhotoModal = function(photoId, url, author, comments) {
    document.getElementById('photo-modal').classList.add('active');
    document.getElementById('modal-img').src = url;
    document.getElementById('modal-author').innerText = author;
    currentPhotoIdForComment = photoId;
    
    const commentsContainer = document.getElementById('modal-comments');
    commentsContainer.innerHTML = comments.map(c => `<div class="comment-chip">${c.word} <span class="comment-author-span">- ${c.author_name}</span></div>`).join('');
    document.getElementById('comment-input').value = '';
};

document.getElementById('modal-close').onclick = () => {
    document.getElementById('photo-modal').classList.remove('active');
};

document.getElementById('btn-send-comment').onclick = async () => {
    const word = document.getElementById('comment-input').value.trim();
    if (!word || word.includes(' ') || word.length > 20) {
        return alert("Inserisci una sola parola! (Senza spazi, max 20 caratteri)");
    }
    
    const btn = document.getElementById('btn-send-comment');
    setButtonLoading(btn, true, "...");
    try {
        const res = await fetch('/api/comment', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({photo_id: currentPhotoIdForComment, word: word})
        });
        if (res.ok) {
            document.getElementById('photo-modal').classList.remove('active');
            document.getElementById('btn-open-calendar').click(); // Ricarica il calendario in automatico
        } else {
            const err = await res.json();
            alert(err.error || "Errore inserimento commento");
        }
    } finally {
        setButtonLoading(btn, false);
    }
};
