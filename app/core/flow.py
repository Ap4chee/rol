"""Spływ powierzchniowy z numerycznego modelu terenu: wypełnianie zagłębień, kierunki D8, powierzchnia zasilająca.

Algorytm:
1. Priority-Flood z epsilonem (Barnes, Lehman, Mulla 2014, Computers & Geosciences 62): zagłębienia bezodpływowe
   są wypełniane do poziomu przelewu, a płaskie dna dostają znikomy spadek, żeby każda komórka miała odpływ.
2. Kierunek D8: woda z komórki płynie do tego z ośmiu sąsiadów, do którego spadek jest największy.
3. Powierzchnia zasilająca: liczba komórek, z których woda dopływa do danej komórki, razy pole komórki.

To wynik czysto topograficzny. Nie uwzględnia opadu, wsiąkania, drenów, przepustów ani rowów,
a powierzchnia zasilająca nie jest objętością wody. Czyste funkcje na tablicach numpy, bez sieci.
"""
from __future__ import annotations

import heapq
import math
from dataclasses import dataclass

import numpy as np

# sąsiedzi D8: (przesunięcie wiersza, przesunięcie kolumny, odległość w komórkach)
NEIGHBOURS = ((-1, -1, math.sqrt(2)), (-1, 0, 1.0), (-1, 1, math.sqrt(2)), (0, -1, 1.0),
              (0, 1, 1.0), (1, -1, math.sqrt(2)), (1, 0, 1.0), (1, 1, math.sqrt(2)))


def priority_flood_fill(dem: np.ndarray) -> np.ndarray:
    """Model terenu z wypełnionymi zagłębieniami (float64). Każda komórka ma drogę odpływu do brzegu tablicy."""
    rows, cols = dem.shape
    filled = np.where(np.isfinite(dem), dem, np.nanmax(dem)).astype(float).ravel().tolist()
    closed = bytearray(rows * cols)
    heap: list[tuple[float, int]] = []
    for r in range(rows):
        for c in ((0, cols - 1) if 0 < r < rows - 1 else range(cols)):
            i = r * cols + c
            if not closed[i]:
                closed[i] = 1
                heap.append((filled[i], i))
    heapq.heapify(heap)
    push, pop, nextafter, inf = heapq.heappush, heapq.heappop, math.nextafter, math.inf
    offsets = [(dr, dc) for dr, dc, _ in NEIGHBOURS]
    while heap:
        z, i = pop(heap)
        r, c = divmod(i, cols)
        for dr, dc in offsets:
            rr, cc = r + dr, c + dc
            if 0 <= rr < rows and 0 <= cc < cols:
                j = rr * cols + cc
                if closed[j]:
                    continue
                closed[j] = 1
                zj = filled[j]
                if zj <= z:               # zagłębienie albo płaskie dno: podnosimy tuż ponad poziom odpływu
                    zj = nextafter(z, inf)
                    filled[j] = zj
                push(heap, (zj, j))
    return np.array(filled).reshape(rows, cols)


def d8_receivers(filled: np.ndarray) -> np.ndarray:
    """Dla każdej komórki indeks (spłaszczony) komórki, do której płynie woda; −1 = odpływ poza tablicę."""
    rows, cols = filled.shape
    padded = np.pad(filled, 1, constant_values=np.inf)
    best_drop = np.zeros((rows, cols))
    receiver = np.full((rows, cols), -1, dtype=np.int64)
    index = np.arange(rows * cols).reshape(rows, cols)
    for dr, dc, dist in NEIGHBOURS:
        neighbour = padded[1 + dr:1 + dr + rows, 1 + dc:1 + dc + cols]
        drop = (filled - neighbour) / dist
        better = drop > best_drop
        best_drop = np.where(better, drop, best_drop)
        receiver = np.where(better, index + dr * cols + dc, receiver)
    return receiver.ravel()


def flow_accumulation(filled: np.ndarray, receivers: np.ndarray) -> np.ndarray:
    """Liczba komórek zasilających każdą komórkę (razem z nią samą), kształt jak `filled`."""
    order = np.argsort(-filled.ravel(), kind="stable").tolist()
    acc = [1] * filled.size
    recv = receivers.tolist()
    for i in order:
        j = recv[i]
        if j >= 0:
            acc[j] += acc[i]
    return np.array(acc, dtype=np.int64).reshape(filled.shape)


def box_mean(values: np.ndarray, size: int) -> np.ndarray:
    """Średnia ruchoma w oknie size × size (brzegi przez powielenie skrajnych komórek)."""
    half = size // 2
    padded = np.pad(values.astype(float), half, mode="edge")
    integral = np.pad(np.cumsum(np.cumsum(padded, axis=0), axis=1), ((1, 0), (1, 0)))
    rows, cols = values.shape
    total = (integral[size:size + rows, size:size + cols] - integral[:rows, size:size + cols]
             - integral[size:size + rows, :cols] + integral[:rows, :cols])
    return total / (size * size)


