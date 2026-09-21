from app import app, check_and_send_notifications

with app.app_context():
    print("Innesco manuale delle notifiche push...")
    try:
        check_and_send_notifications("19:00")
        print("✅ Comando eseguito senza errori! I telefoni dovrebbero aver vibrato.")
    except Exception as e:
        print(f"❌ Errore durante l'invio: {e}")
