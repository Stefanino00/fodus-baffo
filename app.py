
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
from dotenv import load_dotenv
load_dotenv()

app = Flask(__name__)
app.secret_key = 'fodus_baffo_super_secret_key_2026'

VAPID_PUBLIC_KEY = "BCdWDfFOUdE48sgpzDCkzR99SHBDr6fbzdRyKFdYp3ZGJAXRrsB0xz4huC5Hceh9yqANvz3-CgdPgnsPAPgnsPAJr5fn0"
VAPID_PRIVATE_KEY = "mWmuS_jdca1L_gwvPQX-sT_skpWpwLSYfNleLngOMYw"
VAPID_CLAIMS = {"sub": "mailto:ferrasteferra@gmail.com"}

BASE_DIR = os.path.abspath(os.path.dirname(__file__))
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
            with open(file_path, "rb") as image_file:
                base64_image = base64.b64encode(image_file.read()).decode('utf-8')
            
            api_key = os.environ.get("OPENROUTER_API_KEY")
            
            oggi = datetime.utcnow().date()
            inizio = date(2026, 9, 1)
            giorni_passati = max(1, (oggi - inizio).days + 1)
            tetto_massimo = min(100, int((giorni_passati / 115) * 100) + 15)
            
            prompt_dinamico = f"""Sei il giudice di una gara di baffi. Oggi è il giorno {giorni_passati} su 115.
Il voto globale va da 0 a 100, ma essendo all'inizio, il limite MASSIMO consentito oggi è {tetto_massimo}. 

Devi valutare la LUNGHEZZA reale del pelo, non farti ingannare dall'ombra scura sulla pelle.
Usa questa scala per decidere il voto di questa foto:
- Da 0 a 3: Rasato o pelo impercettibile.
- Da 4 a 9: Semplice ombra o barbetta molto corta.
- Da 10 a 18: Baffo in chiara formazione, pelo visibilmente cresciuto.
- Da 19 a {tetto_massimo}: Baffo definito, la crescita migliore possibile per questa fase della gara.

Osserva attentamente la lunghezza, differenzia i candidati e decidi il numero esatto. Restituisci ESCLUSIVAMENTE un numero intero. Non aggiungere alcun testo o punteggiatura."""

            headers = {
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json"
            }
            
            payload = {
                "model": "openai/gpt-4o-mini",
                "messages": [
                    {"role": "system", "content": prompt_dinamico},
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
            score_number = int(digits) if digits else 0
            
            photo = Photo.query.get(photo_id)
            if photo:
                photo.ai_score = min(max(score_number, 0), 100)
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

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5040, debug=True)
