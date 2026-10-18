"""Presentation-sized, data-driven notebook figures (no network access)."""
from __future__ import annotations

from html import escape
import base64
import json
from pathlib import Path
import textwrap

import matplotlib.pyplot as plt
from matplotlib.collections import PolyCollection
from matplotlib.colors import TwoSlopeNorm
from matplotlib.ticker import PercentFormatter
import numpy as np
import pandas as pd
from IPython.display import HTML, display

INK, BLUE, TEAL, GRAY, ORANGE = "#172d36", "#255cc6", "#167d78", "#87999f", "#b85c37"


def theme():
    plt.rcParams.update({"font.family": "DejaVu Sans", "font.size": 13,
                         "axes.spines.top": False, "axes.spines.right": False,
                         "axes.labelcolor": INK, "text.color": INK,
                         "figure.facecolor": "#ffffff", "axes.facecolor": "#ffffff",
                         "savefig.facecolor": "#ffffff", "figure.dpi": 110})
    display(HTML("""<style>
    .us-card {border-left:5px solid #167d78;background:#f2f7f7;padding:18px 24px;
              color:#172d36;line-height:1.5;font:16px system-ui;max-width:1050px;margin:12px 0;}
    .us-card strong {font-size:22px;} .us-card .us-meta {color:#52666d;font-size:14px;}
    .us-table {border-collapse:collapse;font:14px system-ui;color:#172d36;width:100%;max-width:1100px;}
    .us-table td,.us-table th {padding:9px 12px;text-align:left;border-bottom:1px solid #dde5e6;white-space:normal;}
    .us-table th {background:#edf3f4;} .us-table tr:nth-child(even) {background:#f8fafa;}
    </style>"""))


def card(title, text, meta=""):
    display(HTML(f'<div class="us-card"><strong>{escape(str(title))}</strong><br>'
                 f'{escape(str(text))}<br><span class="us-meta">{escape(str(meta))}</span></div>'))


def table(frame, limit=8):
    display(HTML(frame.head(limit).to_html(index=False, border=0, classes="us-table", escape=True)))


def canvas(title, subtitle, footer, height=4.7):
    fig = plt.figure(figsize=(11.2, height))
    fig.text(.05, .96, title, va="top", fontsize=21, weight="bold")
    fig.text(.05, .875, subtitle, va="top", fontsize=12, color="#52666d")
    fig.text(.05, .025, footer, va="bottom", fontsize=10, color="#52666d")
    return fig


def finish(fig, name):
    from urban_sentinel.config import DATA_DIR
    target = DATA_DIR / "figures"
    target.mkdir(parents=True, exist_ok=True)
    path = target / f"{name}.png"
    fig.savefig(path, dpi=150)
    # Embed a self-contained image with alt text: some nbconvert lab templates drop PNG alt metadata.
    encoded = base64.b64encode(path.read_bytes()).decode("ascii")
    alt = escape(". ".join(t.get_text() for t in fig.texts), quote=True)
    display(HTML(f'<img src="data:image/png;base64,{encoded}" alt="{alt}" '
                 'style="width:1120px;max-width:100%;height:auto"/>'))
    plt.close(fig)


def current_platform(manifest):
    fp = manifest["platform"]
    label = "IBM Z architecture · s390x" if fp["machine"] == "s390x" else f"Local rehearsal · {fp['machine']}"
    card(label, f"{fp['system']} · Python {fp['python']} · {fp['byteorder']}-endian",
         f"Measured in this kernel: {fp['timestamp_utc']} · Verify instance identity in your LinuxONE console.")


