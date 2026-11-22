"""Porównanie: sieć GRU (PyTorch, GPU) z tymi samymi danymi i podziałami co train.py.

Wejście sieci: przebieg dzienny z 60 dni przed t (opad, ET0, Tmax, wyczerpanie wiadra referencyjnego)
oraz te same cechy tabelaryczne co model drzewiasty. Wyjście: kwantyle 0,1 / 0,5 / 0,9 ΔNDMI (strata pinball).
To eksperyment porównawczy: do aplikacji trafia model, który wypada lepiej na odłożonych skupiskach
i sezonie; GRU wymagałoby dodania PyTorch do zależności aplikacji.
Wynik: metrics_gru.json w podanym katalogu przebiegu (albo w RUNS_DIR/gru_<czas>).
"""
from __future__ import annotations

import json
import sys
import time
from datetime import UTC, date, datetime

import numpy as np
import pandas as pd
import torch
from torch import nn

from . import config as C
from .dataset import weather_by_cluster
from .features import FEATURES

SEQ_DAYS = 60
QUANTILES = (0.1, 0.5, 0.9)
VAL_CLUSTERS = 3
EPOCHS = 60
PATIENCE = 8
BATCH = 1024


def sequences(df: pd.DataFrame) -> np.ndarray:
    weather = weather_by_cluster()
    out = np.zeros((len(df), SEQ_DAYS, 4), dtype=np.float32)
    for i, (cluster, t) in enumerate(zip(df["spatial_group"], df["issue_date"])):
        ws = weather[cluster]
        end = ws.idx(date.fromisoformat(t))  # dni do t-1 włącznie
        sl = slice(end - SEQ_DAYS, end)
        out[i, :, 0] = ws.rain[sl]
        out[i, :, 1] = ws.et0[sl]
        out[i, :, 2] = ws.tmax[sl]
        out[i, :, 3] = ws.depl[sl]
    return np.nan_to_num(out)


class Net(nn.Module):
    def __init__(self, n_static: int, hidden: int = 64):
        super().__init__()
        self.gru = nn.GRU(4, hidden, batch_first=True)
        self.static = nn.Sequential(nn.Linear(n_static, 128), nn.ReLU(), nn.Dropout(0.1), nn.Linear(128, 64), nn.ReLU())
        self.head = nn.Sequential(nn.Linear(hidden + 64, 64), nn.ReLU(), nn.Linear(64, len(QUANTILES)))

    def forward(self, seq, stat):
        _, h = self.gru(seq)
        return self.head(torch.cat([h[-1], self.static(stat)], dim=1))


def pinball(pred, y):
    q = torch.tensor(QUANTILES, device=pred.device)
    e = y.unsqueeze(1) - pred
    return torch.mean(torch.maximum(q * e, (q - 1) * e))


