/* =========================================================
   FODUS BAFFO - app.js (v16)
   Sezioni: stato · utilità · notifiche/SW · login · status/home
            · fotocamera · calendario · foto+commenti · recap
   ========================================================= */

const PIN_KEY = 'fodus_baffo_pin';
const CACHE_KEY = 'fodus_baffo_status_v1';
const VAPID_PUBLIC_KEY = "BFR1mDVfW2DBRV4hZenFgMHm-GgVv3A09Z9f9SmSExZZuL6smbWy-mlk-vmZ3IiibKdnrmEka95XIcTUDchqvng";
const FONT_STACK = '"Space Grotesk", -apple-system, "Helvetica Neue", sans-serif';

let currentUser = null;
let stream = null;
let capturedBase64 = null;
let midnightInterval = null;
let currentPhotoIdForComment = null;
let currentPhotoRef = null;   // foto attualmente aperta nel modale
let lastStatus = null;        // ultimo /api/status ricevuto (o dalla cache)
let lastStatusAt = 0;
let calendarData = null;      // ultimo /api/calendar
let sheetDayList = [];        // giorni con foto, in ordine cronologico (per swipe nel foglio)
let sheetDayIndex = -1;       // indice del giorno attualmente aperto nel foglio
let sheetTotal = 0;           // numero totale di partecipanti (per il conteggio nel foglio)
let recapBlob = null;
let recapObjectUrl = null;
let isFirstRender = true;     // flag per animare solo al primo caricamento

const $ = (id) => document.getElementById(id);
const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));
const INITIALS_KEY = 'fodus_baffo_initials';
/** Iniziali nome+cognome. Cerca il campo nell'utente, poi nella lista "chi manca", poi le ricorda. */
function userInitials(user, stats) {
    const clean = (v) => String(v || '').trim();
    let ini = clean(user.iniziali);
    if (!ini && stats && stats.missing_users) {
        const m = stats.missing_users.find(u => u.nome === user.nome || u.nome === user.soprannome);
        if (m) ini = clean(m.iniziali);
    }
    if (!ini) {
        const n = clean(user.nome), c = clean(user.cognome);
        if (n && c) ini = n[0] + c[0];
        else {
            const parts = n.split(/\s+/).filter(Boolean);
            if (parts.length > 1) ini = parts[0][0] + parts[parts.length - 1][0];
        }
    }
    if (ini) {
        ini = ini.toUpperCase();
        try { localStorage.setItem(INITIALS_KEY, ini); } catch (e) {}
        return ini;
    }
    try { const saved = localStorage.getItem(INITIALS_KEY); if (saved) return saved; } catch (e) {}
    return clean(user.nome || user.soprannome).slice(0, 2).toUpperCase();
}
const myName = () => (currentUser && (currentUser.soprannome || currentUser.nome)) || '';

/* ---------- Frasi simpatiche ---------- */
let funnyPhrases = ["Bel baffo!"]; // frase di emergenza se il file non carica
fetch('/static/phrases.json')
    .then(res => res.json())
    .then(data => funnyPhrases = data)
    .catch(err => console.error("Errore frasi:", err));

/* ---------- Coriandoli ---------- */
function fireConfetti() {
    const canvas = $('confetti-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    const particles = [];
    const colors = ['#4B2E1E', '#1E6B4E', '#E0A526', '#C43D3D'];

    for (let i = 0; i < 80; i++) {
        particles.push({
            x: canvas.width / 2,
            y: canvas.height / 2 + 50,
            r: Math.random() * 6 + 3,
            dx: Math.random() * 12 - 6,
            dy: Math.random() * -15 - 5,
            color: colors[Math.floor(Math.random() * colors.length)]
        });
    }

    let animationFrameId;
    function animate() {
        animationFrameId = requestAnimationFrame(animate);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        particles.forEach(p => {
            p.x += p.dx;
            p.y += p.dy;
            p.dy += 0.3; // gravità
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
            ctx.fillStyle = p.color;
            ctx.fill();
        });
    }
    animate();
    // ferma l'animazione dopo 2 secondi per risparmiare batteria
    setTimeout(() => cancelAnimationFrame(animationFrameId), 2000);
}

/* =========================================================
   NOTIFICHE / SERVICE WORKER  (logica invariata)
   ========================================================= */
function urlBase64ToUint8Array(base64String) {
    // Rimuove brutalmente qualsiasi carattere che non appartenga all'alfabeto Base64 o Base64URL
    const sanitized = base64String.replace(/[^A-Za-z0-9\+\/\-\_]/g, '');

    const padding = '='.repeat((4 - (sanitized.length % 4)) % 4);
    const base64 = (sanitized + padding)
        .replace(/\-/g, '+')
        .replace(/_/g, '/');

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

document.getElementById('btn-enable-notif')?.addEventListener('click', async () => {
    const btn = document.getElementById('btn-enable-notif');
    setButtonLoading(btn, true, "Attivazione...");
    try {
        console.log("1. Richiedo il permesso notifiche...");
        const permission = await Notification.requestPermission();
        if (permission === 'granted') {
            console.log("2. Permesso concesso, attendo il Service Worker...");
            const reg = await navigator.serviceWorker.ready;

            console.log("3. Verifico sottoscrizione esistente...");
            let sub = await reg.pushManager.getSubscription();

            if (!sub) {
                console.log("4. Nessuna sottoscrizione trovata, ne creo una nuova...");
                const convertedKey = urlBase64ToUint8Array(VAPID_PUBLIC_KEY);
                sub = await reg.pushManager.subscribe({
                    userVisibleOnly: true,
                    applicationServerKey: convertedKey
                });
            }

            console.log("5. Invio la sottoscrizione al server...");
            const res = await fetch('/api/subscribe', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify(sub)
            });

            if (res.ok) {
                console.log("6. Salvataggio OK!");
                checkStatus();
            } else {
                alert("Errore salvataggio server backend.");
            }
        } else {
            alert("Permesso notifiche negato dall'utente.");
        }
    } catch (err) {
        // STAMPA L'ERRORE REALE E PRECISO IN UN ALERT
        console.error("Errore dettagliato notifiche:", err);
        alert(`CRASH AL PASSO: ${err.name} - ${err.message}`);
    } finally {
        setButtonLoading(btn, false);
    }
});

/* =========================================================
   UTILITÀ UI
   ========================================================= */
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
    $(viewId).classList.add('active');
    document.body.dataset.view = viewId;
    document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.view === viewId));
    const main = $('app-main');
    if (main && viewId !== 'view-camera') main.scrollTop = 0;
}

