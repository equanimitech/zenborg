"""Body <-> Screen: does physiology (Garmin) track digital dynamism (macOS daemon)?

n=1 time-series study over ~/.zenborg/log/*.jsonl. Run: python3 analysis.py
Writes out/{hourly,fivemin,daily}.csv, out/results.json, out/results.md, out/fig_*.png.

Data facts learned while building (do not "fix" without re-checking against Garmin MCP):
- body_sampled.ts marks the END of the sampled hour: true window = [ts-1h, ts). Verified
  against get_stress_data on 2026-07-20 (Paris) and 2026-09-01 (UTC-3). The `hour` field is
  inconsistent across sync batches; ts is the canonical key. Same ts => identical values.
- Mac + watch ran on Europe/Paris until 2026-08-17, then UTC-3 through 2026-09-08 (inferred
  from daily-file rollover boundaries; matches Garmin startTimestampGMT/Local).
- Garmin returns nothing before 2026-06-25 (device first worn), so no MCP backfill is possible.
- browser tab_activated has {domain, tab} but no tab-count; H5 uses distinct tabs touched/hour.
"""
from __future__ import annotations

import glob
import json
import os
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import numpy as np
import pandas as pd
import statsmodels.formula.api as smf
from scipy import stats

LOG = os.path.expanduser("~/.zenborg/log")
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "out")
os.makedirs(OUT, exist_ok=True)

PARIS = ZoneInfo("Europe/Paris")
BRT = timezone(timedelta(hours=-3))
TZ_SWITCH_MS = int(datetime(2026, 8, 17, 12, tzinfo=timezone.utc).timestamp() * 1000)
H = 3_600_000
FIVE = 300_000
PHASES = {"NIGHT": (3, 7), "MORNING": (7, 13), "AFTERNOON": (13, 19), "EVENING": (19, 27)}  # from phaseConfigs.json


def local(ts_ms: int) -> datetime:
    return datetime.fromtimestamp(ts_ms / 1000, PARIS if ts_ms < TZ_SWITCH_MS else BRT)


def phase_of(hour: int) -> str:
    h = hour + 24 if hour < 3 else hour
    return next(p for p, (a, b) in PHASES.items() if a <= h < b)


def load(surface: str) -> list[dict]:
    out = []
    for f in sorted(glob.glob(f"{LOG}/*.{surface}.jsonl")):
        for line in open(f):
            try:
                out.append(json.loads(line))
            except json.JSONDecodeError:
                pass
    return out


def entropy(counts) -> float:
    c = np.asarray(counts, float)
    t = c.sum()
    if t <= 0:
        return np.nan
    p = c[c > 0] / t
    return float(-(p * np.log2(p)).sum())


# ---------- extract ----------
desk, brow, garm = load("desktop"), load("browser"), load("garmin")

app = pd.DataFrame([{"ts": e["ts"]} for e in desk if e["kind"] == "app_switched"])
tabs = pd.DataFrame([{"ts": e["ts"], "tab": e["payload"].get("tab"), "domain": e["payload"].get("domain")}
                     for e in brow if e["kind"] == "tab_activated"])
inp = pd.DataFrame([{"ts": e["ts"], **{k: sum(e["payload"][k]) for k in ("keyDowns", "mouseDowns", "mouseMoves", "scrolls")}}
                    for e in desk if e["kind"] == "input_activity"])
inp["entropy"] = [entropy(r) for r in inp[["keyDowns", "mouseDowns", "mouseMoves", "scrolls"]].values]
inp["total"] = inp[["keyDowns", "mouseDowns", "mouseMoves", "scrolls"]].sum(axis=1)
idle = [(e["ts"] - e["durationMs"], e["ts"]) for e in desk if e["kind"] == "idle_end" and e.get("durationMs")]

# garmin: dedupe body_sampled by ts (keep most-filled), shift window back one hour
best: dict[int, tuple[int, dict]] = {}
for e in garm:
    if e["kind"] != "body_sampled":
        continue
    p = e["payload"]
    filled = sum(v is not None for v in (p.get("stress") or [])) + sum(v is not None for v in (p.get("bodyBattery") or []))
    if e["ts"] not in best or filled > best[e["ts"]][0]:
        best[e["ts"]] = (filled, p)
