
import os
import base64
import json
import threading
import atexit
from datetime import datetime, date, timedelta
from flask import Flask, render_template, request, jsonify, session, send_from_directory
from pywebpush import webpush, WebPushException
from apscheduler.schedulers.background import BackgroundScheduler
from models import db, User, Photo, Comment, Settings
import threading
import requests
import base64
from google import genai
import PIL.Image
import os
from dotenv import load_dotenv
load_dotenv()

app = Flask(__name__)
app.secret_key = 'fodus_baffo_super_secret_key_2026'
BASE_DIR = os.path.abspath(os.path.dirname(__file__))
VAPID_PUBLIC_KEY = "BFR1mDVfW2DBRV4hZenFgMHm-GgVv3A09Z9f9SmSExZZuL6smbWy-mlk-vmZ3IiibKdnrmEka95XIcTUDchqvng"
VAPID_PRIVATE_KEY = os.path.join(BASE_DIR, "private_key.pem")
VAPID_CLAIMS = {"sub": "mailto:ferrasteferra@gmail.com"}


app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///' + os.path.join(BASE_DIR, 'baffo.db')
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
UPLOAD_FOLDER = os.path.join(BASE_DIR, 'static', 'uploads')
app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER

db.init_app(app)

def seed_users():
    if User.query.count() == 0:
        utenti = [
            User(nome="Stefano Ferrari", pin="1305", is_admin=True),
            User(nome="Federico Marchina", pin="2567"),
            User(nome="Michele Dester", pin="1327"),
            User(nome="Luca Rossi", pin="2006"),
        ]
        db.session.bulk_save_objects(utenti)
        db.session.add(Settings(sfida_iniziata=False))
        db.session.commit()

with app.app_context():
    db.create_all()
    seed_users()

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/sw.js')
def serve_sw():
    return send_from_directory(os.path.join(BASE_DIR, 'static', 'js'), 'sw.js', mimetype='application/javascript')

@app.route('/api/login', methods=['POST'])
def login():
    data = request.json or {}
    pin = data.get('pin')
    user = User.query.filter_by(pin=pin).first()
    if not user:
        return jsonify({'error': 'PIN errato'}), 401
    session['user_id'] = user.id
    return jsonify({'id': user.id, 'nome': user.nome, 'soprannome': user.soprannome, 'is_admin': user.is_admin})

@app.route('/api/set-soprannome', methods=['POST'])
def set_soprannome():
    user_id = session.get('user_id')
    if not user_id:
        return jsonify({'error': 'Non autorizzato'}), 401
    data = request.json or {}
    soprannome = data.get('soprannome', '').strip()
    if not soprannome:
        return jsonify({'error': 'Soprannome vuoto'}), 400
    user = User.query.get(user_id)
    user.soprannome = soprannome
    db.session.commit()
    return jsonify({'success': True, 'soprannome': user.soprannome})

@app.route('/api/admin/start-challenge', methods=['POST'])
def start_challenge():
    user_id = session.get('user_id')
    user = User.query.get(user_id) if user_id else None
    if not user or not user.is_admin:
        return jsonify({'error': 'Solo l\'admin può sbloccare la sfida'}), 403
    settings = Settings.query.first()
    settings.sfida_iniziata = True
    db.session.commit()
    return jsonify({'success': True})

@app.route('/api/subscribe', methods=['POST'])
def subscribe():
    user_id = session.get('user_id')
    if not user_id:
        return jsonify({'error': 'Non autorizzato'}), 401
    sub_info = request.json
    user = User.query.get(user_id)
    user.push_subscription = json.dumps(sub_info)
    db.session.commit()
    return jsonify({'success': True})

@app.route('/api/upload-photo', methods=['POST'])
def upload_photo():
    user_id = session.get('user_id')
    if not user_id:
        return jsonify({'error': 'Non autorizzato'}), 401
    data = request.json or {}
    image_data = data.get('image')
    if not image_data:
        return jsonify({'error': 'Immagine mancante'}), 400
    today = datetime.utcnow().date()
    existing = Photo.query.filter_by(user_id=user_id, date_created=today).first()
    if existing:
        return jsonify({'error': 'Hai già inviato la foto oggi'}), 400
    header, encoded = image_data.split(",", 1)
    file_bytes = base64.b64decode(encoded)
    filename = f"user_{user_id}_{today.strftime('%Y%m%d_%H%M%S')}.webp"
    file_path = os.path.join(app.config['UPLOAD_FOLDER'], filename)
    with open(file_path, "wb") as f:
        f.write(file_bytes)
    photo = Photo(user_id=user_id, filename=filename, date_created=today)
    db.session.add(photo)
    db.session.commit()
    app_context = app.app_context()
    thread = threading.Thread(target=analyze_photo_background, args=(photo.id, file_path, app_context))
    thread.start()
    return jsonify({'success': True})