function openLayer(el) {
    clearTimeout(el._t);
    el.classList.remove('hidden');
    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('active')));
}
function closeLayer(el) {
    el.classList.remove('active');
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.add('hidden'), 220);
}

let toastTimer = null;
function toast(msg, ms = 3200) {
    const el = $('toast');
    el.textContent = msg;
    el.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.add('hidden'), ms);
}

function flashSuccess(text, { confetti = false, hold = 1300 } = {}) {
    return new Promise(resolve => {
        const overlay = $('success-overlay');
        $('success-text').textContent = text;
        overlay.classList.remove('hidden');
        setTimeout(() => {
            overlay.classList.add('active');
            if (confetti) {
                if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
                fireConfetti();
            }
            setTimeout(() => {
                overlay.classList.remove('active');
                setTimeout(() => { overlay.classList.add('hidden'); resolve(); }, 300);
            }, hold);
        }, 10);
    });
}

function localDayKey() {
    const d = new Date();
    return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

/* =========================================================
   LOGIN
   ========================================================= */
let loginBusy = false;
async function doLogin(pin) {
    if (loginBusy || !pin) return;
    loginBusy = true;
    const btn = $('btn-login');
    setButtonLoading(btn, true, "Verifico...");
    $('login-error').textContent = '';
    try {
        const res = await fetch('/api/login', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({pin})
        });
        if (res.ok) {
            // Salva il PIN nella memoria permanente del telefono
            localStorage.setItem(PIN_KEY, pin);
            currentUser = await res.json();
            await checkStatus();
        } else {
            $('login-error').textContent = "PIN errato";
            $('pin-input').value = '';
        }
    } catch (err) {
        $('login-error').textContent = "Connessione assente, riprova";
    } finally {
        loginBusy = false;
        setButtonLoading(btn, false);
    }
}

$('btn-login').addEventListener('click', () => doLogin($('pin-input').value));
$('pin-input').addEventListener('input', (e) => {
    if (e.target.value.length === 4) doLogin(e.target.value);
});

$('btn-save-nickname').addEventListener('click', async () => {
    const soprannome = $('nickname-input').value.trim();
    if (!soprannome) return;
    const res = await fetch('/api/set-soprannome', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({soprannome})
    });
    if (res.ok) checkStatus();
});

$('btn-unlock-challenge')?.addEventListener('click', async () => {
    await fetch('/api/admin/start-challenge', {method: 'POST'});
    checkStatus();
});

/* =========================================================
   STATUS + HOME
   ========================================================= */
function saveCache(status) {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify({ day: localDayKey(), status })); } catch (e) {}
}
function loadCache() {
    try {
        const c = JSON.parse(localStorage.getItem(CACHE_KEY));
        if (c && c.day === localDayKey() && c.status && c.status.stats) return c.status;
    } catch (e) {}
    return null;
}

function showConnectionProblem() {
    if (lastStatus) { toast('Sei offline: i dati potrebbero non essere aggiornati'); return; }
    $('splash-msg').textContent = 'Connessione assente';
    $('btn-retry').classList.remove('hidden');
    showView('view-splash');
}
$('btn-retry').addEventListener('click', () => {
    $('btn-retry').classList.add('hidden');
    $('splash-msg').textContent = '';
    checkStatus();
});

/**
 * Scarica lo stato e aggiorna la home.
 * { stay: true } = aggiornamento in background: non cambia la schermata in cui sei.
 */
async function checkStatus(opts = {}) {
    const stay = opts.stay === true;
    let res;
    try {
        res = await fetch('/api/status');

        // Se la sessione è scaduta (es. app chiusa e riaperta)
        if (!res.ok) {
            const savedPin = localStorage.getItem(PIN_KEY);
            if (savedPin) {
                // Tenta il login invisibile usando il PIN salvato
                const loginRes = await fetch('/api/login', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({pin: savedPin})
                });

                if (loginRes.ok) {
                    res = await fetch('/api/status');
                } else {
                    // PIN salvato errato o cambiato, puliamo la memoria
                    localStorage.removeItem(PIN_KEY);
                    return showView('view-login');
                }
            } else {
                return showView('view-login');
            }
        }
    } catch (err) {
        return showConnectionProblem();
    }

    let status;
    try { status = await res.json(); } catch (err) { return showConnectionProblem(); }

    currentUser = status.user;
    lastStatus = status;
    lastStatusAt = Date.now();
    if (!currentUser.soprannome) return showView('view-onboarding');

    saveCache(status);
    renderHome(status);

    const active = document.body.dataset.view;
    if (!stay || ['view-splash', 'view-login', 'view-onboarding'].includes(active)) showView('view-home');
}

