"""Presentation figures, rendered from the committed evaluation files only (no numbers typed in by hand).

Dev-only (matplotlib is not part of the LinuxONE runtime). Run from ml/:
  python -m urban_sentinel.figures
Writes reports/figures/<name>_light.png and <name>_dark.png (1920 px wide).
"""
from __future__ import annotations

import json

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
from matplotlib.patches import FancyArrowPatch, FancyBboxPatch  # noqa: E402

from .config import DATA_DIR, REPORTS_DIR  # noqa: E402

FIG_DIR = REPORTS_DIR / "figures"
THEMES = {
    "light": {"surface": "#fcfcfb", "ink": "#0b0b0b", "ink2": "#52514e", "muted": "#898781", "grid": "#e1e0d9",
              "axis": "#c3c2b7", "s1": "#2a78d6", "s2": "#eb6834", "s3": "#1baf7a", "neutral": "#898781",
              "box": "#f3f2ee", "box_ibm": "#e6effb"},
    "dark": {"surface": "#1a1a19", "ink": "#f0efec", "ink2": "#c3c2b7", "muted": "#898781", "grid": "#2c2c2a",
             "axis": "#383835", "s1": "#3987e5", "s2": "#d95926", "s3": "#199e70", "neutral": "#6d6c67",
             "box": "#242422", "box_ibm": "#18263a"},
}
FONT = ["system-ui", "-apple-system", "Helvetica Neue", "Arial", "DejaVu Sans"]


def _setup(t, w=12.8, h=7.2):
    plt.rcParams.update({"font.family": "sans-serif", "font.sans-serif": FONT, "font.size": 15})
    fig = plt.figure(figsize=(w, h), dpi=150, facecolor=t["surface"])
    return fig


def _title(fig, t, title, subtitle):
    fig.text(0.05, 0.93, title, fontsize=24, fontweight="bold", color=t["ink"], ha="left", va="top")
    fig.text(0.05, 0.865, subtitle, fontsize=14, color=t["ink2"], ha="left", va="top")


def _footer(fig, t, text):
    fig.text(0.05, 0.035, text, fontsize=11, color=t["muted"], ha="left", va="bottom")


def _style_axis(ax, t):
    ax.set_facecolor(t["surface"])
    for side in ("top", "right", "left"):
        ax.spines[side].set_visible(False)
    ax.spines["bottom"].set_color(t["axis"])
    ax.tick_params(colors=t["ink2"], length=0)
    ax.xaxis.grid(True, color=t["grid"], linewidth=1)
    ax.set_axisbelow(True)


def hbar_comparison(t, name, title, subtitle, rows, base, base_label, note, footer, xmax):
    """rows: [(label, value, is_ours)] bottom→top. Values are proportions."""
    fig = _setup(t)
    _title(fig, t, title, subtitle)
    ax = fig.add_axes([0.30, 0.22, 0.62, 0.56])
    _style_axis(ax, t)
    labels = [r[0] for r in rows]
    values = [r[1] for r in rows]
    colors = [t["s1"] if r[2] else t["neutral"] for r in rows]
    ax.barh(range(len(rows)), values, height=0.56, color=colors)
    for i, (lab, v, ours) in enumerate(rows):
        ax.text(v + xmax * 0.012, i, f"{v:.1%}", va="center", ha="left", fontsize=17,
                fontweight="bold" if ours else "normal", color=t["ink"])
    ax.set_yticks(range(len(rows)), labels, fontsize=15, color=t["ink"])
    ax.set_xlim(0, xmax)
    ax.xaxis.set_major_formatter(matplotlib.ticker.PercentFormatter(1.0, decimals=0))
    ax.axvline(base, color=t["ink2"], linestyle=(0, (4, 3)), linewidth=1.5)
    ax.text(base, len(rows) - 0.42, f" {base_label}", color=t["ink2"], fontsize=12, va="bottom", ha="left")
    fig.text(0.30, 0.105, note, fontsize=13, color=t["ink"], ha="left")
    _footer(fig, t, footer)
    return fig