def preparation(prepared):
    from urban_sentinel.ingest import facade_bbls
    fac = prepared["context"].fac
    bbls = facade_bbls(fac)
    pluto = prepared["pluto"].reindex(bbls.values)
    data = pd.Series({"Observable filing date": fac.observed_on.notna().mean(),
                      "Matched PLUTO lot": pd.Index(bbls.values).isin(prepared["pluto"].index).mean(),
                      "Construction year ≥1701": pd.to_numeric(pluto.yearbuilt, errors="coerce").gt(1700).mean(),
                      "Lot latitude available": pd.to_numeric(pluto.latitude, errors="coerce").notna().mean()})
    fig = canvas("Public records become a building-level history",
                 f"{len(prepared['raw']):,} downloaded filing rows → {len(fac):,} retained → {fac.bin.nunique():,} building BINs",
                 f"{fac.observed_on.isna().sum():,} filing dates missing. Date coverage uses filing rows; PLUTO uses buildings with a derived BBL.")
    ax = fig.add_axes([.31, .20, .61, .55])
    ax.barh(data.index[::-1], data.values[::-1], color=TEAL, height=.55)
    ax.set_xlim(0, 1.15)
    ax.xaxis.set_major_formatter(PercentFormatter(1))
    for i, value in enumerate(data.values[::-1]):
        ax.text(value+.015, i, f"{value:.2%}", va="center", weight="bold")
    finish(fig, "02_source_coverage")


def timeline(check):
    fig = canvas("Would we have known before the inspection?",
                 "Train on cycles 7–8; reserve completed cycle 9 for evaluation",
                 "PLUTO attributes / lot links are current snapshots. Never-filers have no observed outcome and remain unlabeled.")
    ax = fig.add_axes([.07, .24, .87, .49])
    ax.set_xlim(2009, 2026); ax.set_ylim(0, 3); ax.axis("off")
    for start, stop, label, color in [(2010,2015,"Cycle 7\nTraining",BLUE),
                                    (2015,2020,"Cycle 8\nTuning + training",TEAL),
                                    (2020,2025,"Cycle 9\nHeld-out outcomes",ORANGE)]:
        ax.barh(1.4, stop-start-.15, left=start, height=1.05, color=color)
        ax.text((start+stop)/2, 1.4, label, color="white", ha="center", va="center", weight="bold", fontsize=15)
        ax.text(start, .53, str(start), ha="center")
    ax.text(2025,.53,"2025",ha="center")
    ax.axvline(2020, ymin=.30, ymax=.9, color=INK, linestyle="--")
    ax.text(2020,2.65,f"Test feature cutoff: {check['cutoff']}",ha="center",fontsize=13)
    fig.text(.07,.145,f"PASS · future record / outcome checks on {check['buildings_checked']} buildings",weight="bold",color=TEAL)
    finish(fig,"03_time_split")


def comparison_rows(metrics):
    m = metrics["dob_cycle9_common_set"]["metrics"]
    names = [("dob_predprob_2022", "DOB published score (2022)"),
             ("rule_prev_status", "Last-inspection rule"), ("xgboost", "Urban Sentinel")]
    rows = [{"Method": label, "Precision": m[key]["precision@500"], "n": m[key]["n"],
             "Base rate": m[key]["base_rate"]} for key, label in names]
    if len({r["n"] for r in rows}) != 1 or len({r["Base rate"] for r in rows}) != 1:
        raise ValueError("Comparison methods must use the same cohort and base rate.")
    return pd.DataFrame(rows)


def precision(metrics):
    rows = comparison_rows(metrics)
    n = int(rows.iloc[0]["n"])
    fp = metrics["run"]
    fig = canvas("If we can inspect 500 buildings, where should we start?",
                 f"Share of the top 500 with a recorded UNSAFE outcome · same {n:,} buildings · cycle 9",
                 f"Fresh evaluation · {fp['machine']} · {fp['timestamp_utc'][:10]}\nDOB's 2022 benchmark may have seen cycle-9 outcomes; this comparison can favor DOB.", 5)
    ax = fig.add_axes([.29, .25, .63, .51])
    ax.barh(rows.Method, rows.Precision, color=[GRAY,GRAY,BLUE], height=.55)
    for i,v in enumerate(rows.Precision):
        ax.text(v+.015,i,f"{v:.1%}",va="center",weight="bold",fontsize=17)
    ax.set_xlim(0, min(1.15,max(.8,rows.Precision.max()+.15)))
    ax.xaxis.set_major_formatter(PercentFormatter(1)); ax.set_xlabel("Recorded UNSAFE among the selected 500")
    base=rows.iloc[0]["Base rate"]
    ax.axvline(base,color=TEAL,linestyle="--",label=f"Cohort base rate {base:.1%}")
    ax.legend(frameon=False,loc="lower right",fontsize=11)
    finish(fig,"04_precision_at_500")