function renderTicks(daysPassed, totalDays, animate = false) {
    const box = $('day-ticks');
    if (!box || !totalDays) return;
    if (box.childElementCount !== totalDays) {
        box.innerHTML = '';
        for (let i = 1; i <= totalDays; i++) {
            const t = document.createElement('i');
            if (i % 10 === 0) t.className = 'm';
            if (i === totalDays) t.className = 'end';
            box.appendChild(t);
        }
    }
    [...box.children].forEach((t, idx) => {
        const day = idx + 1;
        t.classList.toggle('on', day <= daysPassed);
        t.classList.toggle('now', day === daysPassed && day !== totalDays);
        
        // Aggiungi animazione al primo caricamento
        if (animate && (day <= daysPassed || day === totalDays)) {
            t.style.setProperty('--tick-index', idx);
            t.classList.add('animate-tick');
        }
    });
}

/**
 * Anima il contatore dei giorni da 0 al valore finale
 * Eseguita solo al primo caricamento dell'app
 */
function animateDayCounter(finalValue, duration = 600) {
    return new Promise(resolve => {
        const el = $('stat-days-passed');
        if (!el) return resolve();
        
        const startTime = Date.now();
        const startValue = 0;
        
        const animate = () => {
            const elapsed = Date.now() - startTime;
            const progress = Math.min(elapsed / duration, 1);
            const current = Math.floor(startValue + (finalValue - startValue) * progress);
            el.textContent = current;
            
            if (progress < 1) {
                requestAnimationFrame(animate);
            } else {
                el.textContent = finalValue;
                resolve();
            }
        };
        
        requestAnimationFrame(animate);
    });
}

function renderHome(status, opts = {}) {
    const s = status.stats;
    const user = status.user;

    // Header: iniziali dell'utente
    const hu = $('header-user');
    if (hu && user) {
        const ini = userInitials(user, s);
        hu.textContent = ini;
        hu.classList.toggle('hidden', !ini);
    }

    // Giorno di sfida + tacche
    // Se è il primo caricamento, anima il contatore e le tacche
    if (isFirstRender) {
        animateDayCounter(s.days_passed, 600);
        renderTicks(s.days_passed, s.total_days, true);
        isFirstRender = false;
    } else {
        $('stat-days-passed').textContent = s.days_passed;
        renderTicks(s.days_passed, s.total_days, false);
    }
    $('stat-total-days').textContent = s.total_days;

    // Countdown a Natale (appare subito: viene dalla cache al primo frame)
    const pill = $('countdown-pill');
    pill.classList.remove('skeleton', 'is-safe', 'is-medium', 'is-danger');
    if (s.days_remaining <= 0) pill.textContent = 'È Natale!';
    else if (s.days_remaining === 1) pill.textContent = '1 giorno a Natale';
    else pill.textContent = `${s.days_remaining} giorni a Natale`;
    if (s.days_remaining <= 15) pill.classList.add('is-danger');
    else if (s.days_remaining <= 31) pill.classList.add('is-medium');
    else pill.classList.add('is-safe');

    // Oggi: chi ha scattato e chi manca
    $('stat-photos-today').textContent = `${s.photos_today}/${s.total_users}`;
    const missing = s.missing_users || [];
    const done = Math.max(0, s.total_users - missing.length);
    const check = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
    let dotsHtml = '';
    for (let i = 0; i < done; i++) dotsHtml += `<div class="dot done">${check}</div>`;
    dotsHtml += missing.map(u => `<div class="dot missing" title="${escapeHtml(u.nome)}">${escapeHtml(u.iniziali)}</div>`).join('');
    if (!missing.length && s.total_users > 0) dotsHtml += `<div class="dots-note">Tutti hanno scattato</div>`;
    $('missing-users-container').innerHTML = dotsHtml;

    // Banner notifiche (logica invariata)
    const notifPrompt = $('notification-prompt');
    if ('Notification' in window && Notification.permission !== 'granted') {
        notifPrompt.classList.remove('hidden');
    } else {
        notifPrompt.classList.add('hidden');
    }

    renderActionCard(status);
}

function renderActionCard(status) {
    const actionCard = $('home-action-card');
    const urlParams = new URLSearchParams(window.location.search);
    const isPreview = urlParams.get('preview') === '1' && currentUser.is_admin;

    if (midnightInterval) clearInterval(midnightInterval);
    actionCard.classList.remove('is-loading', 'todo', 'done', 'wait');

    if (!status.sfida_iniziata && !isPreview) {
        actionCard.classList.add('wait');
        actionCard.innerHTML = `<h3>In attesa</h3><p>Stefano deve sbloccare la sfida.</p>`;
        if (currentUser.is_admin) $('admin-controls').classList.remove('hidden');
        return;
    }

    if (status.has_photo_today) {
        actionCard.classList.add('done');
        actionCard.innerHTML = `
            <div class="done-mark"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></div>
            <h3>Foto di oggi inviata</h3>
            <p class="timer-label">Nuova giornata tra</p>
            <div id="midnight-timer" class="midnight-timer">--:--:--</div>`;
        startMidnightTimer();
        return;
    }

    const urgent = new Date().getHours() >= 20;
    const urgencyText = urgent ? "Ultime ore: la giornata sta per finire" : "Hai tempo fino a mezzanotte";

    actionCard.classList.add('todo');
    actionCard.innerHTML = `
        <h3>Tocca a te</h3>
        <p>${urgencyText}</p>
        <p class="timer-label">Mancano</p>
        <div id="midnight-timer" class="midnight-timer">--:--:--</div>
        <button id="btn-go-camera" class="btn btn-light pulse-ring">
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8.5h3l1.6-2.5h6.8L17 8.5h3a1 1 0 0 1 1 1V18a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9.5a1 1 0 0 1 1-1z"/><circle cx="12" cy="13.5" r="3.5"/></svg>
            Scatta la foto di oggi
        </button>`;
    startMidnightTimer();
    $('btn-go-camera').addEventListener('click', () => openCamera(status));
}

