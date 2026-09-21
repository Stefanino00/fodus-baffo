import json
from app import app, VAPID_PRIVATE_KEY, VAPID_CLAIMS
from models import User
from pywebpush import webpush

with app.app_context():
    print("Cerco il profilo di Stefano...")
    stefano = User.query.filter_by(nome="Stefano Ferrari").first()
    
    if stefano and stefano.push_subscription:
        print("Iscrizione trovata! Invio notifica push in corso...")
        try:
            webpush(
                subscription_info=json.loads(stefano.push_subscription),
                data="🚀 Test Fodus Baffo: se leggi questo, le notifiche funzionano alla perfezione!",
                vapid_private_key=VAPID_PRIVATE_KEY,
                vapid_claims=VAPID_CLAIMS
            )
            print("✅ Inviata senza errori! Il telefono dovrebbe aver appena vibrato.")
        except Exception as e:
            print(f"❌ Errore durante l'invio webpush: {e}")
    else:
        print("❌ Permesso notifiche non trovato per Stefano nel database.")