def reliability(metrics):
    p=metrics["primary_cycle9"]
    safe=p["subgroups"]["previously_safe"]["metrics"]
    rel=pd.DataFrame(p["calibration"]["reliability"])
    fig=canvas("New problems, and probabilities we can check",
               "Previously-SAFE buildings on the left · probability calibration on the full holdout on the right",
               "Fresh cycle-9 evaluation. Groups have different denominators; subplot labels show each sample size.",5.2)
    ax=fig.add_axes([.08,.22,.36,.52])
    keys=["rule_prev_status","xgboost"]
    vals=[safe[k]["precision@250"] for k in keys]
    ax.bar(["Last-status\nrule","Urban\nSentinel"],vals,color=[GRAY,BLUE],width=.55)
    for i,v in enumerate(vals): ax.text(i,v+.015,f"{v:.1%}",ha="center",weight="bold")
    ax.set_ylim(0,min(1.1,max(vals)+.16)); ax.yaxis.set_major_formatter(PercentFormatter(1))
    ax.set_title(f"Top 250 · {safe['xgboost']['n']:,} previously SAFE",fontsize=13)
    ax.set_ylabel("Recorded UNSAFE")
    ax.axhline(safe["xgboost"]["base_rate"],color=TEAL,linestyle="--",label="Subgroup base rate")
    ax.legend(frameon=False,fontsize=10,loc="upper right")
    bx=fig.add_axes([.59,.22,.34,.52])
    bx.plot([0,1],[0,1],color=GRAY,linestyle="--",label="Perfect agreement")
    bx.plot(rel.mean_predicted,rel.observed,"o-",color=BLUE,label="Probability groups")
    bx.set(xlim=(0,1),ylim=(0,1),xlabel="Mean predicted probability",ylabel="Observed UNSAFE rate")
    bx.xaxis.set_major_formatter(PercentFormatter(1)); bx.yaxis.set_major_formatter(PercentFormatter(1))
    bx.set_title(f"All {p['metrics']['xgboost']['n']:,} held-out buildings",fontsize=13)
    bx.legend(frameon=False,fontsize=10)
    finish(fig,"04_subgroup_and_calibration")


