"""Render out/report.html from out/*.csv + out/results.json (inline SVG scatters, no deps)."""
import json
import os

import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "out")
R = json.load(open(f"{OUT}/results.json"))
h = pd.read_csv(f"{OUT}/hourly.csv")
d = pd.read_csv(f"{OUT}/daily.csv")
f5 = pd.read_csv(f"{OUT}/fivemin.csv")

A = h[(h.active_min >= 10) & (h.stress_n >= 6) & ~h.workout]
D = d.dropna(subset=["hrvLastNightMs"]).query("active_min >= 60")
F5 = f5[f5.total > 0]


def pts(df, x, y, label, extra=None):
    cols = [x, y, label] + (extra or [])
    return [[round(float(r[x]), 3), round(float(r[y]), 2), str(r[label])] + [str(r[e]) for e in (extra or [])]
            for _, r in df[cols].dropna(subset=[x, y]).iterrows()]


data = {
    "h1": pts(A, "dyn_rate", "stress_mean", "local", ["phase"]),
    "h2": pts(D, "hrvLastNightMs", "dynamism", "date"),
    "h3": pts(F5, "entropy", "stress", "k5"),
    "h4": pts(A.dropna(subset=["bb_delta"]), "dyn_rate", "bb_delta", "local"),
}
for p in data["h3"]:
    p[2] = pd.Timestamp(int(float(p[2])), unit="ms", tz="UTC").strftime("%m-%d %H:%M UTC")


def g(*path):
    cur = R
    for k in path:
        cur = cur[k]
    return cur


def p_fmt(p):
    return "&lt; 0.001" if p < 0.001 else f"{p:.3f}" if p < 0.01 else f"{p:.2f}"


c = g("_coverage")
h1, h2, h3, h4, h5, h6, gr = R["H1"], R["H2"], R["H3"], R["H4"], R["H5"], R["H6"], R["H1_granger"]

verdicts = [
    ("H2", "Overnight HRV predicts next-day dynamism", "null",
     f"ρ = {h2['hrv_raw_vs_total_dynamism']['spearman_rho']}", p_fmt(h2["hrv_raw_vs_total_dynamism"]["spearman_p"]), h2["n_days"], "days"),
    ("H1", "Stress tracks switching within the hour", "null",
     f"partial r = {h1['partial_hour_dow']['pearson_r']}", p_fmt(h1["partial_hour_dow"]["pearson_p"]), h1["n_hours"], "hours"),
    ("H3", "Input entropy rises with stress", "null",
     f"ρ = {h3['entropy_vs_stress']['spearman_rho']}", p_fmt(h3["entropy_vs_stress"]["spearman_p"]), h3["n_5min_bins"], "5-min bins"),
    ("H4", "Body battery drains faster under dynamism", "confounded",
     f"r = {h4['bb_delta_vs_dyn_rate']['pearson_r']} raw → {h4['partial_hour_dow']['pearson_r']} partial", p_fmt(h4["partial_hour_dow"]["pearson_p"]), h4["n_hours"], "hours"),
    ("H5", "Tab accumulation beats switching as a stress signal", "inverted",
     f"tabs {h5['tabs_touched']['beta_std']['z_tabs_touched']} vs switches {h5['tab_switches']['beta_std']['z_tab_switches']} stress pts / SD", p_fmt(h5["tab_switches"]["p"]["z_tab_switches"]), h1["n_hours"], "hours"),
    ("H6", "The correlation is circadian", "suggestive",
     f"morning r = {h6['per_phase']['MORNING']['pearson_r']}, afternoon {h6['per_phase']['AFTERNOON']['pearson_r']}", p_fmt(h6["interaction_p"]), h1["n_hours"], "hours"),
]
chip = {"null": "Null", "confounded": "Confounded", "inverted": "Inverted", "suggestive": "Suggestive"}

rows = "".join(
    f'<tr><td class="mono">{k}</td><td>{t}</td><td><span class="chip chip-{v}">{chip[v]}</span></td>'
    f'<td class="mono">{e}</td><td class="mono">{p}</td><td class="mono">{n} {u}</td></tr>'
    for k, t, v, e, p, n, u in verdicts)

