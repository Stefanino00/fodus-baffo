from datetime import datetime
from flask_sqlalchemy import SQLAlchemy

db = SQLAlchemy()

class User(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    nome = db.Column(db.String(100), nullable=False)
    pin = db.Column(db.String(10), unique=True, nullable=False)
    soprannome = db.Column(db.String(50), nullable=True)
    is_admin = db.Column(db.Boolean, default=False)
    photos = db.relationship('Photo', backref='author', lazy=True)

class Photo(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    filename = db.Column(db.String(100), nullable=False)
    date_created = db.Column(db.Date, default=datetime.utcnow().date)
    timestamp = db.Column(db.DateTime, default=datetime.utcnow)
    comments = db.relationship('Comment', backref='photo', lazy=True, cascade="all, delete-orphan")

class Comment(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    photo_id = db.Column(db.Integer, db.ForeignKey('photo.id'), nullable=False)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    word = db.Column(db.String(20), nullable=False) # Max 20 caratteri, 1 sola parola
    timestamp = db.Column(db.DateTime, default=datetime.utcnow)
    author = db.relationship('User')

class Settings(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    sfida_iniziata = db.Column(db.Boolean, default=False)