function startMidnightTimer() {
    const tick = () => {
        const timerEl = $('midnight-timer');
        if (!timerEl) return;
        const now = new Date();
        const midnight = new Date();
        midnight.setHours(23, 59, 59, 999);
        const diff = midnight - now;
        if (diff <= 0) {
            timerEl.textContent = "00:00:00";
            clearInterval(midnightInterval);
            setTimeout(() => checkStatus({stay: true}), 2500); // nuova giornata
        } else {
            const h = Math.floor(diff / 3600000).toString().padStart(2, '0');
            const m = Math.floor((diff % 3600000) / 60000).toString().padStart(2, '0');
            const s = Math.floor((diff % 60000) / 1000).toString().padStart(2, '0');
            timerEl.textContent = `${h}:${m}:${s}`;
        }
    };
    tick(); // subito, senza aspettare 1 secondo
    midnightInterval = setInterval(tick, 1000);
}

/* ---------- Tab bar ---------- */
document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
        if (tab.dataset.view === 'view-calendar') {
            openCalendar();
        } else {
            showView('view-home');
            if (Date.now() - lastStatusAt > 15000) checkStatus({stay: true});
        }
    });
});

/* =========================================================
   FOTOCAMERA
   Lo stream viene aperto una volta, riusato per "Rifai" e
   chiuso quando esci. Niente più getUserMedia ripetuti.
   ========================================================= */
const GHOST_SHAPE = "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA4MDAgMTAwMCI+PGVsbGlwc2UgY3g9IjQwMCIgY3k9IjQ1MCIgcng9IjIyMCIgcnk9IjMwMCIgZmlsbD0ibm9uZSIgc3Ryb2tlPSJ3aGl0ZSIgc3Ryb2tlLXdpZHRoPSI4IiBzdHJva2UtZGFzaGFycmF5PSIxNSwxNSIgb3BhY2l0eT0iMC44Ii8+PC9zdmc+";
let ghostPhotoUrl = null;

function setGhost(mode) {
    ['photo', 'shape', 'off'].forEach(m => $('btn-ghost-' + m).classList.toggle('active', m === mode));
    const overlay = $('ghost-overlay');
    if (mode === 'photo' && ghostPhotoUrl) overlay.style.backgroundImage = `url("${ghostPhotoUrl}")`;
    else if (mode === 'shape') overlay.style.backgroundImage = `url("${GHOST_SHAPE}")`;
    else overlay.style.backgroundImage = 'none';
}
$('btn-ghost-photo').onclick = () => setGhost('photo');
$('btn-ghost-shape').onclick = () => setGhost('shape');
$('btn-ghost-off').onclick = () => setGhost('off');

function openCamera(status) {
    ghostPhotoUrl = status.ghost_url || null;
    $('btn-ghost-photo').style.display = ghostPhotoUrl ? '' : 'none';
    setGhost(ghostPhotoUrl ? 'photo' : 'shape');
    capturedBase64 = null;
    showView('view-camera');
    startCamera();
}

function hasLiveStream() {
    return !!stream && stream.getVideoTracks().some(t => t.readyState === 'live');
}

function stopCamera() {
    if (stream) stream.getTracks().forEach(t => t.stop());
    stream = null;
    const v = $('camera-stream');
    if (v) v.srcObject = null;
}

function showLive() {
    $('camera-stream').classList.remove('hidden');
    $('camera-canvas').classList.add('hidden');
    $('ghost-overlay').classList.remove('hidden');
    $('btn-capture').classList.remove('hidden');
    $('retake-actions').classList.add('hidden');
    const phraseEl = $('funny-phrase-overlay');
    phraseEl.classList.remove('show-phrase');
    phraseEl.classList.add('hidden');
}

async function startCamera() {
    const video = $('camera-stream');
    try {
        if (!hasLiveStream()) {
            stopCamera(); // mai due stream aperti insieme
            stream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: "user", aspectRatio: { ideal: 4 / 5 } },
                audio: false
            });
        }
        video.srcObject = stream;
        await video.play().catch(() => {});
        showLive();
    } catch (err) {
        console.error("Errore fotocamera:", err);
        stopCamera();
        showView('view-home');
        toast(err && err.name === 'NotAllowedError'
            ? "Fotocamera non consentita: abilitala dalle impostazioni del telefono."
            : "Non riesco ad aprire la fotocamera.", 4500);
    }
}

$('btn-camera-close').addEventListener('click', () => {
    stopCamera();
    capturedBase64 = null;
    showView('view-home');
    checkStatus({stay: true});
});