xc_rows = "".join(f'<tr><td class="mono">{k}</td><td class="mono">{v["pearson_r"]}</td><td class="mono">{p_fmt(v["pearson_p"])}</td><td class="mono">{v["n"]}</td></tr>'
                  for k, v in h1["cross_correlation_same_day"].items())
gr_rows = "".join(f'<tr><td class="mono">{L}</td><td class="mono">F = {v["stress->dyn_rate"]["F"]}, p = {p_fmt(v["stress->dyn_rate"]["p"])}</td>'
                  f'<td class="mono">F = {v["dyn_rate->stress"]["F"]}, p = {p_fmt(v["dyn_rate->stress"]["p"])}</td><td class="mono">{v["stress->dyn_rate"]["n"]}</td></tr>'
                  for L, v in gr.items())
h5_rows = "".join(f'<tr><td>{k.replace("_", " ")}</td><td class="mono">{", ".join(f"{b}" for b in v["beta_std"].values())}</td>'
                  f'<td class="mono">{", ".join(p_fmt(p) for p in v["p"].values())}</td><td class="mono">{v["r2"]}</td><td class="mono">{v["aic"]}</td></tr>'
                  for k, v in h5.items() if isinstance(v, dict))
h6_rows = "".join(f'<tr><td>{k}</td><td class="mono">{v["n"]}</td><td class="mono">{v["pearson_r"]}</td><td class="mono">{p_fmt(v["pearson_p"])}</td>'
                  f'<td class="mono">{v["stress_mean"]}</td><td class="mono">{v["dyn_rate_mean"]}</td></tr>' for k, v in h6["per_phase"].items())

