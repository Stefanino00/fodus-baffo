import os
import base64
from datetime import datetime, date
from flask import Flask, render_template, request, jsonify, session
from models import db, User, Photo, Comment, Settings

app = Flask(__name__)
app.secret_key = 'fodus_baffo_super_secret_key_2026'

# Configurazione SQLite
BASE_DIR = os.path.abspath(os.path.dirname(__file__))
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///' + os.path.join(BASE_DIR, 'baffo.db')
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
UPLOAD_FOLDER = os.path.join(BASE_DIR, 'static', 'uploads')
app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER

db.init_app(app)

# Popolamento iniziale degli utenti
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

from flask import send_from_directory

@app.route('/sw.js')
def serve_sw():
    # Serve il file da static/js ma lo fa apparire come se fosse nella root (/)
    return send_from_directory(os.path.join(BASE_DIR, 'static', 'js'), 'sw.js', mimetype='application/javascript')

@app.route('/api/login', methods=['POST'])
def login():
    data = request.json or {}
    pin = data.get('pin')
    user = User.query.filter_by(pin=pin).first()
    if not user:
        return jsonify({'error': 'PIN errato'}), 401
    
    session['user_id'] = user.id
    return jsonify({
        'id': user.id,
        'nome': user.nome,
        'soprannome': user.soprannome,
        'is_admin': user.is_admin
    })

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

@app.route('/api/upload-photo', methods=['POST'])
def upload_photo():
    user_id = session.get('user_id')
    if not user_id:
        return jsonify({'error': 'Non autorizzato'}), 401
    
    data = request.json or {}
    image_data = data.get('image') # Base64 dal canvas frontend
    if not image_data:
        return jsonify({'error': 'Immagine mancante'}), 400
    
    today = datetime.utcnow().date()
    existing = Photo.query.filter_by(user_id=user_id, date_created=today).first()
    if existing:
        return jsonify({'error': 'Hai già inviato la foto oggi'}), 400
    
    # Salva il Base64 come file WebP
    header, encoded = image_data.split(",", 1)
    file_bytes = base64.b64decode(encoded)
    
    filename = f"user_{user_id}_{today.strftime('%Y%m%d_%H%M%S')}.webp"
    file_path = os.path.join(app.config['UPLOAD_FOLDER'], filename)
    
    with open(file_path, "wb") as f:
        f.write(file_bytes)
        
    photo = Photo(user_id=user_id, filename=filename, date_created=today)
    db.session.add(photo)
    db.session.commit()
    
    return jsonify({'success': True})

@app.route('/api/status', methods=['GET'])
def get_status():
    user_id = session.get('user_id')
    if not user_id:
        return jsonify({'error': 'Non autorizzato'}), 401
    
    user = User.query.get(user_id)
    settings = Settings.query.first()
    today = datetime.utcnow().date()
    
    # Statistiche Home Page
    total_users = User.query.count()
    photos_today_count = Photo.query.filter_by(date_created=today).count()
    has_photo_today = Photo.query.filter_by(user_id=user.id, date_created=today).first() is not None
    
    last_photo = Photo.query.filter_by(user_id=user.id).order_by(Photo.id.desc()).first()
    ghost_url = f"/static/uploads/{last_photo.filename}" if last_photo else None

    # Calcolo Giorni (Dal 1 Settembre al 24 Dicembre sono 115 giorni)
    start_date = date(2026, 9, 1)
    end_date = date(2026, 12, 24)
    total_days = (end_date - start_date).days
    days_passed = (today - start_date).days
    days_remaining = (end_date - today).days

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
            'days_remaining': max(0, days_remaining)
        }
    })

from datetime import timedelta

@app.route('/api/calendar', methods=['GET'])
def get_calendar():
    start_date = date(2026, 9, 1)
    end_date = date(2026, 12, 24)
    today = datetime.utcnow().date()

    photos = Photo.query.filter(
        Photo.date_created >= start_date, Photo.date_created <= end_date
    ).order_by(Photo.timestamp.asc()).all()

    photos_by_date = {}
    for p in photos:
        key = p.date_created.isoformat()
        photos_by_date.setdefault(key, []).append({
            'photo_id': p.id,
            'author_name': p.author.soprannome or p.author.nome,
            'url': f"/static/uploads/{p.filename}",
            'time': p.timestamp.strftime('%H:%M')
        })

    days = {}
    current = start_date
    while current <= end_date:
        key = current.isoformat()
        day_photos = photos_by_date.get(key, [])
        days[key] = {'count': len(day_photos), 'photos': day_photos}
        current += timedelta(days=1)

    return jsonify({
        'start_date': start_date.isoformat(),
        'end_date': end_date.isoformat(),
        'today': today.isoformat(),
        'days': days
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
    
    comment = Comment(photo_id=photo_id, user_id=user_id, word=word)
    db.session.add(comment)
    db.session.commit()
    
    return jsonify({'success': True, 'word': word})

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5040, debug=True)