$('btn-capture').addEventListener('click', () => {
    const video = $('camera-stream');
    const canvas = $('camera-canvas');
    const ctx = canvas.getContext('2d');
    const flash = $('screen-flash');
    if (!video.videoWidth) return;

    flash.classList.add('flash-active');
    setTimeout(() => {
        // Ritaglio centrale 4:5, identico a ciò che vedi nell'anteprima
        const vw = video.videoWidth, vh = video.videoHeight;
        const target = 4 / 5;
        let sx, sy, sw, sh;
        if (vw / vh > target) { sh = vh; sw = vh * target; sx = (vw - sw) / 2; sy = 0; }
        else { sw = vw; sh = vw / target; sx = 0; sy = (vh - sh) / 2; }
        const outW = Math.min(Math.round(sw), 1080);
        const outH = Math.round(outW / target);

        canvas.width = outW;
        canvas.height = outH;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.translate(outW, 0);
        ctx.scale(-1, 1); // specchio, come l'anteprima
        ctx.drawImage(video, sx, sy, sw, sh, 0, 0, outW, outH);
        capturedBase64 = canvas.toDataURL('image/webp', 0.8);

        video.pause(); // lo stream resta aperto: "Rifai" è istantaneo
        $('ghost-overlay').classList.add('hidden');
        video.classList.add('hidden');
        canvas.classList.remove('hidden');
        $('btn-capture').classList.add('hidden');
        $('retake-actions').classList.remove('hidden');
        flash.classList.remove('flash-active');

        const phraseEl = $('funny-phrase-overlay');
        phraseEl.textContent = funnyPhrases[Math.floor(Math.random() * funnyPhrases.length)];
        phraseEl.classList.remove('hidden');
        phraseEl.classList.remove('show-phrase');
        void phraseEl.offsetWidth; // riavvia l'animazione ad ogni scatto
        phraseEl.classList.add('show-phrase');
    }, 150);
});

$('btn-retake').addEventListener('click', () => {
    capturedBase64 = null;
    if (hasLiveStream()) {
        $('camera-stream').play().catch(() => {});
        showLive();
    } else {
        startCamera();
    }
});

$('btn-upload').addEventListener('click', async () => {
    if (!capturedBase64) return;
    const btn = $('btn-upload');
    const loader = $('loading-overlay');

    setButtonLoading(btn, true, "Invio...");
    loader.classList.remove('hidden');

    try {
        const res = await fetch('/api/upload-photo', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({image: capturedBase64})
        });

        loader.classList.add('hidden');
        if (res.ok) {
            stopCamera();
            capturedBase64 = null;
            calendarData = null; // il calendario va riscaricato
            await flashSuccess('Inviata!', { confetti: true, hold: 1800 });
            checkStatus();
        } else {
            alert("Errore durante l'invio della foto.");
        }
    } catch (err) {
        loader.classList.add('hidden');
        alert("Errore di rete, riprova!");
    } finally {
        setButtonLoading(btn, false);
    }
});

// Quando l'app torna in primo piano: riapri lo stream se iOS l'ha chiuso, o aggiorna la home
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    const view = document.body.dataset.view;
    if (view === 'view-camera') {
        if (!capturedBase64 && !hasLiveStream()) startCamera();
    } else if (view === 'view-home' && Date.now() - lastStatusAt > 30000) {
        checkStatus({stay: true});
    }
});

/* =========================================================
   CALENDARIO (numerato per giorno di sfida)
   ========================================================= */
const MESI_IT = ["Gennaio","Febbraio","Marzo","Aprile","Maggio","Giugno","Luglio","Agosto","Settembre","Ottobre","Novembre","Dicembre"];

/** Restituisce [{key, dayNum, info}] con il numero di giorno della sfida. */
function challengeDays(data) {
    const keys = Object.keys(data.days).sort();
    if (!keys.length) return [];
    const toUTC = (k) => { const [y, m, d] = k.split('-').map(Number); return Date.UTC(y, m - 1, d); };
    const base = toUTC(keys[0]);
    const list = keys.map(key => ({
        key,
        dayNum: Math.round((toUTC(key) - base) / 86400000) + 1,
        info: data.days[key]
    }));
    // Allinea al "giorno N" che il server ha già calcolato per oggi
    const daysPassed = lastStatus && lastStatus.stats && lastStatus.stats.days_passed;
    const today = list.find(d => d.key === data.today);
    if (today && daysPassed > 0 && today.dayNum !== daysPassed) {
        const off = daysPassed - today.dayNum;
        list.forEach(d => d.dayNum += off);
    }
    return list;
}

async function openCalendar() {
    showView('view-calendar');
    const box = $('calendar-container');
    if (calendarData) renderCalendar(calendarData, { scrollToToday: true });
    else box.innerHTML = '<p class="empty-note">Carico…</p>';
    try {
        const res = await fetch('/api/calendar');
        if (!res.ok) throw new Error('calendar');
        calendarData = await res.json();
        renderCalendar(calendarData, { scrollToToday: box.querySelector('.day-cell') === null, keepScroll: true });
    } catch (err) {
        if (!calendarData) box.innerHTML = '<p class="empty-note">Non riesco a caricare il calendario. Riprova tra poco.</p>';
    }
}