html = f"""<meta charset="utf-8"><title>Body and Screen</title>
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,600&family=IBM+Plex+Sans:wght@400;500&family=IBM+Plex+Mono:wght@400;500&display=swap">
<style>
:root {{ color-scheme: light; --ground:#f7f6f3; --panel:#efede8; --ink:#1c1917; --ink-2:#57534e; --ink-3:#8a8580; --rule:#dcd9d3;
  --mark:#57534e; --fit:#1c1917; --s1:#2a78d6; --s2:#eb6834; --s3:#1baf7a; --chip:#e7e5e4; }}
@media (prefers-color-scheme: dark) {{ :root:not([data-theme="light"]) {{ color-scheme: dark; --ground:#1c1917; --panel:#242220; --ink:#fafaf9; --ink-2:#d6d3d1; --ink-3:#8a8580; --rule:#3a3734;
  --mark:#a8a29e; --fit:#fafaf9; --s1:#3987e5; --s2:#d95926; --s3:#199e70; --chip:#33302d; }} }}
:root[data-theme="dark"] {{ color-scheme: dark; --ground:#1c1917; --panel:#242220; --ink:#fafaf9; --ink-2:#d6d3d1; --ink-3:#8a8580; --rule:#3a3734;
  --mark:#a8a29e; --fit:#fafaf9; --s1:#3987e5; --s2:#d95926; --s3:#199e70; --chip:#33302d; }}
body {{ background:var(--ground); color:var(--ink); font-family:"IBM Plex Sans",system-ui,sans-serif; font-size:15px; line-height:1.55; }}
main {{ max-width:880px; margin:0 auto; padding:40px 24px 80px; }}
h1,h2 {{ font-family:Fraunces,Georgia,serif; font-weight:600; text-wrap:balance; margin:0; }}
h1 {{ font-size:40px; line-height:1.1; }}
h2 {{ font-size:22px; margin-top:56px; padding-top:20px; border-top:1px solid var(--rule); }}
h2 .id {{ font-family:"IBM Plex Mono",monospace; font-weight:500; color:var(--ink-3); font-size:14px; margin-right:10px; letter-spacing:.04em; }}
.eyebrow {{ font-family:"IBM Plex Mono",monospace; font-size:12px; letter-spacing:.08em; text-transform:uppercase; color:var(--ink-3); margin-bottom:12px; }}
.lede {{ font-size:17px; color:var(--ink-2); max-width:62ch; margin-top:16px; }}
p {{ max-width:68ch; }}
.mono {{ font-family:"IBM Plex Mono",monospace; font-variant-numeric:tabular-nums; font-size:13px; }}
table {{ border-collapse:collapse; width:100%; margin-top:16px; font-size:14px; }}
th {{ text-align:left; font-weight:500; color:var(--ink-3); font-size:12px; letter-spacing:.04em; text-transform:uppercase; padding:6px 10px 6px 0; border-bottom:1px solid var(--rule); }}
td {{ padding:8px 10px 8px 0; border-bottom:1px solid var(--rule); vertical-align:top; }}
.tw {{ overflow-x:auto; }}
.chip {{ display:inline-block; padding:1px 8px; border-radius:4px; font-family:"IBM Plex Mono",monospace; font-size:12px; background:var(--chip); color:var(--ink); white-space:nowrap; }}
.chip-null::before {{ content:"○ "; }} .chip-confounded::before {{ content:"◐ "; }} .chip-inverted::before {{ content:"⇅ "; }} .chip-suggestive::before {{ content:"◔ "; }}
.fig {{ margin-top:20px; background:var(--panel); border-radius:4px; padding:12px; position:relative; }}
.fig svg {{ width:100%; height:auto; display:block; }}
.fig .cap {{ font-size:13px; color:var(--ink-2); margin:8px 4px 0; }}
.tip {{ position:absolute; pointer-events:none; background:var(--ink); color:var(--ground); font-family:"IBM Plex Mono",monospace; font-size:12px; padding:4px 8px; border-radius:4px; white-space:nowrap; display:none; }}
.legend {{ display:flex; gap:16px; font-size:13px; color:var(--ink-2); margin:6px 4px 0; }}
.legend span::before {{ content:""; display:inline-block; width:10px; height:10px; border-radius:50%; margin-right:6px; vertical-align:-1px; background:var(--c); }}
.grid2 {{ display:grid; grid-template-columns:1fr 1fr; gap:24px; }}
@media (max-width:700px) {{ .grid2 {{ grid-template-columns:1fr; }} h1 {{ font-size:32px; }} }}
.note {{ border-left:2px solid var(--rule); padding:2px 0 2px 14px; color:var(--ink-2); font-size:14px; }}
kbd {{ font-family:"IBM Plex Mono",monospace; font-size:12px; background:var(--chip); padding:0 5px; border-radius:4px; }}
</style>
<main>
<div class="eyebrow">zenborg · research · n = 1 · {c['first_bio']} → {c['last']}</div>
<h1>Body and Screen</h1>
<p class="lede">Does the body's stress signal (Garmin) track how restlessly the hands move across apps and tabs (macOS daemon)? Six hypotheses, {c['bio_days']} days of physiology, {c['digital_days']} days of desktop trace, {c['hours_analysed_H1']} hours where both were observed at the computer.</p>

<div class="tw"><table>
<tr><th>#</th><th>Hypothesis</th><th>Verdict</th><th>Effect</th><th>p</th><th>n</th></tr>
{rows}
</table></div>
<p class="note">Bonferroni over six hypotheses puts the bar at α = {c['bonferroni_alpha_6']}. Hourly rows are autocorrelated within a day; regression p-values use Newey–West (HAC, 3 lags). Nothing here generalises beyond this one gardener.</p>

<h2><span class="id">H2</span>Overnight HRV does not predict the next day's dynamism</h2>
<p>Cleanest design first: last night's HRV (from <kbd>readiness_recorded</kbd>) against the total app + tab switches of the day that followed. Spearman ρ = {h2['hrv_raw_vs_total_dynamism']['spearman_rho']} (p = {p_fmt(h2['hrv_raw_vs_total_dynamism']['spearman_p'])}); per active hour ρ = {h2['hrv_raw_vs_dyn_per_active_hour']['spearman_rho']}. Controlling for weekend and sleep score, the standardised HRV coefficient is β = {h2['ols_total~hrv+weekend+sleep']['beta']} (p = {p_fmt(h2['ols_total~hrv+weekend+sleep']['p'])}, R² = {h2['ols_total~hrv+weekend+sleep']['r2']}). Normalising HRV against Garmin's balanced range (n = {h2['hrv_norm_vs_total_dynamism']['n']}) gives ρ = {h2['hrv_norm_vs_total_dynamism']['spearman_rho']}, p = {p_fmt(h2['hrv_norm_vs_total_dynamism']['spearman_p'])}. The placebo — the night <em>after</em> — is indistinguishable (ρ = {h2['placebo_next_night_hrv_vs_today_dynamism']['spearman_rho']}). HRV also fails to predict the day's mean stress (ρ = {h2['hrv_vs_daytime_stress']['spearman_rho']}).</p>
<div class="fig" id="fig-h2"><div class="cap">Overnight HRV (ms) → switches that day. One point per day; line is OLS.</div></div>

<h2><span class="id">H1</span>Within the hour, stress and switching are unrelated — but app and tab switching pull opposite ways</h2>
<p>Hourly mean stress against switches per active minute: r = {h1['stress_vs_dyn_rate']['pearson_r']} raw, r = {h1['partial_hour_dow']['pearson_r']} after residualising both on hour-of-day and weekday (p = {p_fmt(h1['partial_hour_dow']['pearson_p'])}). HAC regression: {h1['ols_hac_stress_per_switch_per_min']['beta']} stress points per extra switch/min, p = {p_fmt(h1['ols_hac_stress_per_switch_per_min']['p'])}. The composite hides a split: app switches correlate weakly positively with stress (ρ = {h1['stress_vs_app_switches']['spearman_rho']}, p = {p_fmt(h1['stress_vs_app_switches']['spearman_p'])}) while tab switches correlate negatively (ρ = {h1['stress_vs_tab_switches']['spearman_rho']}, p = {p_fmt(h1['stress_vs_tab_switches']['spearman_p'])}). Browsing hours are calmer than terminal-and-editor hours. Mouse-move rate carries nothing (ρ = {h1['stress_vs_move_rate']['spearman_rho']}).</p>
<div class="fig" id="fig-h1"><div class="cap">Switches per active minute → mean stress in the same hour. Hover for the local hour.</div></div>
<div class="grid2">
<div><div class="tw"><table><tr><th>Cross-correlation (same day)</th><th>r</th><th>p</th><th>n</th></tr>{xc_rows}</table></div></div>
<div><div class="tw"><table><tr><th>Granger</th><th>stress → switching</th><th>switching → stress</th><th>n</th></tr>{gr_rows}</table></div></div>
</div>
<p class="note">No lag in either direction reaches p &lt; 0.1. Stress at t+1 shows the largest (still null) coefficient, r = {h1['cross_correlation_same_day']['stress(t+1) vs dyn_rate(t)']['pearson_r']}. With looser filters (active ≥ 5 min, ≥ 3 stress bins; n = {R['H1_robustness_loose_filters']['n_hours']}) the picture holds: composite ρ = {R['H1_robustness_loose_filters']['stress_vs_dyn_rate']['spearman_rho']}, tabs ρ = {R['H1_robustness_loose_filters']['stress_vs_tab_switches']['spearman_rho']}.</p>

<h2><span class="id">H3</span>Input entropy does not rise with stress</h2>
<p>Shannon entropy over the four input channels (keys, clicks, moves, scrolls) per 30 s bin, averaged into Garmin's 5-minute stress bins. ρ = {h3['entropy_vs_stress']['spearman_rho']} (p = {p_fmt(h3['entropy_vs_stress']['spearman_p'])}, n = {h3['n_5min_bins']}); partial rank correlation controlling for total input volume ρ = {h3['partial_spearman_ctrl_total_input']['rho']}. Statistically visible at this n, practically nothing: entropy explains under 0.2% of stress variance. Entropy is mostly a function of how much input there is (ρ = {h3['entropy_vs_total_input']['spearman_rho']} with volume).</p>
<div class="fig" id="fig-h3"><div class="cap">Input entropy (bits) → stress, 5-minute bins outside workouts.</div></div>

<h2><span class="id">H4</span>Body-battery drain looks tied to dynamism, until hour-of-day is removed</h2>
<p>Raw: r = {h4['bb_delta_vs_dyn_rate']['pearson_r']} (p = {p_fmt(h4['bb_delta_vs_dyn_rate']['pearson_p'])}) — busier hours drain more. Residualised on hour and weekday: r = {h4['partial_hour_dow']['pearson_r']} (p = {p_fmt(h4['partial_hour_dow']['pearson_p'])}). The whole effect is circadian: mornings recharge, afternoons drain, and switching happens to peak in the morning. Adding stress as a control leaves r = {h4['partial_hour_dow_stress']['pearson_r']}. Note body battery is computed from stress (r = {h4['bb_delta_vs_stress']['pearson_r']} here), so it can never be an independent witness.</p>
<div class="fig" id="fig-h4"><div class="cap">Switches per active minute → body battery change over the hour (negative = drain).</div></div>

<h2><span class="id">H5</span>Neither tab breadth nor switching predicts <em>higher</em> stress — both predict lower</h2>
<p>The logs carry no open-tab count, so breadth is proxied by distinct tabs touched per hour. Each predictor, standardised, in its own HAC regression on hourly stress with hour and weekday controls (controls alone R² = {h5['controls_only_r2']}):</p>
<div class="tw"><table><tr><th>Predictor</th><th>Stress pts per SD</th><th>p</th><th>R²</th><th>AIC</th></tr>{h5_rows}</table></div>
<p>Tab switches edge out tab breadth on fit (lower AIC), and with both in the model the switch term keeps most of the weight. The sign is the story: an SD more browser activity in an hour goes with roughly four points <em>lower</em> stress; app switching goes with nothing. The hypothesis assumed load shows up as tabs; in this trace, tabs show up as rest.</p>

<h2><span class="id">H6</span>The one place switching tracks stress is the morning</h2>
<div class="tw"><table><tr><th>Phase</th><th>n</th><th>r</th><th>p</th><th>mean stress</th><th>switches / min</th></tr>{h6_rows}</table></div>
<p>Morning hours (07–13) show a positive slope, r = {h6['per_phase']['MORNING']['pearson_r']} (p = {p_fmt(h6['per_phase']['MORNING']['pearson_p'])}); afternoon and evening are flat. The phase × switching interaction is F = {h6['interaction_F']}, p = {p_fmt(h6['interaction_p'])} — suggestive, not significant, and the morning result would not survive the Bonferroni bar. Night has too few observed hours to test.</p>
<div class="fig" id="fig-h6"><div class="cap">H1 again, coloured by zenborg phase. Morning points carry the only positive slope.</div>
<div class="legend"><span style="--c:var(--s1)">Morning</span><span style="--c:var(--s2)">Afternoon</span><span style="--c:var(--s3)">Evening</span></div></div>

<h2>Method and caveats</h2>
<p><strong>Alignment.</strong> Garmin <kbd>body_sampled</kbd> records were re-keyed on their epoch timestamp (the <kbd>hour</kbd> field disagrees between sync batches) and shifted back one hour after verifying against the raw Garmin series on two dates; the vault stamps the <em>end</em> of the sampled hour. The Mac and watch moved from Europe/Paris to UTC−3 on Aug 17; hour-of-day and day boundaries follow that switch.</p>
<p><strong>Backfill.</strong> Garmin returns no data before Jun 25 (first day worn), so the window is bounded by the device, not the logs. The vault's own sync had already filled Jun 25 → Sep 8.</p>
<p><strong>Filters.</strong> Hourly rows need ≥ 10 active minutes (60 minus idle spans), ≥ 6 of 12 stress bins, and no overlapping workout or Garmin ACTIVITY event. Daily rows need ≥ 60 active minutes and a recorded overnight HRV.</p>
<p><strong>What would change the answer.</strong> Task labels — the tab-vs-app split suggests <em>what</em> is being switched between matters more than <em>how often</em>. A longer window for H2 (50 days at ρ ≈ −0.1 has ~10% power for a small effect). And an independent arousal channel: body battery is derived from stress, so H4 is not a second test.</p>
</main>
<script>
const DATA = {json.dumps(data)};
const PH = {{MORNING:"--s1", AFTERNOON:"--s2", EVENING:"--s3"}};
function nice(lo, hi) {{ const span = hi - lo || 1; const step = Math.pow(10, Math.floor(Math.log10(span / 5))); const m = [1,2,5,10].find(k => span / (step*k) <= 6) * step; const a = Math.floor(lo/m)*m, b = Math.ceil(hi/m)*m; const t=[]; for (let v=a; v<=b+1e-9; v+=m) t.push(+v.toFixed(6)); return [a,b,t]; }}
function scatter(id, pts, xl, yl, colorBy) {{
  const box = document.getElementById(id); const W=820, Hh=340, L=56, Rr=16, T=14, B=44;
  const xs = pts.map(p=>p[0]), ys = pts.map(p=>p[1]);
  const [x0,x1,xt] = nice(Math.min(...xs), Math.max(...xs)), [y0,y1,yt] = nice(Math.min(...ys), Math.max(...ys));
  const X = v => L + (v-x0)/(x1-x0)*(W-L-Rr), Y = v => T + (y1-v)/(y1-y0)*(Hh-T-B);
  const n = pts.length, mx = xs.reduce((a,b)=>a+b)/n, my = ys.reduce((a,b)=>a+b)/n;
  const b = xs.reduce((s,x,i)=>s+(x-mx)*(ys[i]-my),0) / xs.reduce((s,x)=>s+(x-mx)**2,0), a = my - b*mx;
  let s = `<svg viewBox="0 0 ${{W}} ${{Hh}}" font-family="IBM Plex Mono,monospace" font-size="11">`;
  for (const v of yt) s += `<line x1="${{L}}" x2="${{W-Rr}}" y1="${{Y(v)}}" y2="${{Y(v)}}" stroke="var(--rule)"/><text x="${{L-8}}" y="${{Y(v)+4}}" text-anchor="end" fill="var(--ink-3)">${{v}}</text>`;
  for (const v of xt) s += `<text x="${{X(v)}}" y="${{Hh-B+16}}" text-anchor="middle" fill="var(--ink-3)">${{v}}</text>`;
  s += `<line x1="${{L}}" x2="${{W-Rr}}" y1="${{Y(y0)}}" y2="${{Y(y0)}}" stroke="var(--ink-3)"/>`;
  s += `<text x="${{(L+W-Rr)/2}}" y="${{Hh-6}}" text-anchor="middle" fill="var(--ink-2)" font-family="IBM Plex Sans,sans-serif" font-size="12">${{xl}}</text>`;
  s += `<text transform="translate(12 ${{(T+Hh-B)/2}}) rotate(-90)" text-anchor="middle" fill="var(--ink-2)" font-family="IBM Plex Sans,sans-serif" font-size="12">${{yl}}</text>`;
  pts.forEach((p,i) => {{ const c = colorBy ? `var(${{PH[p[3]]||"--mark"}})` : "var(--mark)"; s += `<circle data-i="${{i}}" cx="${{X(p[0]).toFixed(1)}}" cy="${{Y(p[1]).toFixed(1)}}" r="3.5" fill="${{c}}" fill-opacity="${{n>1000?0.35:0.6}}" stroke="var(--panel)" stroke-width="1"/>`; }});
  s += `<line x1="${{X(x0)}}" y1="${{Y(a+b*x0)}}" x2="${{X(x1)}}" y2="${{Y(a+b*x1)}}" stroke="var(--fit)" stroke-width="2" stroke-dasharray="6 4"/></svg><div class="tip"></div>`;
  box.insertAdjacentHTML("afterbegin", s);
  const svg = box.querySelector("svg"), tip = box.querySelector(".tip");
  svg.addEventListener("mousemove", e => {{
    const r = svg.getBoundingClientRect(), k = W / r.width, px = (e.clientX-r.left)*k, py = (e.clientY-r.top)*k;
    let best=-1, bd=144; pts.forEach((p,i) => {{ const d=(X(p[0])-px)**2+(Y(p[1])-py)**2; if (d<bd) {{ bd=d; best=i; }} }});
    if (best<0) {{ tip.style.display="none"; return; }}
    const p = pts[best]; tip.textContent = `${{p[2]}}${{p[3]?" · "+p[3].toLowerCase():""}} · x ${{p[0]}} · y ${{p[1]}}`;
    tip.style.display="block"; tip.style.left = Math.min(e.clientX-r.left+12, r.width-tip.offsetWidth-8)+"px"; tip.style.top = (e.clientY-r.top-30)+"px";
  }});
  svg.addEventListener("mouseleave", () => tip.style.display="none");
}}
scatter("fig-h2", DATA.h2, "overnight HRV (ms)", "switches that day");
scatter("fig-h1", DATA.h1, "switches per active minute", "mean stress (hour)");
scatter("fig-h3", DATA.h3, "input entropy (bits)", "stress (5-min bin)");
scatter("fig-h4", DATA.h4, "switches per active minute", "body battery Δ (hour)");
scatter("fig-h6", DATA.h1, "switches per active minute", "mean stress (hour)", true);
</script>
"""
open(f"{OUT}/report.html", "w").write(html)
print("wrote", f"{OUT}/report.html", len(html) // 1024, "KB")