def fig_precision_at_500(t, r):
    c = r["dob_cycle9_common_set"]
    m = c["metrics"]
    boot = {b["metric"]: b for b in c["bootstrap"]["xgboost_minus_rule_prev_status"]}["precision@500"]
    boot_dob = {b["metric"]: b for b in c["bootstrap"]["xgboost_minus_dob_predprob_2022"]}["precision@500"]
    rows = [("NYC DOB published risk score (2022)", m["dob_predprob_2022"]["precision@500"], False),
            ("Rule: rank by last inspection result", m["rule_prev_status"]["precision@500"], False),
            ("Logistic regression on history", m["logistic_history"]["precision@500"], False),
            ("Urban Sentinel (XGBoost)", m["xgboost"]["precision@500"], True)]
    n = m["xgboost"]["n"]
    return hbar_comparison(
        t, "precision_at_500",
        "If inspectors could check 500 buildings, how many would be UNSAFE?",
        f"Share of the 500 highest-ranked buildings whose next façade filing was rated UNSAFE · cycle 9, same {n:,} buildings",
        rows, m["xgboost"]["base_rate"], f"Random pick: {m['xgboost']['base_rate']:.0%}",
        f"+{boot['diff'] * 100:.1f} pts vs the rule (95% CI +{boot['ci95'][0] * 100:.1f} to +{boot['ci95'][1] * 100:.1f}) · "
        f"+{boot_dob['diff'] * 100:.1f} pts vs DOB's score",
        "Model trained only on records before 21 Feb 2020; outcomes are cycle-9 filings (2020-2025). "
        "DOB's 2022 score may have seen these outcomes, which favours DOB.", 0.82)


def fig_previously_safe(t, r):
    s = r["primary_cycle9"]["subgroups"]["previously_safe"]
    m = s["metrics"]
    boot = {b["metric"]: b for b in s["bootstrap"]["xgboost_minus_logistic_history"]}["precision@250"]
    base = m["xgboost"]["base_rate"]
    rows = [("Rule: last inspection result (tied here)", m["rule_prev_status"]["precision@250"], False),
            ("Logistic regression on history", m["logistic_history"]["precision@250"], False),
            ("XGBoost on façade history only", m["xgboost_facade_only"]["precision@250"], False),
            ("Urban Sentinel (full model)", m["xgboost"]["precision@250"], True)]
    ours = m["xgboost"]["precision@250"]
    return hbar_comparison(
        t, "previously_safe",
        "Finding new problems, not just repeat offenders",
        f"{m['xgboost']['n']:,} buildings last rated SAFE · share of the top 250 flagged that were rated UNSAFE in cycle 9",
        rows, base, f"Base rate: {base:.1%}",
        f"{ours / base:.1f}× the base rate · +{boot['diff'] * 100:.1f} pts vs logistic regression "
        f"(95% CI +{boot['ci95'][0] * 100:.1f} to +{boot['ci95'][1] * 100:.1f})",
        "Same cycle-9 holdout as the headline result; features use only records before 21 Feb 2020.", 0.55)


def fig_latency(t, bench, latency):
    nf = bench["nan_free_variant"]
    fm = nf["formats"]
    engines = [("XGBoost · CPU", t["s1"], nf["xgboost_single_row_ms"], nf["xgboost_batch_ms"]),
               ("Snap ML · CPU", t["s2"], fm["compress_trees"]["single_row_ms"], fm["compress_trees"]["batch_ms"]),
               ("Snap ML · IBM Z NNPA", t["s3"], fm["zdnn_tensors"]["single_row_ms"], fm["zdnn_tensors"]["batch_ms"])]
    fig = _setup(t)
    _title(fig, t, "On-chip AI accelerator: identical predictions, measured honestly",
           f"Model inference time on the team's IBM LinuxONE VM (s390x) · same model, {bench['n_buildings']:,} pending buildings")
    for k, (panel, idx, unit_fmt) in enumerate([("One building (live request)", 2, "{:.3f} ms"),
                                                (f"All {bench['n_buildings']:,} buildings (batch)", 3, "{:.0f} ms")]):
        ax = fig.add_axes([0.07 + k * 0.47, 0.25, 0.40, 0.47])
        _style_axis(ax, t)
        vals = [e[idx] for e in engines]
        ax.bar(range(3), vals, width=0.6, color=[e[1] for e in engines])
        for i, v in enumerate(vals):
            ax.text(i, v * 1.02 + max(vals) * 0.01, unit_fmt.format(v), ha="center", va="bottom", fontsize=15,
                    color=t["ink"], fontweight="bold")
        ax.set_xticks(range(3), [e[0] for e in engines], fontsize=13, color=t["ink"])
        ax.set_ylim(0, max(vals) * 1.25)
        ax.yaxis.grid(True, color=t["grid"])
        ax.xaxis.grid(False)
        ax.set_title(panel, fontsize=16, color=t["ink"], loc="left", pad=12)
        ax.set_ylabel("milliseconds", color=t["ink2"], fontsize=12)
    z = fm["zdnn_tensors"]
    note = (f"NNPA vs XGBoost: max probability difference {z['max_abs_diff_vs_xgboost']:.1e} across "
            f"{z['rows_without_missing']:,} buildings, identical top 500.\n"
            f"Per request the NNPA is {nf['xgboost_single_row_ms'] / z['single_row_ms']:.0f}× faster than XGBoost; in batch it is slower.")
    fig.text(0.07, 0.085, note, fontsize=13, color=t["ink"], ha="left", linespacing=1.5)
    live = ""
    if latency and "engines" in latency:
        e = latency["engines"]
        if "nnpa" in e:
            live = (f" · Live API, {latency['buildings']} requests: NNPA median "
                    f"{e['nnpa']['model_inference_ms']['median']:.3f} ms vs XGBoost {e['xgboost']['model_inference_ms']['median']:.3f} ms")
    _footer(fig, t, "Shared 3-vCPU VM; timings vary run to run. Inference only (feature computation excluded)." + live)
    return fig