bins = []
for ts, (_, p) in best.items():
    start = ts - H
    for i in range(12):
        s = (p.get("stress") or [None] * 12)[i]
        b = (p.get("bodyBattery") or [None] * 12)[i]
        bins.append({"ts": start + i * FIVE, "stress": s if s is not None and s >= 0 else np.nan, "bb": b})
bio5 = pd.DataFrame(bins).sort_values("ts")

workouts = [(e["ts"], e["ts"] + e.get("durationMs", 0)) for e in garm if e["kind"] == "workout_completed"]
workouts += [(e["ts"], e["ts"] + e.get("durationMs", 0)) for e in garm
             if e["kind"] == "body_battery_changed" and e["payload"].get("eventType") == "ACTIVITY"]

readiness: dict[str, dict] = {}
for e in garm:
    if e["kind"] == "readiness_recorded" and e["payload"].get("hrvLastNightMs"):
        cur = readiness.setdefault(e["payload"]["calendarDate"], {})
        for k, v in e["payload"].items():
            if v is not None and (k not in cur or cur[k] in (None, 0, "NONE")):
                cur[k] = v
sleep = {e["payload"]["calendarDate"]: e["payload"] for e in garm if e["kind"] == "sleep_recorded"}


# ---------- hourly grid ----------
def hour_key(ts):
    return (ts // H) * H


rows: dict[int, dict] = defaultdict(dict)
for k, g in app.groupby(hour_key(app.ts)):
    rows[k]["app_switches"] = len(g)
for k, g in tabs.groupby(hour_key(tabs.ts)):
    rows[k].update(tab_switches=len(g), tabs_touched=g.tab.nunique(), domains=g.domain.nunique())
for k, g in inp.groupby(hour_key(inp.ts)):
    rows[k].update(n_input_bins=len(g), keys=g.keyDowns.sum(), clicks=g.mouseDowns.sum(), moves=g.mouseMoves.sum(),
                   scrolls=g.scrolls.sum(), entropy_mean=g.entropy.mean(), move_rate=g.mouseMoves.mean() / 30)
for k, g in bio5.groupby(hour_key(bio5.ts)):
    s, b = g.stress.dropna(), g.bb.dropna()
    rows[k].update(stress_mean=s.mean() if len(s) else np.nan, stress_n=len(s), stress_max=s.max() if len(s) else np.nan,
                   bb_first=b.iloc[0] if len(b) else np.nan, bb_last=b.iloc[-1] if len(b) else np.nan)

hourly = pd.DataFrame.from_dict(rows, orient="index").sort_index()
hourly.index.name = "hour_utc"
for c in ("app_switches", "tab_switches", "tabs_touched", "domains", "n_input_bins", "keys", "clicks", "moves", "scrolls"):
    hourly[c] = hourly[c].fillna(0) if c in hourly else 0
for c in ("stress_mean", "stress_n", "bb_first", "bb_last", "entropy_mean", "move_rate"):
    if c not in hourly:
        hourly[c] = np.nan
hourly["stress_n"] = hourly.stress_n.fillna(0)
hourly["bb_delta"] = hourly.bb_last - hourly.bb_first


def overlap_min(spans, k):
    return sum(max(0, min(b, k + H) - max(a, k)) for a, b in spans) / 60_000


digital_hours = set(hour_key(app.ts)) | set(hour_key(inp.ts))
hourly["present"] = hourly.index.isin(digital_hours)
hourly["idle_min"] = [overlap_min(idle, k) for k in hourly.index]
hourly["active_min"] = np.where(hourly.present, (60 - hourly.idle_min).clip(0, 60), np.nan)
hourly["workout"] = [overlap_min(workouts, k) > 0 for k in hourly.index]
loc = [local(k) for k in hourly.index]
hourly["local"] = [d.strftime("%Y-%m-%d %H:%M") for d in loc]
hourly["date"] = [d.strftime("%Y-%m-%d") for d in loc]
hourly["hour"] = [d.hour for d in loc]
hourly["dow"] = [d.weekday() for d in loc]
hourly["weekend"] = hourly.dow >= 5
hourly["phase"] = hourly.hour.map(phase_of)
hourly["dynamism"] = hourly.app_switches + hourly.tab_switches
hourly["dyn_rate"] = hourly.dynamism / hourly.active_min.replace(0, np.nan)
hourly.to_csv(f"{OUT}/hourly.csv")

# analysis subset: at the computer, stress observed, no workout
A = hourly[(hourly.active_min >= 10) & (hourly.stress_n >= 6) & ~hourly.workout].copy()

# ---------- 5-min grid (H3) ----------
inp["k5"] = hour_key(inp.ts) + ((inp.ts % H) // FIVE) * FIVE
five = inp.groupby("k5").agg(entropy=("entropy", "mean"), total=("total", "sum"), n=("entropy", "size")).reset_index()
five = five.merge(bio5.rename(columns={"ts": "k5"}), on="k5", how="inner").dropna(subset=["stress", "entropy"])
five["workout"] = [overlap_min(workouts, k) > 0 for k in five.k5]  # 1h look-ahead window: coarse but conservative
five = five[~five.workout]
five.to_csv(f"{OUT}/fivemin.csv", index=False)

# ---------- daily (H2) ----------
day = hourly[hourly.present].groupby("date").agg(
    dynamism=("dynamism", "sum"), app_switches=("app_switches", "sum"), tab_switches=("tab_switches", "sum"),
    active_min=("active_min", "sum"), hours_present=("present", "sum"), stress_day=("stress_mean", "mean"),
    entropy=("entropy_mean", "mean"), dow=("dow", "first"), weekend=("weekend", "first"), workouts=("workout", "sum"),
).reset_index()
day["dyn_per_hour"] = day.dynamism / (day.active_min / 60)
for c in ("hrvLastNightMs", "hrvWeeklyMs", "hrvBalancedLowMs", "hrvBalancedUpperMs", "hrvStatus", "score"):
    day[c] = day.date.map(lambda d: readiness.get(d, {}).get(c))
for c in ("hrvLastNightMs", "hrvWeeklyMs", "hrvBalancedLowMs", "hrvBalancedUpperMs", "score"):
    day[c] = pd.to_numeric(day[c])
day["hrv_norm"] = (day.hrvLastNightMs - day.hrvBalancedLowMs) / (day.hrvBalancedUpperMs - day.hrvBalancedLowMs)
day["hrv_vs_weekly"] = day.hrvLastNightMs - day.hrvWeeklyMs
day["sleepScore"] = pd.to_numeric(day.date.map(lambda d: sleep.get(d, {}).get("sleepScore")))
day["avgSleepStress"] = pd.to_numeric(day.date.map(lambda d: sleep.get(d, {}).get("avgSleepStress")))
nxt = {d: (datetime.fromisoformat(d) + timedelta(days=1)).strftime("%Y-%m-%d") for d in day.date}
day["hrv_next_night"] = pd.to_numeric(day.date.map(lambda d: readiness.get(nxt[d], {}).get("hrvLastNightMs")))  # placebo
day.to_csv(f"{OUT}/daily.csv", index=False)

# ---------- stats helpers ----------
R: dict[str, dict] = {}


def corr(x, y):
    m = pd.notna(x) & pd.notna(y)
    x, y = np.asarray(x, float)[m], np.asarray(y, float)[m]
    if m.sum() < 5:
        return {"n": int(m.sum())}
    pr, pp = stats.pearsonr(x, y)
    sr, sp = stats.spearmanr(x, y)
    return {"n": int(m.sum()), "pearson_r": round(pr, 3), "pearson_p": float(f"{pp:.2g}"),
            "spearman_rho": round(sr, 3), "spearman_p": float(f"{sp:.2g}")}


def resid(df, col, controls="C(hour) + C(dow)"):
    return smf.ols(f"{col} ~ {controls}", data=df).fit().resid


def z(s):
    return (s - s.mean()) / s.std()


def coef(m, name):
    return {"beta": round(m.params[name], 3), "p": float(f"{m.pvalues[name]:.2g}")}


# ---------- H2 first: overnight HRV -> next-day dynamism ----------
D = day.dropna(subset=["hrvLastNightMs", "dynamism"]).copy()
D = D[D.active_min >= 60]  # at least an hour at the computer
D["z_hrv"], D["z_dyn"], D["z_rate"] = z(D.hrvLastNightMs), z(D.dynamism), z(D.dyn_per_hour)
D["wk"] = D.weekend.astype(int)
Ds = D.dropna(subset=["sleepScore"])
m_raw = smf.ols("z_dyn ~ z_hrv + wk", data=D).fit()
m_ctl = smf.ols("z_dyn ~ z_hrv + wk + sleepScore", data=Ds).fit()
m_rate = smf.ols("z_rate ~ z_hrv + wk + sleepScore", data=Ds).fit()
Dn = D.dropna(subset=["hrv_norm"])
m_norm = smf.ols("z_dyn ~ hrv_norm + wk", data=Dn).fit() if len(Dn) > 8 else None
R["H2"] = {
    "n_days": len(D),
    "hrv_raw_vs_total_dynamism": corr(D.hrvLastNightMs, D.dynamism),
    "hrv_raw_vs_dyn_per_active_hour": corr(D.hrvLastNightMs, D.dyn_per_hour),
    "hrv_norm_vs_total_dynamism": corr(Dn.hrv_norm, Dn.dynamism),
    "hrv_vs_weekly_vs_total": corr(D.hrv_vs_weekly, D.dynamism),
    "ols_total~hrv+weekend": {**coef(m_raw, "z_hrv"), "r2": round(m_raw.rsquared, 3)},
    "ols_total~hrv+weekend+sleep": {"n": int(m_ctl.nobs), **coef(m_ctl, "z_hrv"), "sleep": coef(m_ctl, "sleepScore"), "r2": round(m_ctl.rsquared, 3)},
    "ols_rate~hrv+weekend+sleep": {**coef(m_rate, "z_hrv"), "r2": round(m_rate.rsquared, 3)},
    "ols_total~hrv_norm+weekend": None if m_norm is None else {"n": int(m_norm.nobs), **coef(m_norm, "hrv_norm")},
    "placebo_next_night_hrv_vs_today_dynamism": corr(D.hrv_next_night, D.dynamism),
    "hrv_vs_daytime_stress": corr(D.hrvLastNightMs, D.stress_day),
}

# ---------- H1: stress ~ switching within the hour ----------
A["r_stress"], A["r_rate"] = resid(A, "stress_mean"), resid(A, "dyn_rate")
hac = smf.ols("stress_mean ~ dyn_rate + C(hour) + C(dow)", data=A).fit(cov_type="HAC", cov_kwds={"maxlags": 3})
xc = {}
for lag in (-2, -1, 0, 1, 2):
    sh = A[["dyn_rate", "date"]].copy()
    sh["k"] = sh.index + lag * H
    j = sh.join(A[["stress_mean", "date"]].rename(columns={"stress_mean": "stress_lag", "date": "d2"}), on="k", how="inner")
    j = j[j.date == j.d2]
    if len(j) > 20:
        xc[f"stress(t{lag:+d}) vs dyn_rate(t)"] = corr(j.stress_lag, j.dyn_rate)
R["H1"] = {
    "n_hours": len(A),
    "stress_vs_dyn_rate": corr(A.stress_mean, A.dyn_rate),
    "stress_vs_app_switches": corr(A.stress_mean, A.app_switches),
    "stress_vs_tab_switches": corr(A.stress_mean, A.tab_switches),
    "stress_vs_move_rate": corr(A.stress_mean, A.move_rate),
    "partial_hour_dow": corr(A.r_stress, A.r_rate),
    "ols_hac_stress_per_switch_per_min": coef(hac, "dyn_rate"),
    "cross_correlation_same_day": xc,
}


def granger(df, y, x, maxlag):
    d = df[[y, x, "date"]].copy()
    for L in range(1, maxlag + 1):
        sh = df[[y, x, "date"]].copy()
        sh.index = sh.index + L * H
        d = d.join(sh.rename(columns={y: f"{y}_l{L}", x: f"{x}_l{L}", "date": f"d{L}"}))
    for L in range(1, maxlag + 1):
        d = d[d.date == d[f"d{L}"]]
    d = d.dropna()
    if len(d) < 30:
        return {"n": len(d)}
    yl = " + ".join(f"{y}_l{L}" for L in range(1, maxlag + 1))
    xl = " + ".join(f"{x}_l{L}" for L in range(1, maxlag + 1))
    m0, m1 = smf.ols(f"{y} ~ {yl}", d).fit(), smf.ols(f"{y} ~ {yl} + {xl}", d).fit()
    F, p, _ = m1.compare_f_test(m0)
    return {"n": len(d), "F": round(float(F), 2), "p": float(f"{p:.2g}")}


R["H1_granger"] = {f"lag{L}": {"stress->dyn_rate": granger(A, "dyn_rate", "stress_mean", L),
                              "dyn_rate->stress": granger(A, "stress_mean", "dyn_rate", L)} for L in (1, 2, 3)}

# ---------- H3: input entropy ~ stress (5-min) ----------
F5 = five[five.total > 0].copy()
F5["r_ent"], F5["r_tot"], F5["r_str"] = stats.rankdata(F5.entropy), stats.rankdata(F5.total), stats.rankdata(F5.stress)
re_, rs_ = smf.ols("r_ent ~ r_tot", F5).fit().resid, smf.ols("r_str ~ r_tot", F5).fit().resid
R["H3"] = {"n_5min_bins": len(F5), "entropy_vs_stress": corr(F5.entropy, F5.stress),
           "partial_spearman_ctrl_total_input": {"rho": round(float(np.corrcoef(re_, rs_)[0, 1]), 3)},
           "total_input_vs_stress": corr(F5.total, F5.stress), "entropy_vs_total_input": corr(F5.entropy, F5.total)}

# ---------- H4: body battery drain ~ dynamism ----------
B = A.dropna(subset=["bb_delta"]).copy()
R["H4"] = {"n_hours": len(B), "bb_delta_vs_dyn_rate": corr(B.bb_delta, B.dyn_rate),
           "partial_hour_dow": corr(resid(B, "bb_delta"), resid(B, "dyn_rate")),
           "partial_hour_dow_stress": corr(resid(B, "bb_delta", "C(hour) + C(dow) + stress_mean"), resid(B, "dyn_rate", "C(hour) + C(dow) + stress_mean")),
           "bb_delta_vs_stress": corr(B.bb_delta, B.stress_mean)}

# ---------- H5: tab accumulation vs switching as predictors of stress ----------
for c in ("tabs_touched", "domains", "tab_switches", "app_switches", "dyn_rate"):
    A[f"z_{c}"] = z(A[c])


def fit(pred):
    m = smf.ols(f"stress_mean ~ {pred} + C(hour) + C(dow)", A).fit(cov_type="HAC", cov_kwds={"maxlags": 3})
    return {"beta_std": {k: round(v, 3) for k, v in m.params.items() if k.startswith("z_")},
            "p": {k: float(f"{v:.2g}") for k, v in m.pvalues.items() if k.startswith("z_")},
            "r2": round(m.rsquared, 4), "aic": round(m.aic, 1)}


R["H5"] = {"tabs_touched": fit("z_tabs_touched"), "domains": fit("z_domains"), "tab_switches": fit("z_tab_switches"),
           "app_switches": fit("z_app_switches"), "dyn_rate": fit("z_dyn_rate"), "both": fit("z_tabs_touched + z_tab_switches"),
           "controls_only_r2": round(smf.ols("stress_mean ~ C(hour) + C(dow)", A).fit().rsquared, 4)}

# ---------- H6: circadian ----------
per = {}
for ph, g in A.groupby("phase"):
    if len(g) >= 15:
        per[ph] = {**corr(g.stress_mean, g.dyn_rate), "stress_mean": round(g.stress_mean.mean(), 1), "dyn_rate_mean": round(g.dyn_rate.mean(), 2)}
m_add = smf.ols("stress_mean ~ dyn_rate + C(phase) + C(dow)", A).fit()
m_int = smf.ols("stress_mean ~ dyn_rate * C(phase) + C(dow)", A).fit()
Fi, pi, _ = m_int.compare_f_test(m_add)
R["H6"] = {"per_phase": per, "interaction_F": round(float(Fi), 2), "interaction_p": float(f"{pi:.2g}"),
           "slopes": {k: round(v, 3) for k, v in m_int.params.items() if "dyn_rate" in k}}

A2 = hourly[(hourly.active_min >= 5) & (hourly.stress_n >= 3) & ~hourly.workout]  # looser filters
R["H1_robustness_loose_filters"] = {"n_hours": len(A2), "stress_vs_dyn_rate": corr(A2.stress_mean, A2.dyn_rate),
                                    "stress_vs_app_switches": corr(A2.stress_mean, A2.app_switches),
                                    "stress_vs_tab_switches": corr(A2.stress_mean, A2.tab_switches)}

R["_coverage"] = {
    "digital_days": int(hourly.present.groupby(hourly.date).any().sum()),
    "bio_days": int(hourly.stress_n.gt(0).groupby(hourly.date).any().sum()),
    "hours_analysed_H1": len(A), "days_H2": len(D), "fivemin_bins_H3": len(F5),
    "first_bio": hourly[hourly.stress_n > 0].date.min(), "last": hourly.date.max(),
    "bonferroni_alpha_6": round(0.05 / 6, 4),
}
json.dump(R, open(f"{OUT}/results.json", "w"), indent=2, default=str)

# ---------- figures ----------
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt


def scatter(x, y, xl, yl, name, title):
    fig, ax = plt.subplots(figsize=(5, 4), dpi=110)
    ax.scatter(x, y, s=12, alpha=0.5, color="#57534e")
    m = pd.notna(x) & pd.notna(y)
    if m.sum() > 3:
        b, a = np.polyfit(x[m], y[m], 1)
        xs = np.linspace(x[m].min(), x[m].max(), 50)
        ax.plot(xs, a + b * xs, color="#292524", lw=1.2)
    ax.set_xlabel(xl); ax.set_ylabel(yl); ax.set_title(title, fontsize=10); ax.spines[["top", "right"]].set_visible(False)
    fig.tight_layout(); fig.savefig(f"{OUT}/{name}.png"); plt.close(fig)


scatter(D.hrvLastNightMs, D.dynamism, "overnight HRV (ms)", "switches that day", "fig_h2", "H2: overnight HRV vs next-day dynamism")
scatter(A.dyn_rate, A.stress_mean, "switches / active minute", "mean stress (hour)", "fig_h1", "H1: hourly switching vs stress")
scatter(F5.entropy, F5.stress, "input entropy (bits, 5-min)", "stress (5-min)", "fig_h3", "H3: input entropy vs stress")
scatter(B.dyn_rate, B.bb_delta, "switches / active minute", "body battery delta (hour)", "fig_h4", "H4: switching vs body-battery drain")
fig, ax = plt.subplots(figsize=(5, 4), dpi=110)
for ph, g in A.groupby("phase"):
    ax.scatter(g.dyn_rate, g.stress_mean, s=10, alpha=0.5, label=f"{ph} (n={len(g)})")
ax.set_xlabel("switches / active minute"); ax.set_ylabel("mean stress"); ax.set_title("H6: by phase", fontsize=10)
ax.legend(fontsize=7); ax.spines[["top", "right"]].set_visible(False)
fig.tight_layout(); fig.savefig(f"{OUT}/fig_h6.png"); plt.close(fig)

with open(f"{OUT}/results.md", "w") as f:
    f.write("# Body <-> Screen results\n\n```json\n" + json.dumps(R, indent=2, default=str) + "\n```\n")
print(json.dumps(R, indent=2, default=str))
