import os
import time
from app import app, analyze_photo_background
from models import db, Photo

if __name__ == '__main__':
    with app.app_context():
        foto_da_analizzare = Photo.query.filter(Photo.ai_score.is_(None)).all()
        print(f"Trovate {len(foto_da_analizzare)} foto da far valutare al barbiere.")

        for foto in foto_da_analizzare:
            percorso = os.path.join(app.config['UPLOAD_FOLDER'], foto.filename)
            if os.path.exists(percorso):
                print(f"Invio foto ID {foto.id} del {foto.date_created} a Gemini...")
                analyze_photo_background(foto.id, percorso, app.app_context())
                print("In attesa 15 secondi per rispettare il limite di 5 richieste/minuto...")
                time.sleep(15)
            else:
                print(f"Attenzione: File mancante per foto ID {foto.id}")

        print("Finito! Vai a controllare la classifica nell'app.")