@app.route('/api/status', methods=['GET'])
def get_status():
    user_id = session.get('user_id')
    if not user_id:
        return jsonify({'error': 'Non autorizzato'}), 401
    
    user = User.query.get(user_id)
    settings = Settings.query.first()
    today = datetime.utcnow().date()
    
    total_users = User.query.count()
    today_photos = Photo.query.filter_by(date_created=today).all()
    photos_today_count = len(today_photos)
    
    user_ids_with_photo = [p.user_id for p in today_photos]
    has_photo_today = user.id in user_ids_with_photo
    
    # Aggiunta proattiva: Utenti che mancano all'appello oggi
    missing_users_db = User.query.filter(User.id.notin_(user_ids_with_photo)).all()
    missing_users = []
    for u in missing_users_db:
        parts = u.nome.split()
        iniziali = "".join([p[0] for p in parts[:2]]).upper()
        missing_users.append({'id': u.id, 'iniziali': iniziali, 'nome': u.nome})
        
    last_photo = Photo.query.filter_by(user_id=user.id).order_by(Photo.id.desc()).first()
    ghost_url = f"/static/uploads/{last_photo.filename}" if last_photo else None

    start_date = date(2026, 9, 1)
    end_date = date(2026, 12, 24)
    total_days = (end_date - start_date).days + 1
    days_passed = (today - start_date).days + 1
    days_remaining = (end_date - today).days

    # --- NUOVO: CALCOLO CLASSIFICA CRESCITA ---
    all_users = User.query.all()
    growth_ranking = []
    
    for u in all_users:
        # Prende l'ultimissima foto dell'utente
        last_p = Photo.query.filter_by(user_id=u.id).order_by(Photo.timestamp.desc()).first()
        
        # Se c'è la foto ma il voto è vuoto (None), il barbiere sta lavorando
        is_processing = True if (last_p and last_p.ai_score is None) else False
        score = last_p.ai_score if (last_p and last_p.ai_score is not None) else 0
        
        parts = u.nome.split()
        iniziali = "".join([p[0] for p in parts[:2]]).upper()
        
        growth_ranking.append({
            'id': u.id,
            'nome': u.soprannome or u.nome,
            'iniziali': iniziali,
            'score': score,
            'is_processing': is_processing
        })
        
    # Ordina la classifica dal voto più alto al più basso
    growth_ranking.sort(key=lambda x: x['score'], reverse=True)
    # ------------------------------------------

    return jsonify({
        'user': {
            'id': user.id,
            'nome': user.nome,
            'soprannome': user.soprannome,
            'is_admin': user.is_admin
        },
        'sfida_iniziata': settings.sfida_iniziata if settings else False,
        'has_photo_today': has_photo_today,
        'ghost_url': ghost_url,
        'stats': {
            'total_users': total_users,
            'photos_today': photos_today_count,
            'days_passed': max(0, days_passed),
            'total_days': total_days,
            'days_remaining': max(0, days_remaining),
            'missing_users': missing_users,
            'growth_ranking': growth_ranking
        }
    })

@app.route('/api/comment', methods=['POST'])
def add_comment():
    user_id = session.get('user_id')
    if not user_id:
        return jsonify({'error': 'Non autorizzato'}), 401
    
    data = request.json or {}
    photo_id = data.get('photo_id')
    word = data.get('word', '').strip()
    
    if ' ' in word or len(word) > 20 or not word:
        return jsonify({'error': 'Il commento deve essere una sola parola (max 20 lettere)'}), 400
        
    photo = Photo.query.get(photo_id)
    if not photo:
        return jsonify({'error': 'Foto non trovata'}), 404
        
    # REGOLA 1: Non puoi commentare la tua foto
    if photo.user_id == user_id:
        return jsonify({'error': 'Non puoi commentare la tua foto!'}), 403
        
    # REGOLA 2: Solo un commento per utente su ogni foto
    existing = Comment.query.filter_by(photo_id=photo_id, user_id=user_id).first()
    if existing:
        return jsonify({'error': 'Hai già commentato questa foto!'}), 403
        
    comment = Comment(photo_id=photo_id, user_id=user_id, word=word)
    db.session.add(comment)
    db.session.commit()
    
    # Restituiamo il nome per aggiornare il popup in tempo reale
    author_name = User.query.get(user_id).soprannome or User.query.get(user_id).nome
    return jsonify({'success': True, 'word': word, 'author_name': author_name})