function renderCalendar(data, opts = {}) {
    const container = $('calendar-container');
    const main = $('app-main');
    const prevScroll = main.scrollTop;
    container.innerHTML = '';

    const list = challengeDays(data);
    const total = lastStatus && lastStatus.stats ? lastStatus.stats.total_users : 0;
    const totalDays = lastStatus && lastStatus.stats ? lastStatus.stats.total_days : list.length;
    const todayEntry = list.find(d => d.key === data.today);
    $('calendar-sub').textContent = todayEntry
        ? `Giorno ${todayEntry.dayNum} di ${totalDays}`
        : `${totalDays} giorni di sfida`;

    // raggruppa per mese
    const months = [];
    list.forEach(d => {
        const dt = new Date(d.key + 'T00:00:00');
        const mk = `${dt.getFullYear()}-${dt.getMonth()}`;
        let m = months[months.length - 1];
        if (!m || m.mk !== mk) { m = { mk, year: dt.getFullYear(), month: dt.getMonth(), days: [] }; months.push(m); }
        m.days.push(d);
    });

    let todayCell = null;
    const daysWithPhotos = [];
    months.forEach(m => {
        const block = document.createElement('div');
        block.className = 'month-block';
        block.innerHTML = `
            <div class="month-head">
                <span class="month-title">${MESI_IT[m.month]} ${m.year}</span>
                <span class="month-range">Giorni ${m.days[0].dayNum}–${m.days[m.days.length - 1].dayNum}</span>
            </div>`;

        const grid = document.createElement('div');
        grid.className = 'calendar-grid';
        let firstWeekday = new Date(m.days[0].key + 'T00:00:00').getDay();
        firstWeekday = (firstWeekday === 0) ? 6 : firstWeekday - 1;
        for (let i = 0; i < firstWeekday; i++) {
            const empty = document.createElement('div');
            empty.className = 'day-cell empty';
            grid.appendChild(empty);
        }

        m.days.forEach(d => {
            const info = d.info;
            const cell = document.createElement('div');
            cell.className = 'day-cell ' + (d.key < data.today ? 'past' : 'upcoming');
            if (d.key === data.today) { cell.classList.remove('upcoming'); cell.classList.add('today'); todayCell = cell; }
            const pips = '<i></i>'.repeat(Math.min(info.count || 0, 8));
            cell.innerHTML = `<span class="day-num">${d.dayNum}</span><span class="pips">${pips}</span>`;
            if (info.count > 0) {
                cell.classList.remove('past', 'upcoming');
                cell.classList.add('has-photos');
                if (total && info.count >= total) cell.classList.add('all-done');
                cell.addEventListener('click', () => openDaySheet(d, total));
                daysWithPhotos.push(d);
            }
            grid.appendChild(cell);
        });

        block.appendChild(grid);
        container.appendChild(block);
    });

    sheetDayList = daysWithPhotos;
    sheetTotal = total;

    if (opts.scrollToToday && todayCell) {
        requestAnimationFrame(() => todayCell.scrollIntoView({ block: 'center' }));
    } else if (opts.keepScroll) {
        main.scrollTop = prevScroll;
    }
}

/* ---------- Foglio del giorno ---------- */
function openDaySheet(d, total) {
    const info = d.info;
    if (!info.photos || !info.photos.length) return;
    sheetDayIndex = sheetDayList.findIndex(x => x.key === d.key);
    sheetTotal = total;
    $('sheet-day-num').textContent = `Giorno ${d.dayNum}`;
    $('sheet-day-date').textContent = new Date(d.key + 'T00:00:00')
        .toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' });
    $('sheet-day-count').textContent = total ? `${info.count}/${total} foto` : `${info.count} foto`;

    const grid = $('sheet-grid');
    grid.innerHTML = info.photos.map((p, i) => `
        <button class="photo-item" data-idx="${i}">
            <img src="${escapeHtml(p.url)}" alt="">
            ${(p.comments && p.comments.length) ? `<span class="photo-words">${p.comments.length}</span>` : ''}
            <span class="photo-author">${escapeHtml(p.author_name)}<em>${escapeHtml(p.time)}</em></span>
        </button>`).join('');
    grid.querySelectorAll('.photo-item').forEach(el => {
        el.addEventListener('click', () => openPhotoModal(info.photos[Number(el.dataset.idx)]));
    });
    openLayer($('day-sheet'));
}
$('sheet-close').addEventListener('click', () => closeLayer($('day-sheet')));
$('day-sheet').addEventListener('click', (e) => { if (e.target === $('day-sheet')) closeLayer($('day-sheet')); });

// Naviga al giorno precedente/successivo (tra i giorni con foto) dentro il foglio aperto
function navigateDaySheet(delta) {
    if (!sheetDayList.length || sheetDayIndex === -1) return;
    const newIndex = sheetDayIndex + delta;
    if (newIndex < 0 || newIndex >= sheetDayList.length) return; // niente oltre oggi, niente prima del primo giorno
    openDaySheet(sheetDayList[newIndex], sheetTotal);
}

// Swipe orizzontale sul foglio del giorno per scorrere tra i giorni.
// A destra (dx > 0) = giorno successivo (bloccato se sei già su oggi).
// A sinistra (dx < 0) = giorno precedente.
(function initDaySheetSwipe() {
    const sheet = $('day-sheet');
    let startX = 0, startY = 0, tracking = false;
    sheet.addEventListener('touchstart', (e) => {
        if (e.touches.length !== 1) return;
        startX = e.touches[0].clientX;
        startY = e.touches[0].clientY;
        tracking = true;
    }, { passive: true });
    sheet.addEventListener('touchend', (e) => {
        if (!tracking) return;
        tracking = false;
        const t = e.changedTouches[0];
        const dx = t.clientX - startX;
        const dy = t.clientY - startY;
        if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.3) return;
        navigateDaySheet(dx > 0 ? -1 : 1);
    }, { passive: true });
})();

/* =========================================================
   FOTO + COMMENTI
   ========================================================= */
function renderComments(photo) {
    $('modal-comments').innerHTML = (photo.comments || []).map(c =>
        `<span class="comment-chip">${escapeHtml(c.word)}<small>${escapeHtml(c.author_name)}</small></span>`
    ).join('');
}

function openPhotoModal(photo) {
    currentPhotoRef = photo;
    currentPhotoIdForComment = photo.photo_id;
    photo.comments = photo.comments || [];

    $('modal-img').src = photo.url;
    $('modal-author').textContent = photo.author_name;
    renderComments(photo);

    const me = myName();
    const isMyPhoto = (photo.author_name === me);
    const alreadyCommented = photo.comments.some(c => c.author_name === me);
    $('comment-input').value = '';
    document.querySelector('.comment-input-area').style.display = (isMyPhoto || alreadyCommented) ? 'none' : 'flex';

    openLayer($('photo-modal'));
}