def slope_percent(dem: np.ndarray, cell_m: float, smooth_m: float = 5.0) -> np.ndarray:
    """Spadek terenu w procentach, liczony po wygładzeniu oknem ok. 5 m (bruzdy i koleiny nie są spadkiem pola)."""
    size = max(int(round(smooth_m / cell_m)) | 1, 1)
    smooth = box_mean(dem, size) if size > 1 else dem.astype(float)
    gy, gx = np.gradient(smooth, cell_m)
    return 100.0 * np.hypot(gx, gy)


@dataclass
class Crossing:
    kind: str          # inflow = woda wpływa na działkę, outflow = wypływa
    row: float         # położenie na granicy w układzie tablicy (ułamkowe: środek między komórkami)
    col: float
    area_m2: float     # powierzchnia zasilająca punkt


@dataclass
class FlowResult:
    filled: np.ndarray
    accumulation: np.ndarray           # liczba komórek
    lines: list[tuple[list[tuple[int, int]], float]]   # (łamana jako lista (wiersz, kolumna), powierzchnia na końcu w m2)
    crossings: list[Crossing]
    cell_area_m2: float


def trace_lines(accumulation: np.ndarray, receivers: np.ndarray, threshold_cells: int) -> list[list[int]]:
    """Drogi spływu powyżej progu jako łamane (listy spłaszczonych indeksów), od źródeł w dół do zbiegu lub brzegu."""
    acc = accumulation.ravel()
    channel = acc >= threshold_cells
    donors = np.zeros(acc.size, dtype=np.int32)
    idx = np.nonzero(channel)[0]
    targets = receivers[idx]
    valid = targets >= 0
    np.add.at(donors, targets[valid], channel[idx[valid]].astype(np.int32))
    heads = [int(i) for i in idx if donors[i] == 0]
    heads.sort(key=lambda i: -int(acc[i]))
    visited = np.zeros(acc.size, dtype=bool)
    recv = receivers.tolist()
    lines: list[list[int]] = []
    for head in heads:
        line = [head]
        visited[head] = True
        current = recv[head]
        while current >= 0:
            line.append(current)
            if visited[current]:
                break
            visited[current] = True
            current = recv[current]
        if len(line) >= 2:
            lines.append(line)
    return lines


def find_crossings(accumulation: np.ndarray, receivers: np.ndarray, inside: np.ndarray, threshold_cells: int,
                   cell_m: float, merge_distance_m: float = 15.0) -> list[Crossing]:
    """Punkty, w których droga spływu powyżej progu przecina granicę działki.

    Blisko położone punkty tego samego rodzaju (droga biegnąca wzdłuż granicy) są łączone w jeden,
    z największą powierzchnią zasilającą. Powierzchni punktów nie wolno sumować.
    """
    rows, cols = accumulation.shape
    acc = accumulation.ravel()
    ins = inside.ravel()
    idx = np.nonzero(acc >= threshold_cells)[0]
    targets = receivers[idx]
    valid = targets >= 0
    idx, targets = idx[valid], targets[valid]
    change = ins[idx] != ins[targets]
    found: list[Crossing] = []
    for i, j in zip(idx[change].tolist(), targets[change].tolist()):
        r1, c1 = divmod(i, cols)
        r2, c2 = divmod(j, cols)
        found.append(Crossing("outflow" if ins[i] else "inflow", (r1 + r2) / 2.0, (c1 + c2) / 2.0,
                              float(acc[i]) * cell_m * cell_m))
    found.sort(key=lambda p: -p.area_m2)
    kept: list[Crossing] = []
    limit = merge_distance_m / cell_m
    for point in found:
        if all(k.kind != point.kind or math.hypot(k.row - point.row, k.col - point.col) > limit for k in kept):
            kept.append(point)
    return kept


def analyse(dem: np.ndarray, inside: np.ndarray, cell_m: float, threshold_m2: float) -> FlowResult:
    """Pełna analiza spływu dla wycinka modelu terenu.

    dem          – wysokości [m], wiersz 0 na północy
    inside       – maska komórek, których środki leżą w działce
    cell_m       – bok komórki [m]
    threshold_m2 – próg powierzchni zasilającej, powyżej którego pokazujemy drogę spływu
    """
    filled = priority_flood_fill(dem)
    receivers = d8_receivers(filled)
    accumulation = flow_accumulation(filled, receivers)
    threshold_cells = max(int(round(threshold_m2 / (cell_m * cell_m))), 1)
    cols = dem.shape[1]
    acc_flat = accumulation.ravel()
    lines = [([divmod(i, cols) for i in line], float(acc_flat[line[-1]]) * cell_m * cell_m)
             for line in trace_lines(accumulation, receivers, threshold_cells)]
    crossings = find_crossings(accumulation, receivers, inside, threshold_cells, cell_m)
    return FlowResult(filled, accumulation, lines, crossings, cell_m * cell_m)