def analyze_photo_background(photo_id, file_path, app_context):
    with app_context:
        try:
            import requests, base64, os
            from datetime import datetime, date
            from models import db, Photo
            
            with open(file_path, "rb") as image_file:
                base64_image = base64.b64encode(image_file.read()).decode('utf-8')
            
            api_key = os.environ.get("OPENROUTER_API_KEY")
            
            prompt_visivo = """Sei un barbiere esperto. Valuta la densità e la lunghezza di questo baffo.
Scala assoluta da 0 a 10:
0 = Completamente rasato.
1-2 = Leggera ombra o peluria.
3-4 = Baffo corto, in fase iniziale di crescita.
5-7 = Baffo ben definito e visibile.
8-10 = Baffo folto, lungo e maturo.
Non farti ingannare dal contrasto della pelle: valuta la LUNGHEZZA dei peli sul labbro superiore.
Restituisci ESCLUSIVAMENTE un numero intero da 0 a 10. Niente testo."""

            headers = {
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json"
            }
            
            payload = {
                "model": "openai/gpt-4o-mini",
                "messages": [
                    {"role": "system", "content": prompt_visivo},
                    {"role": "user", "content": [{"type": "image_url", "image_url": {"url": f"data:image/webp;base64,{base64_image}"}}]}
                ],
                "temperature": 0.0,
                "max_tokens": 5
            }
            
            response = requests.post("https://openrouter.ai/api/v1/chat/completions", headers=headers, json=payload)
            result = response.json()
            
            if 'error' in result:
                print(f"🛑 Errore OpenRouter: {result['error']}")
                return
            if 'choices' not in result:
                print(f"🛑 Risposta anomala: {result}")
                return
            
            score_text = result['choices'][0]['message']['content'].strip()
            digits = ''.join(filter(str.isdigit, score_text))
            base_score = min(max(int(digits) if digits else 0, 0), 10)
            
            oggi = datetime.utcnow().date()
            inizio = date(2026, 9, 1)
            giorni_passati = max(1, (oggi - inizio).days + 1)
            
            tetto_massimo = min(100, int((giorni_passati / 115) * 100) + 15)
            score_finale = int((base_score / 10.0) * tetto_massimo)
            
            photo = Photo.query.get(photo_id)
            if photo:
                photo.ai_score = min(max(score_finale, 0), 100)
                db.session.commit()
                
        except Exception as e:
            print(f"Errore analisi AI per foto {photo_id}: {e}")

@app.route('/api/calendar', methods=['GET'])
def get_calendar():
    start_date = date(2026, 9, 1)
    end_date = date(2026, 12, 24)
    today = datetime.now().date() # <-- Ora usa now()
    
    photos = Photo.query.filter(Photo.date_created >= start_date, Photo.date_created <= end_date).order_by(Photo.timestamp.asc()).all()
    photos_by_date = {}
    
    for p in photos:
        key = p.date_created.isoformat()
        
        # Recupera i commenti per questa foto
        comments = Comment.query.filter_by(photo_id=p.id).all()
        comments_list = [{'word': c.word, 'author_name': User.query.get(c.user_id).soprannome or User.query.get(c.user_id).nome} for c in comments]
        
        photos_by_date.setdefault(key, []).append({
            'photo_id': p.id,
            'author_name': p.author.soprannome or p.author.nome,
            'url': f"/static/uploads/{p.filename}",
            'time': p.timestamp.strftime('%H:%M'),
            'comments': comments_list
        })
        
    days = {}
    current = start_date
    while current <= end_date:
        key = current.isoformat()
        day_photos = photos_by_date.get(key, [])
        days[key] = {'count': len(day_photos), 'photos': day_photos}
        current += timedelta(days=1)
        
    return jsonify({'start_date': start_date.isoformat(), 'end_date': end_date.isoformat(), 'today': today.isoformat(), 'days': days})
