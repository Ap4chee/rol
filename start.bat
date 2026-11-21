@echo off
rem Uruchomienie aplikacji na Windows: tworzy srodowisko, instaluje zaleznosci, startuje serwer.
rem Te same kroki recznie sa opisane w README.md.
setlocal
cd /d "%~dp0"

set "PY=python"
where py >nul 2>nul && set "PY=py -3.12"

if not exist ".venv\Scripts\python.exe" (
  echo [1/3] Tworze srodowisko Pythona w folderze .venv ...
  %PY% -m venv .venv || goto :error
)

echo [2/3] Instaluje zaleznosci. Pierwsze uruchomienie trwa kilka minut ...
".venv\Scripts\python.exe" -m pip install --disable-pip-version-check -q -r requirements.txt || goto :error

echo [3/3] Uruchamiam serwer. Aplikacja: http://127.0.0.1:8000
echo       Zamkniecie tego okna albo Ctrl+C zatrzymuje aplikacje.
start "" /min cmd /c "timeout /t 4 /nobreak >nul & start http://127.0.0.1:8000"
".venv\Scripts\python.exe" -m uvicorn app.main:app --host 127.0.0.1 --port 8000
goto :eof

:error
echo.
echo Nie udalo sie przygotowac srodowiska.
echo Wymagany jest Python 3.12: https://www.python.org/downloads/
pause
exit /b 1