def satellite(repo):
    from urban_sentinel.config import OUTPUT_DIR, REPORTS_DIR
    live=OUTPUT_DIR/"insar_ground_motion.geojson"
    ab_path=REPORTS_DIR/"insar_ablation.json"
    receipt = None
    if live.exists() or ab_path.exists():
        receipt_path = OUTPUT_DIR.parent / "satellite_manifest.json"
        receipt = json.loads(receipt_path.read_text()) if receipt_path.exists() else {}
        if receipt.get("status") != "complete" or not (live.exists() and ab_path.exists()):
            raise RuntimeError("Incomplete run-local satellite artifacts. Finish optional reconstruction or use a new RUN_ID; no partial result will be presented as successful.")
    layer=json.loads((live if live.exists() else repo/"frontend/public/data/insar-ground-motion.geojson").read_text())
    fresh=live.exists()
    meta=layer["metadata"]
    items=[f for f in layer["features"] if -74.022<=f["geometry"]["coordinates"][0]<=-73.97
           and 40.7<=f["geometry"]["coordinates"][1]<=40.735]
    if not items: raise ValueError("No measured satellite points in the Lower Manhattan presentation area.")
    coords=np.array([f["geometry"]["coordinates"] for f in items])
    vals=np.array([f["properties"]["velocity_mm_yr"] for f in items])
    geo=json.loads((repo/"frontend/public/data/buildings-demo.geojson").read_text())
    polys=[]
    for f in geo["features"]:
        g=f["geometry"]
        if g["type"]=="Polygon": polys.append(g["coordinates"][0])
        elif g["type"]=="MultiPolygon": polys.extend(p[0] for p in g["coordinates"])
    fig=canvas("Satellite movement: useful context, tested separately",
               f"{len(items):,} measured locations · {meta['observation_start']} to {meta['observation_end']} · {meta['pixel_size_m']} m pixels",
               f"{'Run-local reconstructed export' if fresh else 'Saved measured export (not recomputed in this run)'} · NASA OPERA DISP-S1 {meta['frame']}\nNegative = away from satellite; positive = toward it. Shared pixels do not resolve individual façade condition.",5.4)
    ax=fig.add_axes([.08,.21,.42,.55])
    ax.add_collection(PolyCollection(polys,facecolor="#e2e8e8",edgecolor="none",rasterized=True))
    bound=max(.1,float(np.quantile(np.abs(vals),.98)))
    dots=ax.scatter(coords[:,0],coords[:,1],c=vals,cmap="RdBu_r",norm=TwoSlopeNorm(vmin=-bound,vcenter=0,vmax=bound),s=5,rasterized=True)
    ax.set(xlim=(-74.022,-73.97),ylim=(40.7,40.735)); ax.set_aspect(1/np.cos(np.deg2rad(40.72)))
    ax.set_xticks([]);ax.set_yticks([])
    cb=fig.colorbar(dots,ax=ax,shrink=.8,pad=.03,extend="both")
    cb.set_label("LOS velocity (mm/year)",fontsize=11)
    ax.set_title("Relative to ~2 km surroundings",fontsize=12)
    ab=json.loads((ab_path if ab_path.exists() else repo/"ml/reports/insar_ablation.json").read_text())
    b=ab["B_cycle9_grouped_cv"]
    bx=fig.add_axes([.65,.31,.27,.34])
    scores=[b[k]["pr_auc"] for k in ["without_insar","with_insar"]]
    bx.bar(["Records\nonly","Records +\nsatellite"],scores,color=[BLUE,GRAY],width=.55)
    for i,v in enumerate(scores): bx.text(i,v+.015,f"{v:.3f}",ha="center",weight="bold")
    bx.set_ylim(0,max(.6,max(scores)+.1));bx.set_ylabel("Average precision (PR-AUC)",fontsize=11)
    bx.set_title("Cycle 9 · tax-block grouped CV",fontsize=12)
    d=b["delta_pr_auc"]
    fig.text(.61,.19,f"Δ {d['diff']:+.3f}; 95% CI [{d['ci95'][0]:+.3f}, {d['ci95'][1]:+.3f}]",fontsize=11)
    fig.text(.61,.135,("Run-local ablation" if fresh else "Saved research result")+f" · n = {b['without_insar']['n']:,}",fontsize=11,color="#52666d")
    finish(fig,"05_satellite_and_ablation")
    stamp = meta.get("provenance", {}).get("generated_at", "not recorded")
    if fresh:
        origin = receipt["satellite_platform"]["machine"]
        ablation_date = f"{receipt['completed_at']} · {receipt['ml_platform']['machine']}"
    else:
        origin = "not recorded in saved export"
        ablation_date = "date / execution platform not recorded in saved ablation JSON"
    card("Satellite provenance", f"Export generated {stamp} · platform: {origin}",
         f"Ablation: {ablation_date}. Observation dates above are not execution dates.")
    return meta


def prediction(record,factors):
    title=record["address"] or f"BIN {record['bin']}"
    card(f"{record['probability']:.1%} · {title}",
         f"Next Initial FISP filing records UNSAFE · prior status {record['prior_status']} · rank #{record['rank']}",
         f"Computed now on {record['platform']['machine']} · {record['engine']} · model {record['model']}")
    fig=canvas("Why this building rises in the inspection queue",
               f"Inference {record['model_inference_ms']:.3f} ms · features + inference + explanation {record['end_to_end_ms']:.1f} ms",
               "XGBoost TreeSHAP, raw model log-odds. Contributions explain the model, not physical causes or percentage-point changes.",4.8)
    f=factors.iloc[::-1]
    ax=fig.add_axes([.43,.22,.50,.53])
    vals=f["Log-odds contribution"].to_numpy()
    labels=[textwrap.fill(str(t),36) for t in f.Factor]
    ax.barh(np.arange(len(f)),vals,color=[ORANGE if v>0 else TEAL for v in vals],height=.62)
    ax.set_yticks(np.arange(len(f)),labels,fontsize=11)
    ax.axvline(0,color=INK,linewidth=1); ax.set_xlabel("← lowers score       raises score →",fontsize=11)
    finish(fig,"06_live_explanation")
    if record["engine"]!="snapml-nnpa":
        card("CPU execution in this run",record["nnpa"].get("reason","NNPA not enabled"),
             "The saved LinuxONE benchmark in the appendix is separate historical evidence.")