# AUTOMAZIONE NOTIFICHE
def check_and_send_notifications(time_slot):
    with app.app_context():
        today = datetime.utcnow().date()
        users = User.query.all()
        messages = {
            '12': "🥸 Ricordati la foto del baffo! Hai tempo fino a stasera.",
            '19': "🚨 LA FOTO DEL BAFFO! Dai entra e scattala!",
            '22': "⚠️ MANDA LA FOTO DEL BAFFO! Ultima chiamata prima di mezzanotte! 🤬"
        }
        testo_notifica = messages.get(time_slot, "È ora di fare la foto!")
        for user in users:
            if not user.push_subscription:
                continue
            has_photo = Photo.query.filter_by(user_id=user.id, date_created=today).first()
            if not has_photo:
                try:
                    webpush(
                        subscription_info=json.loads(user.push_subscription),
                        data=testo_notifica,
                        vapid_private_key=VAPID_PRIVATE_KEY,
                        vapid_claims=VAPID_CLAIMS
                    )
                except Exception as ex:
                    print(f"Errore invio notifica a {user.nome}: {ex}")

scheduler = BackgroundScheduler(timezone="Europe/Rome")
scheduler.add_job(func=check_and_send_notifications, trigger="cron", hour=12, minute=0, args=['12'])
scheduler.add_job(func=check_and_send_notifications, trigger="cron", hour=19, minute=0, args=['19'])
scheduler.add_job(func=check_and_send_notifications, trigger="cron", hour=22, minute=0, args=['22'])
scheduler.start()
atexit.register(lambda: scheduler.shutdown())

from collections import Counter
try:
    from zoneinfo import ZoneInfo
except ImportError:
    ZoneInfo = None