def fig_deciles(t, bt):
    d = bt["by_decile"]
    fig = _setup(t)
    _title(fig, t, "Predicted risk vs what inspectors actually recorded",
           f"Cycle-9 holdout: {bt['n']:,} buildings in deciles of predicted risk (1 = highest) · model trained on cycles 7-8 only")
    ax = fig.add_axes([0.08, 0.17, 0.86, 0.60])
    _style_axis(ax, t)
    ax.xaxis.grid(False)
    ax.yaxis.grid(True, color=t["grid"])
    x = [row["decile"] for row in d]
    ax.bar(x, [row["actual_unsafe_rate"] for row in d], width=0.62, color=t["s1"], label="Actually rated UNSAFE")
    ax.plot(x, [row["predicted"] for row in d], color=t["s2"], linewidth=2, marker="o", markersize=8,
            markeredgecolor=t["surface"], markeredgewidth=2, label="Predicted probability (mean)")
    for row in d[:1]:
        ax.text(row["decile"], row["actual_unsafe_rate"] + 0.015, f"{row['actual_unsafe_rate']:.0%}", ha="center",
                fontsize=15, fontweight="bold", color=t["ink"])
    ax.text(d[-1]["decile"], d[-1]["actual_unsafe_rate"] + 0.015, f"{d[-1]['actual_unsafe_rate']:.0%}", ha="center",
            fontsize=15, color=t["ink"])
    ax.axhline(bt["base_rate"], color=t["ink2"], linestyle=(0, (4, 3)), linewidth=1.5)
    ax.text(10.45, bt["base_rate"], f"Overall {bt['base_rate']:.0%}", color=t["ink2"], fontsize=12, va="bottom", ha="right")
    ax.set_xticks(x, [str(v) for v in x], color=t["ink"])
    ax.set_xlabel("Predicted-risk decile", color=t["ink2"])
    ax.yaxis.set_major_formatter(matplotlib.ticker.PercentFormatter(1.0, decimals=0))
    leg = ax.legend(frameon=False, loc="upper right", fontsize=13, labelcolor=t["ink"])
    _footer(fig, t, "Each decile ~1,333 buildings. Outcome = worst status among the building's cycle-9 Initial FISP filings.")
    return fig


def _box(ax, t, x, y, w, h, title, lines, ibm=False):
    ax.add_patch(FancyBboxPatch((x, y), w, h, boxstyle="round,pad=0.008,rounding_size=0.015",
                                facecolor=t["box_ibm"] if ibm else t["box"],
                                edgecolor=t["s1"] if ibm else t["axis"], linewidth=2 if ibm else 1.2))
    ax.text(x + 0.015, y + h - 0.03, title, fontsize=14.5, fontweight="bold", color=t["ink"], va="top")
    for i, line in enumerate(lines):
        ax.text(x + 0.015, y + h - 0.075 - i * 0.042, line, fontsize=12, color=t["ink2"], va="top")


def _arrow(ax, t, a, b, label=None, dashed=False, offset=(0.0, 0.03)):
    ax.add_patch(FancyArrowPatch(a, b, arrowstyle="-|>", mutation_scale=18, color=t["ink2"], linewidth=1.6,
                                 linestyle=(0, (4, 3)) if dashed else "-"))
    if label:
        ax.text((a[0] + b[0]) / 2 + offset[0], (a[1] + b[1]) / 2 + offset[1], label, fontsize=11.5,
                color=t["ink2"], ha="center", va="center", backgroundcolor=t["surface"])


