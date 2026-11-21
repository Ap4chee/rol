# AGENTS.md

## Projekt

KOWR — „Zatrzymaj Wodę, Chroń Plony” (HackNation 2026).
Webowy asystent rolnika: dla działki ewidencyjnej i daty sam pobiera otwarte dane (satelitarne, pogodowe, glebowe), ocenia sytuację wodną i daje uzasadnione rekomendacje retencyjne.

## Praca we dwóch

Nad repo pracują równolegle dwie osoby (każda ze swoim agentem AI). Kod zmienia się cały czas po obu stronach, dlatego:

1. **Przed rozpoczęciem pracy zawsze `git pull --rebase`.** Nie zakładaj, że lokalna kopia jest aktualna.
2. **Po każdej zmianie commit + push.** Każda skończona, działająca zmiana (nawet mała) idzie od razu na `origin`:
   ```sh
   git pull --rebase
   git add <pliki>
   git commit -m "krótki opis zmiany"
   git push
   ```
   Nie zbieraj wielu zmian w jeden duży commit i nie zostawiaj niewypchniętej pracy.
3. **Konflikty rozwiązuj od razu** po `pull --rebase`. Nie nadpisuj cudzych zmian: przeczytaj obie wersje i połącz je. Nigdy `git push --force` na `main`.
4. **Małe, skupione commity.** Jeden commit = jedna rzecz. Opis commita mówi, co się zmieniło.
5. **Nie ruszaj bez potrzeby plików, nad którymi pracuje druga osoba.** Jeśli musisz, zrób to małym commitem i wypchnij od razu, żeby zminimalizować konflikty.
6. **Nie commituj sekretów** (`.env`, klucze API, tokeny). Używaj `.env.example`.

## Gałąź

Pracujemy na `main`. Remote: `https://github.com/Ap4chee/rol.git`.