@app.route('/api/stats', methods=['GET'])
def get_stats():
    user_id = session.get('user_id')
    if not user_id:
        return jsonify({'error': 'Non autorizzato'}), 401

    start_date = date(2026, 9, 1)
    end_date = date(2026, 12, 24)
    today = datetime.utcnow().date()
    last_eval_date = min(today, end_date)

    users = User.query.all()
    total_users = len(users)
    user_map = {u.id: (u.soprannome or u.nome) for u in users}

    photos = Photo.query.filter(
        Photo.date_created >= start_date,
        Photo.date_created <= last_eval_date
    ).order_by(Photo.timestamp.asc()).all()

    photos_by_date = {}
    photos_by_user = {u.id: [] for u in users}
    for p in photos:
        d_key = p.date_created.isoformat()
        photos_by_date.setdefault(d_key, []).append(p)
        if p.user_id in photos_by_user:
            photos_by_user[p.user_id].append(p)

    perfect_days = 0
    total_days_elapsed = max(0, (last_eval_date - start_date).days + 1)

    for d_key, day_photos in photos_by_date.items():
        if len(day_photos) >= total_users and total_users > 0:
            perfect_days += 1

    # Finestra 24h a partire dalle 00:02
    def minutes_since_0002(dt):
        mins = dt.hour * 60 + dt.minute + (dt.second / 60.0)
        offset = mins - 2
        if offset < 0:
            offset += 1440
        return offset

    def offset_to_hhmm(offset):
        total_mins = (int(round(offset)) + 2) % 1440
        h = total_mins // 60
        m = total_mins % 60
        return f"{h:02d}:{m:02d}"

    user_stats = []
    earliest_record = None
    latest_record = None

    for u in users:
        u_photos = photos_by_user.get(u.id, [])
        u_dates = set(p.date_created for p in u_photos)
        photos_count = len(u_dates)

        # Giorni passati fino a ieri (oggi non conta come saltato finché è in corso)
        days_to_check_for_miss = max(0, (min(today - timedelta(days=1), end_date) - start_date).days + 1)
        photos_before_today = sum(1 for d in u_dates if d < today)
        missed_days = max(0, days_to_check_for_miss - photos_before_today)

        # Giorni di fila attuali
        temp_streak = 0
        curr_d = start_date
        while curr_d <= last_eval_date:
            if curr_d in u_dates:
                temp_streak += 1
            else:
                if curr_d < today:
                    temp_streak = 0
            curr_d += timedelta(days=1)
        cur_streak = temp_streak

        offsets = []
        for p in u_photos:
            off = minutes_since_0002(p.timestamp)
            offsets.append(off)
            t_str = p.timestamp.strftime('%H:%M')
            if earliest_record is None or off < earliest_record['offset']:
                earliest_record = {'name': user_map[u.id], 'time': t_str, 'offset': off}
            if latest_record is None or off > latest_record['offset']:
                latest_record = {'name': user_map[u.id], 'time': t_str, 'offset': off}

        avg_offset = (sum(offsets) / len(offsets)) if offsets else None
        avg_time_str = offset_to_hhmm(avg_offset) if avg_offset is not None else "--:--"

        parts = u.nome.split()
        iniziali = "".join([p[0] for p in parts[:2]]).upper()

        denom = days_to_check_for_miss + (1 if today in u_dates else 0)
        rate = int(round((photos_count / denom) * 100)) if denom > 0 else 100

        user_stats.append({
            'id': u.id,
            'nome': user_map[u.id],
            'iniziali': iniziali,
            'photos_count': photos_count,
            'missed_days': missed_days,
            'attendance_rate': min(100, rate),
            'current_streak': cur_streak,
            'avg_time': avg_time_str,
            'avg_offset': avg_offset if avg_offset is not None else 9999
        })

    # Ordina classifica: prima chi ha saltato meno giorni, poi chi ha l'orario medio più presto
    user_stats.sort(key=lambda x: (x['missed_days'], x['avg_offset']))

    # --- CALCOLO PEGGIOR RITARDATARIO / ASSENTE (CON GESTIONE PARI MERITO) ---
    import random

    def format_names(names_list):
        if len(names_list) == 1:
            return names_list[0]
        return ", ".join(names_list[:-1]) + " e " + names_list[-1]

    max_misses = max((u['missed_days'] for u in user_stats), default=0)

    if max_misses > 0:
        # Tutti quelli che condividono il record negativo di giorni saltati
        tied_worst = [u for u in user_stats if u['missed_days'] == max_misses]
        names_str = format_names([u['nome'] for u in tied_worst])
        initials_list = [u['iniziali'] for u in tied_worst]
        n = max_misses
        volte_str = "volta" if n == 1 else "volte"
        giorni_str = "giorno" if n == 1 else "giorni"

        if len(tied_worst) == 1:
            insulti = [
                f"{names_str} si è già dimenticato di mandare la foto {n} {volte_str}.",
                f"Qualcuno metta una sveglia a {names_str}: {n} {giorni_str} saltati finora.",
                f"{names_str} ha bucato l'invio {n} {volte_str}. Un solo compito avevi!",
                f"Anche oggi {names_str} recupera domani: {n} foto mancanti all'appello.",
                f"Per {names_str} la sfida è opzionale: già {n} {giorni_str} di buco.",
                f"Chi ha visto {names_str}? Latitante per {n} {giorni_str}.",
                f"{names_str} tratta il calendario come un formaggio svizzero: {n} buchi.",
                f"Premio 'Dopo la faccio' assegnato a {names_str} ({n} assenze).",
                f"A {names_str} pesa il dito: {n} foto non pervenute.",
                f"Meno male che {names_str} doveva essere costante: {n} {giorni_str} saltati.",
                f"Allarme rosso per {names_str}: {n} invii andati nel dimenticatoio.",
                f"{names_str} colleziona assenze come figurine: siamo a quota {n}."
            ]
            tag = "Peggior ritardatario · Assenze"
        elif len(tied_worst) < total_users:
            insulti = [
                f"Pari merito del disonore: {names_str} hanno saltato {n} {giorni_str} a testa.",
                f"{names_str} vanno a braccetto: {n} foto bucate per ciascuno.",
                f"Complotto tra {names_str}: entrambi fermi a {n} {giorni_str} saltati.",
                f"Qualcuno svegli {names_str}: {n} assenze a testa e zero rimorsi.",
                f"{names_str} si coprono a vicenda, ma i {n} buchi in calendario restano.",
                f"Sfida nella sfida tra {names_str} a chi salta più giorni: pari a quota {n}!",
                f"Non sapevamo chi insultare, quindi tocca a {names_str}: {n} foto mancanti a testa.",
                f"Sincronia perfetta nel dimenticarsi la foto: {names_str} a quota {n} assenze.",
                f"{names_str} hanno preso il calendario come un suggerimento: {n} {giorni_str} bucati.",
                f"Il club dei latitanti è guidato da {names_str} con {n} assenze a testa."
            ]
            tag = f"Peggiori a pari merito ({len(tied_worst)}) · Assenze"
        else:
            insulti = [
                f"Disastro totale: avete saltato tutti quanti {n} {giorni_str} a testa!",
                f"Pari merito generale: tutti a quota {n} assenze. Neanche uno che si salvi!",
                f"Complimenti a tutti e {total_users}: {n} {giorni_str} bucati a testa, costanza zero.",
                f"Nessuno può prendere in giro nessuno: avete tutti {n} foto mancanti!"
            ]
            tag = "Disastro collettivo · Tutti a pari merito"

        shame = {
            'iniziali_list': initials_list,
            'tag': tag,
            'insult': random.choice(insulti)
        }

    else:
        # Nessuno ha saltato giorni: guardiamo l'orario medio più lento (arrotondato al minuto per gestire i pari merito veri)
        with_photos = [u for u in user_stats if u['photos_count'] > 0]
        if with_photos:
            max_min = max(int(round(u['avg_offset'])) for u in with_photos)
            tied_slow = [u for u in with_photos if int(round(u['avg_offset'])) == max_min]
            names_str = format_names([u['nome'] for u in tied_slow])
            initials_list = [u['iniziali'] for u in tied_slow]
            avg_t = tied_slow[0]['avg_time']

            if len(tied_slow) == 1:
                insulti_lenti = [
                    f"{names_str} manda la foto in media alle {avg_t}. Sempre all'ultimo minuto.",
                    f"Con una media delle {avg_t}, {names_str} è ufficialmente il più lento del gruppo.",
                    f"Zero giorni saltati, ma {names_str} (media {avg_t}) aspetta sempre la fine della giornata.",
                    f"{names_str} vive sul filo del rasoio: orario medio di invio {avg_t}.",
                    f"Calma olimpica per {names_str}: prima delle {avg_t} di media non se ne parla.",
                    f"Per fortuna la giornata dura 24 ore, altrimenti {names_str} (media {avg_t}) non ce la farebbe mai.",
                    f"Se non arriva la notifica delle 22:00, {names_str} (media {avg_t}) neanche apre l'app.",
                    f"Riflessi da bradipo per {names_str}: scatto medio fissato alle {avg_t}.",
                    f"{names_str} ama il brivido del ritardo: media oraria inchiodata alle {avg_t}.",
                    f"Tutti hanno già fatto, e poi c'è {names_str} che se la prende comoda fino alle {avg_t}."
                ]
                tag = "Peggior ritardatario"
            elif len(tied_slow) < total_users:
                insulti_lenti = [
                    f"Incredibile pari merito: {names_str} hanno la stessa identica media delle {avg_t}!",
                    f"{names_str} aspettano insieme l'ultimo minuto: media delle {avg_t} per entrambi.",
                    f"Coppia da brivido: {names_str} mandano la foto in media alle {avg_t} spaccate.",
                    f"Zero assenze, ma {names_str} condividono il record di lentezza (media {avg_t}).",
                    f"Si mettono d'accordo su WhatsApp? {names_str} sono appaiati in fondo con media {avg_t}."
                ]
                tag = f"Peggiori ritardatari ({len(tied_slow)} a pari merito)"
            else:
                insulti_lenti = [
                    f"Clamoroso: avete tutti esattamente la stessa media oraria ({avg_t})!",
                    f"Sincronia assurda: tutti e {total_users} in perfetto pari merito con media {avg_t}."
                ]
                tag = "Tutti a pari merito"

            shame = {
                'iniziali_list': initials_list,
                'tag': tag,
                'insult': random.choice(insulti_lenti)
            }
        else:
            # Caso limite: giorno 1, ancora 0 foto caricate da chiunque
            shame = {
                'iniziali_list': [u['iniziali'] for u in user_stats],
                'tag': 'Ancora tutti a zero',
                'insult': "Nessuno ha ancora inviato una foto. Vediamo chi sarà il primo a rompere il ghiaccio!"
            }

    with_photos = [u for u in user_stats if u['photos_count'] > 0]
    early_bird = min(with_photos, key=lambda x: x['avg_offset']) if with_photos else None
    night_owl = max(with_photos, key=lambda x: x['avg_offset']) if with_photos else None

    return jsonify({
        'summary': {
            'total_photos': len(photos),
            'perfect_days': perfect_days,
            'total_days_elapsed': total_days_elapsed
        },
        'shame': shame,
        'records': {
            'early_avg': {'nome': early_bird['nome'], 'val': f"Media {early_bird['avg_time']}"} if early_bird else None,
            'late_avg': {'nome': night_owl['nome'], 'val': f"Media {night_owl['avg_time']}"} if night_owl else None,
            'fastest_shot': {'nome': earliest_record['name'], 'val': f"Alle {earliest_record['time']}"} if earliest_record else None,
            'latest_shot': {'nome': latest_record['name'], 'val': f"Alle {latest_record['time']}"} if latest_record else None,
        },
        'leaderboard': user_stats
    })

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5040, debug=True)