def fig_architecture(t):
    fig = _setup(t)
    _title(fig, t, "Urban Sentinel on IBM LinuxONE",
           "Everything in the blue box runs on the team's LinuxONE VM (RHEL 9.8, s390x), inside IBM's jupyterlab-image-s390x container (Podman)")
    ax = fig.add_axes([0.03, 0.06, 0.94, 0.76])
    ax.set_xlim(0, 1)
    ax.set_ylim(0, 1)
    ax.axis("off")
    _box(ax, t, 0.01, 0.50, 0.185, 0.40, "NYC Open Data", ["FISP façade filings", "DOB violations", "ECB violations",
                                                          "PLUTO building data", "(public, daily updates)"])
    ax.add_patch(FancyBboxPatch((0.25, 0.08), 0.50, 0.86, boxstyle="round,pad=0.008,rounding_size=0.02",
                                facecolor="none", edgecolor=t["s1"], linewidth=2.5))
    ax.text(0.27, 0.925, "IBM LinuxONE · s390x · big-endian", fontsize=14, fontweight="bold", color=t["s1"], va="top")
    _box(ax, t, 0.27, 0.55, 0.21, 0.29, "Point-in-time pipeline", ["records dated before cutoff", "leakage guard + tests",
                                                                   "73 features"], ibm=True)
    _box(ax, t, 0.52, 0.55, 0.21, 0.29, "Train + evaluate", ["XGBoost on cycles 7-9", "Platt calibration",
                                                             "cycle-9 holdout"], ibm=True)
    _box(ax, t, 0.27, 0.13, 0.21, 0.36, "Live scoring", ["IBM Snap ML on the", "NNPA on-chip accelerator",
                                                         "(zdnn_tensors)", "XGBoost fallback", "TreeSHAP explanations"], ibm=True)
    _box(ax, t, 0.52, 0.13, 0.21, 0.36, "FastAPI service", ["/predictions", "/score/{bin}", "/health (proof: s390x)",
                                                            "bound to 127.0.0.1"], ibm=True)
    _box(ax, t, 0.805, 0.50, 0.185, 0.40, "3D map (browser)", ["MapLibre + deck.gl", "Lower Manhattan", "\"Recalculate on IBM Z\"",
                                                             "shows engine + latency"])
    _box(ax, t, 0.805, 0.08, 0.185, 0.32, "NASA OPERA InSAR", ["processed on a laptop", "visual layer only", "(tested: no model gain)"])
    _arrow(ax, t, (0.195, 0.70), (0.27, 0.70), "HTTPS", offset=(0.0, 0.035))
    _arrow(ax, t, (0.48, 0.695), (0.52, 0.695))
    _arrow(ax, t, (0.60, 0.55), (0.42, 0.49), "trained model (JSON)", offset=(0.0, 0.0))
    _arrow(ax, t, (0.48, 0.31), (0.52, 0.31))
    _arrow(ax, t, (0.73, 0.40), (0.805, 0.60), "SSH tunnel", offset=(0.05, -0.02))
    _arrow(ax, t, (0.8975, 0.40), (0.8975, 0.50), dashed=True)
    return fig


def main() -> None:
    FIG_DIR.mkdir(parents=True, exist_ok=True)
    metrics = json.loads((REPORTS_DIR / "metrics.json").read_text())
    bench = json.loads((REPORTS_DIR / "linuxone" / "nnpa_benchmark_s390x.json").read_text())
    lat_path = REPORTS_DIR / "linuxone" / "latency_s390x.json"
    latency = json.loads(lat_path.read_text()) if lat_path.exists() else None
    deciles_path = REPORTS_DIR / "cycle9_deciles.json"
    bt_path = DATA_DIR / "outputs" / "cycle9_backtest.json"
    if bt_path.exists():  # keep a small committed copy of the decile summary
        bt = json.loads(bt_path.read_text())
        deciles_path.write_text(json.dumps({k: v for k, v in bt.items() if k != "buildings"}, indent=2))
    bt = json.loads(deciles_path.read_text())
    for theme, t in THEMES.items():
        for name, fig in [("precision_at_500", fig_precision_at_500(t, metrics)),
                          ("previously_safe", fig_previously_safe(t, metrics)),
                          ("nnpa_latency", fig_latency(t, bench, latency)),
                          ("cycle9_deciles", fig_deciles(t, bt)),
                          ("architecture", fig_architecture(t))]:
            fig.savefig(FIG_DIR / f"{name}_{theme}.png", facecolor=t["surface"])
            plt.close(fig)
    print("wrote", sorted(p.name for p in FIG_DIR.glob("*.png")))


if __name__ == "__main__":
    main()
