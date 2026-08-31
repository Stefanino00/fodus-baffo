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

@app.route('/api/status', methods=['GET'])
def get_status():
    user_id = session.get('user_id')
    if not user_id:
        return jsonify({'error': 'Non autorizzato'}), 401
    
    user = User.query.get(user_id)
    settings = Settings.query.first()
    today = datetime.utcnow().date()
    
    # Foto dell'utente di oggi
    has_photo_today = Photo.query.filter_by(user_id=user.id, date_created=today).first() is not None
    
    # Ultima foto scattata dall'utente per la sovraimpressione (ghost)
    last_photo = Photo.query.filter_by(user_id=user.id).order_by(Photo.id.desc()).first()
    ghost_url = f"/static/uploads/{last_photo.filename}" if last_photo else None

    return jsonify({
        'user': {
            'id': user.id,
            'nome': user.nome,
            'soprannome': user.soprannome,
            'is_admin': user.is_admin
        },
        'sfida_iniziata': settings.sfida_iniziata if settings else False,
        'has_photo_today': has_photo_today,
        'ghost_url': ghost_url
    })

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

@app.route('/api/feed', methods=['GET'])
def get_feed():
    today = datetime.utcnow().date()
    photos = Photo.query.filter_by(date_created=today).order_by(Photo.timestamp.desc()).all()
    
    feed_data = []
    for p in photos:
        comments = [{
            'id': c.id,
            'word': c.word,
            'author': c.author.soprannome or c.author.nome
        } for c in p.comments]
        
        feed_data.append({
            'photo_id': p.id,
            'author_name': p.author.soprannome or p.author.nome,
            'url': f"/static/uploads/{p.filename}",
            'time': p.timestamp.strftime('%H:%M'),
            'comments': comments
        })
    return jsonify(feed_data)

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
