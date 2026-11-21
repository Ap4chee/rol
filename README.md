# Zatrzymaj wodę, chroń plony

Prototyp na HackNation 2026 (zadanie KOWR). Rolnik wskazuje działkę ewidencyjną, uprawę i datę, a aplikacja pobiera otwarte dane, liczy bilans wodny i pokazuje raport z uzasadnionymi rekomendacjami.

README jest uzupełniane razem z kodem. Pełny wykaz źródeł, licencji i ograniczeń pojawi się tu przed oddaniem.

## Uruchomienie (Windows)

Wymagany jest Python 3.12 i dostęp do internetu. Nie potrzeba Dockera, bazy danych ani kluczy API.

Najprościej: dwukrotnie kliknij `start.bat`. Skrypt tworzy środowisko, instaluje zależności, startuje serwer i otwiera przeglądarkę na `http://127.0.0.1:8000`.

Te same kroki ręcznie:

```bat
py -3.12 -m venv .venv
.venv\Scripts\python.exe -m pip install -r requirements.txt
.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Potem otwórz `http://127.0.0.1:8000`.

## Testy

Testy obliczeń (ET0, bilans wodny, funkcja pedotransferowa) nie używają sieci:

```bat
.venv\Scripts\python.exe -m pytest -q
```

Raport z wiersza poleceń, na prawdziwych danych:

```bat
.venv\Scripts\python.exe scripts\run_report.py --parcel 060910_2.0011.580/2 --crop winter_wheat
.venv\Scripts\python.exe scripts\run_report.py --point 17.05,52.40 --crop spring_barley --date 2018-07-15
```

## Kontrakt API

Opis w [docs/kontrakt_api.md](docs/kontrakt_api.md), schemat w [app/schemas.py](app/schemas.py), po uruchomieniu także pod `/docs`.