$('modal-close').addEventListener('click', () => closeLayer($('photo-modal')));
$('photo-modal').addEventListener('click', (e) => { if (e.target === $('photo-modal')) closeLayer($('photo-modal')); });

$('btn-send-comment').addEventListener('click', async () => {
    const inputEl = $('comment-input');
    const word = inputEl.value.trim();
    if (!word || word.includes(' ') || word.length > 20) {
        return toast("Inserisci una sola parola (senza spazi, max 20 caratteri)");
    }

    const btn = $('btn-send-comment');
    setButtonLoading(btn, true, "...");
    try {
        const res = await fetch('/api/comment', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({photo_id: currentPhotoIdForComment, word: word})
        });

        if (res.ok) {
            const data = await res.json();
            if (currentPhotoRef) {
                currentPhotoRef.comments.push({ word: data.word, author_name: data.author_name });
                renderComments(currentPhotoRef);
            }
            inputEl.value = '';
            document.querySelector('.comment-input-area').style.display = 'none';
            flashSuccess('Commento inviato', { hold: 1000 });
        } else {
            const err = await res.json();
            toast(err.error || "Errore inserimento commento");
        }
    } catch (err) {
        toast("Errore di rete, riprova");
    } finally {
        setButtonLoading(btn, false);
    }
});

/* =========================================================
   RECAP VELOCE
   4 foto tue: la prima, l'ultima e 2 in mezzo a intervalli
   uguali (agganciate al giorno con foto più vicino).
   ========================================================= */
function pickRecapPhotos(mine) {
    const first = mine[0];
    const last = mine[mine.length - 1];
    const span = last.dayNum - first.dayNum;
    const mid = mine.slice(1, -1);
    const nearest = (target, pool) =>
        pool.reduce((best, c) => Math.abs(c.dayNum - target) < Math.abs(best.dayNum - target) ? c : best);
    const a = nearest(first.dayNum + span / 3, mid);
    const b = nearest(first.dayNum + (2 * span) / 3, mid.filter(x => x !== a));
    return [first, a, b, last].sort((x, y) => x.dayNum - y.dayNum);
}

function loadImage(url) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('img ' + url));
        img.src = url;
    });
}

function roundedRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
}

function drawCover(ctx, img, x, y, w, h) {
    const ir = img.width / img.height, tr = w / h;
    let sx = 0, sy = 0, sw = img.width, sh = img.height;
    if (ir > tr) { sw = img.height * tr; sx = (img.width - sw) / 2; }
    else { sh = img.width / tr; sy = (img.height - sh) / 2; }
    ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
}

async function renderRecapImage(picks, name) {
    try { await document.fonts.load(`700 40px ${FONT_STACK}`); await document.fonts.load(`500 30px ${FONT_STACK}`); } catch (e) {}
    const [imgs, icon] = await Promise.all([
        Promise.all(picks.map(p => loadImage(p.url))),
        loadImage('/static/icons/icon-192.png').catch(() => null)
    ]);

    const W = 1080, PAD = 56, GAP = 28;
    const PW = (W - PAD * 2 - GAP) / 2;      // 470
    const PH = Math.round(PW * 1.25);        // 4:5
    const HEAD = 210, FOOT = 104;
    const H = HEAD + PH * 2 + GAP + FOOT;

    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, W, H);

    // Intestazione
    let tx = PAD;
    if (icon) {
        ctx.save();
        roundedRect(ctx, PAD, 60, 100, 100, 26);
        ctx.clip();
        ctx.drawImage(icon, PAD, 60, 100, 100);
        ctx.restore();
        tx = PAD + 128;
    }
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#4B2E1E';
    ctx.font = `700 58px ${FONT_STACK}`;
    ctx.fillText('Fodus Baffo', tx, 112);
    ctx.fillStyle = '#7C6B60';
    ctx.font = `500 32px ${FONT_STACK}`;
    ctx.fillText(`${name}, dal giorno ${picks[0].dayNum} al giorno ${picks[3].dayNum}`, tx, 158);

    // Griglia 2x2
    picks.forEach((p, i) => {
        const x = PAD + (i % 2) * (PW + GAP);
        const y = HEAD + Math.floor(i / 2) * (PH + GAP);

        ctx.save();
        roundedRect(ctx, x, y, PW, PH, 36);
        ctx.clip();
        ctx.fillStyle = '#F4F1EE';
        ctx.fillRect(x, y, PW, PH);
        drawCover(ctx, imgs[i], x, y, PW, PH);
        ctx.restore();

        // Etichetta "Giorno N"
        const label = `Giorno ${p.dayNum}`;
        ctx.font = `700 40px ${FONT_STACK}`;
        const pillW = ctx.measureText(label).width + 56;
        const pillH = 72;
        const px = x + 22, py = y + PH - 22 - pillH;
        ctx.fillStyle = 'rgba(42, 26, 18, 0.9)';
        roundedRect(ctx, px, py, pillW, pillH, pillH / 2);
        ctx.fill();
        ctx.fillStyle = '#FFFFFF';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, px + 28, py + pillH / 2 + 2);
        ctx.textBaseline = 'alphabetic';
    });

    // Piè di pagina
    ctx.fillStyle = '#7C6B60';
    ctx.font = `500 30px ${FONT_STACK}`;
    ctx.textAlign = 'center';
    ctx.fillText('baffo.fodus.it', W / 2, H - 44);
    ctx.textAlign = 'left';

    return new Promise((resolve, reject) => {
        canvas.toBlob(b => b ? resolve(b) : reject(new Error('blob')), 'image/jpeg', 0.92);
    });
}

