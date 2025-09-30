import os, time, sys
import requests
from dotenv import load_dotenv

# .env dosyasını oku
load_dotenv()

API_KEY = os.getenv("POLYGON_API_KEY")
if not API_KEY:
    print("ERROR: POLYGON_API_KEY bulunamadı")
    sys.exit(1)

BASE = "https://api.polygon.io/v3/reference/tickers"

def fetch_all(params):
    out = []
    url = BASE
    headers = {
        "Accept": "application/json",
        "Authorization": f"Bearer {API_KEY}",   # <-- Güvenli yol
    }
    while True:
        r = requests.get(url, params=params, headers=headers, timeout=30)
        if r.status_code == 429:
            time.sleep(2); continue
        r.raise_for_status()
        data = r.json()
        out.extend(data.get("results", []))

        next_url = data.get("next_url")
        if not next_url:
            break
        url = next_url         # sıradaki sayfa
        params = None          # next_url tam URL; ek param gereksiz
        time.sleep(0.15)
    return out