def main(argv: list[str]) -> None:
    dev = "cuda" if torch.cuda.is_available() else "cpu"
    df = pd.read_parquet(C.DATA_DIR / "training.parquet")
    seq = sequences(df)
    stat_raw = df[FEATURES].to_numpy(np.float32)
    missing = np.isnan(stat_raw).astype(np.float32)
    y = df["ndmi_delta"].to_numpy(np.float32)

    is_test_space = df["spatial_group"].isin(C.TEST_CLUSTERS).to_numpy()
    is_test_time = (df["season"] == C.TEST_SEASON).to_numpy()
    train_mask = ~is_test_space & ~is_test_time
    train_clusters = sorted(df.loc[train_mask, "spatial_group"].unique())
    rng = np.random.default_rng(C.RANDOM_SEED)
    val_clusters = set(rng.choice(train_clusters, size=VAL_CLUSTERS, replace=False))
    is_val = train_mask & df["spatial_group"].isin(val_clusters).to_numpy()
    is_fit = train_mask & ~is_val

    # Standaryzacja na zbiorze uczącym; braki -> 0 plus flaga braku.
    mu = np.nanmean(stat_raw[is_fit], axis=0)
    sd = np.nanstd(stat_raw[is_fit], axis=0) + 1e-6
    stat = np.concatenate([np.nan_to_num((stat_raw - mu) / sd), missing], axis=1).astype(np.float32)
    smu = seq[is_fit].reshape(-1, 4).mean(0)
    ssd = seq[is_fit].reshape(-1, 4).std(0) + 1e-6
    seq = ((seq - smu) / ssd).astype(np.float32)

    def tensors(mask):
        return (torch.tensor(seq[mask], device=dev), torch.tensor(stat[mask], device=dev), torch.tensor(y[mask], device=dev))

    fit_t, val_t = tensors(is_fit), tensors(is_val)

    def train_one(hidden: int, lr: float, seed: int):
        torch.manual_seed(seed)
        net = Net(stat.shape[1], hidden).to(dev)
        opt = torch.optim.AdamW(net.parameters(), lr=lr, weight_decay=1e-4)
        best, best_state, bad = 1e9, None, 0
        for _epoch in range(EPOCHS):
            net.train()
            perm = torch.randperm(len(fit_t[2]), device=dev)
            for i in range(0, len(perm), BATCH):
                b = perm[i:i + BATCH]
                opt.zero_grad()
                pinball(net(fit_t[0][b], fit_t[1][b]), fit_t[2][b]).backward()
                opt.step()
            net.eval()
            with torch.no_grad():
                val_mae = torch.mean(torch.abs(net(val_t[0], val_t[1])[:, 1] - val_t[2])).item()
            if val_mae < best - 1e-5:
                best, bad = val_mae, 0
                best_state = {k: v.detach().clone() for k, v in net.state_dict().items()}
            else:
                bad += 1
                if bad >= PATIENCE:
                    break
        net.load_state_dict(best_state)
        return net.eval(), best

    # Przegląd wariantów (wybór po MAE na skupiskach walidacyjnych), potem zespół 5 ziaren najlepszego wariantu.
    t0 = time.time()
    sweep = []
    for hidden in (32, 64, 128):
        for lr in (1e-3, 3e-3):
            _, v = train_one(hidden, lr, C.RANDOM_SEED)
            sweep.append({"hidden": hidden, "lr": lr, "val_mae": v})
            print(sweep[-1], flush=True)
    cfg = min(sweep, key=lambda r: r["val_mae"])
    nets = [train_one(cfg["hidden"], cfg["lr"], C.RANDOM_SEED + k)[0] for k in range(5)]
    best = cfg["val_mae"]

    def ensemble(s, st):
        with torch.no_grad():
            return torch.stack([n(s, st) for n in nets]).mean(0)

    tests = {"space": is_test_space & ~is_test_time, "time": ~is_test_space & is_test_time,
             "space_and_time": is_test_space & is_test_time}
    metrics = {"device": torch.cuda.get_device_name(0) if dev == "cuda" else "cpu", "train_s": round(time.time() - t0, 1),
               "val_clusters": sorted(val_clusters), "best_val_mae": best, "sweep": sweep, "chosen": cfg,
               "ensemble_size": len(nets), "torch": torch.__version__, "tests": {}}
    for name, mask in tests.items():
        if not mask.any():
            continue
        s, st, yy = tensors(mask)
        p = ensemble(s, st).cpu().numpy()
        yy = yy.cpu().numpy()
        lo, hi = np.minimum(p[:, 0], p[:, 2]), np.maximum(p[:, 0], p[:, 2])
        metrics["tests"][name] = {"rows": int(mask.sum()), "gru_mae_rows": float(np.mean(np.abs(p[:, 1] - yy))),
                                  "zero_mae_rows": float(np.mean(np.abs(yy))),
                                  "interval_80_coverage_raw": float(np.mean((yy >= lo) & (yy <= hi)))}
    run = C.RUNS_DIR / (argv[0] if argv else "gru_" + datetime.now(UTC).strftime("%Y%m%d_%H%M"))
    run.mkdir(parents=True, exist_ok=True)
    (run / "metrics_gru.json").write_text(json.dumps(metrics, indent=2))
    print(json.dumps(metrics, indent=2))


if __name__ == "__main__":
    main(sys.argv[1:])