let recapMine = null;
let recapMode = 'recap';
let recapToken = 0;

function recapShow(which, msg) {
    $('recap-loading').classList.toggle('hidden', which !== 'loading');
    $('recap-message').classList.toggle('hidden', which !== 'message');
    $('recap-ready').classList.toggle('hidden', which !== 'ready');
    $('compare-ready').classList.toggle('hidden', which !== 'compare');
    if (msg) $('recap-message-text').textContent = msg;
}

/* ---------- Confronto "prima e oggi" ---------- */
function setComparePos(p) {
    p = Math.max(0, Math.min(100, p));
    $('cmp-before').style.clipPath = `inset(0 ${100 - p}% 0 0)`;
    $('cmp-line').style.left = p + '%';
    $('cmp-handle').style.left = p + '%';
}
function buildCompare(mine) {
    const a = mine[0], b = mine[mine.length - 1];
    $('cmp-before').src = a.url;
    $('cmp-after').src = b.url;
    $('cmp-tag-l').textContent = `Giorno ${a.dayNum}`;
    $('cmp-tag-r').textContent = `Giorno ${b.dayNum}`;
    setComparePos(50);
}
(function initCompareDrag() {
    const box = $('compare');
    let dragging = false;
    const move = (e) => {
        const r = box.getBoundingClientRect();
        setComparePos(((e.clientX - r.left) / r.width) * 100);
    };
    box.addEventListener('pointerdown', (e) => { dragging = true; box.setPointerCapture(e.pointerId); move(e); });
    box.addEventListener('pointermove', (e) => { if (dragging) move(e); });
    ['pointerup', 'pointercancel'].forEach(ev => box.addEventListener(ev, () => { dragging = false; }));
})();

/* ---------- Modale: Recap | Prima e oggi ---------- */
async function setRecapMode(mode) {
    recapMode = mode;
    document.querySelectorAll('.seg-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
    const token = ++recapToken;

    if (mode === 'compare') return recapShow('compare');

    if (recapMine.length < 4) {
        return recapShow('message', `Il recap si sblocca con 4 foto: ne hai ${recapMine.length}. Nel frattempo prova "Prima e oggi".`);
    }
    if (!recapBlob) {
        recapShow('loading');
        try {
            const blob = await renderRecapImage(pickRecapPhotos(recapMine), myName());
            if (token !== recapToken) return; // nel frattempo hai cambiato scheda
            recapBlob = blob;
            recapObjectUrl = URL.createObjectURL(blob);
            $('recap-img').src = recapObjectUrl;
        } catch (err) {
            console.error('Recap:', err);
            if (token === recapToken) recapShow('message', 'Non riesco a creare il recap. Riprova tra poco.');
            return;
        }
    }
    recapShow('ready');
}
document.querySelectorAll('.seg-btn').forEach(b => b.addEventListener('click', () => {
    if (recapMine) setRecapMode(b.dataset.mode);
}));

async function openRecap() {
    recapShow('loading');
    $('recap-seg').classList.add('hidden');
    openLayer($('recap-modal'));
    if (recapObjectUrl) { URL.revokeObjectURL(recapObjectUrl); recapObjectUrl = null; }
    recapBlob = null;
    recapMine = null;

    try {
        if (!calendarData) {
            const res = await fetch('/api/calendar');
            if (!res.ok) throw new Error('calendar');
            calendarData = await res.json();
        }
        const me = myName();
        const mine = [];
        challengeDays(calendarData).forEach(d => {
            const p = (d.info.photos || []).find(ph => ph.author_name === me);
            if (p) mine.push({ dayNum: d.dayNum, url: p.url });
        });

        if (mine.length < 2) {
            return recapShow('message', `Servono almeno 2 tue foto per il recap e il confronto: ne hai ${mine.length}.`);
        }

        recapMine = mine;
        buildCompare(mine);
        $('recap-seg').classList.remove('hidden');
        setRecapMode(mine.length >= 4 ? 'recap' : 'compare');
    } catch (err) {
        console.error('Recap:', err);
        recapShow('message', 'Non riesco a caricare le tue foto. Riprova tra poco.');
    }
}

$('btn-recap').addEventListener('click', openRecap);
$('recap-close').addEventListener('click', () => closeLayer($('recap-modal')));

// Il tap su "Salva" apre subito il menu di condivisione (serve un gesto diretto su iOS)
$('btn-recap-save').addEventListener('click', async () => {
    if (!recapBlob) return;
    const file = new File([recapBlob], 'fodus-baffo-recap.jpg', { type: 'image/jpeg' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try {
            await navigator.share({ files: [file], title: 'Recap Fodus Baffo' });
        } catch (err) {
            if (err.name !== 'AbortError') toast("Non riesco ad aprire la condivisione: tieni premuta l'immagine per salvarla.", 4500);
        }
    } else {
        const a = document.createElement('a');
        a.href = recapObjectUrl;
        a.download = file.name;
        document.body.appendChild(a);
        a.click();
        a.remove();
        toast("Tieni premuta l'immagine per salvarla in galleria.", 4500);
    }
});

/* =========================================================
   AVVIO
   Se c'è il PIN salvato e uno stato di oggi in cache, la home
   compare subito (già con countdown); poi si aggiorna dal server.
   Altrimenti resta la splash: il login non lampeggia più.
   ========================================================= */
(function boot() {
    const cached = localStorage.getItem(PIN_KEY) ? loadCache() : null;
    if (cached && cached.user && cached.user.soprannome) {
        currentUser = cached.user;
        lastStatus = cached;
        renderHome(cached);
        showView('view-home');
    }
    checkStatus({ stay: !!cached });
})();