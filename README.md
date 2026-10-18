# Urban Sentinel

**An early-warning tool that tells New York City (NYC) inspectors which building façades to check first. Its machine learning (ML) model is trained and served on IBM LinuxONE, and live predictions run on the artificial intelligence (AI) accelerator built into the IBM Z chip.**

IBM Z Datathon 2026 · Track: **Real-Time AI for Critical Decisions** · Team **Megatronn**: Kason Lin, Jayden Lee, Aaron Munford, Tina Tran

![Urban Sentinel three-dimensional map of Lower Manhattan, buildings coloured by predicted façade risk](docs/screenshots/map-overview.jpg)

---

## In 30 seconds

- **The problem.** A façade is a building's outer wall. In NYC, buildings taller than six stories only get a required façade inspection **once every five years**. In between, the city mostly learns about problems from complaints, often after something has already fallen to the sidewalk.
- **What we built.** Urban Sentinel gives every building a score: the **chance that its next required inspection will rate the façade UNSAFE**. Inspectors can then visit the riskiest buildings first. Everything is shown on an interactive three-dimensional (3D) map, with the reasons behind each score.
- **Does it work?** We tested it on real inspections from 2020–2025 that the model had never seen. **Of the 500 buildings it would have sent inspectors to first, 66% were later rated UNSAFE.** For comparison, on the 12,116 buildings every method covers:

  | Way of choosing the first 500 buildings | Share later rated UNSAFE |
  |---|---|
  | **Urban Sentinel** | **66%** |
  | Each building's last inspection result | 55% |
  | The NYC Department of Buildings (DOB) published risk score | 40% |
  | A random pick | 26% |

- **Built on IBM Z.** The whole system is **trained, tested and served on IBM LinuxONE**, IBM's Linux mainframe. Live predictions run on the **Neural Network Processing Assist (NNPA)**, the AI accelerator built into the IBM Telum chip. Its answers match the original model to within 0.0000003.

### Key terms

| Term | Plain meaning |
|---|---|
| **Façade Inspection & Safety Program (FISP)** | NYC's Local Law 11. Every building taller than six stories must have a licensed inspector check its façade every five years. Each five-year round is called a **cycle**. |
| **Inspection ratings** | An inspector gives one of three ratings. **SAFE**: no problems. **Safe With A Repair and Maintenance Program (SWARMP)**: safe for now, but repairs are needed. **UNSAFE**: the façade is a danger and must be fixed right away. |
| **Model** | A computer program that learns patterns from past records and uses them to predict what will happen next. |
| **IBM LinuxONE / IBM Z** | IBM's mainframe computers, built for reliable, secure, high-volume work. LinuxONE is the version that runs Linux. |
| **Precision in the top 500** | Of the 500 buildings ranked riskiest, how many really turned out UNSAFE. Higher is better. |
| **Precision–recall area under the curve (PR-AUC)** | One number from 0 to 1 that sums up how well a ranking puts truly UNSAFE buildings near the top. Higher is better; a random ranking scores about 0.25 here. |

---

## 1. The problem

Failing infrastructure is expensive, and ordinary people pay for it:

- **$391–647 billion a year** in disruption costs to households and businesses in low- and middle-income countries ([World Bank, *Lifelines*, 2019](https://blogs.worldbank.org/en/climatechange/pipes-prosperity-resilient-infrastructure-opportunity)).
- **$668 million a year**, equal to 1.8% of gross domestic product (GDP), in losses to businesses in a single country, Tanzania (same report).
- **$3,300 per United States (US) household per year**, and **$10 trillion in lost US GDP over two decades**, if infrastructure investment stays where it is ([American Society of Civil Engineers (ASCE), *Failure to Act*, 2021](https://www.asce.org/publications-and-news/civil-engineering-source/society-news/article/2021/01/12/deteriorating-infrastructure-and-growing-investment-gap-will-reduce-us-gdp)).

**Building façades are where this becomes a street-level safety issue.** Under FISP, about **13,000 buildings** file an inspection report each cycle, and **roughly 1 in 4 first reports is rated UNSAFE**. Between cycles, the city learns about problems mainly from complaints and violations, so it reacts after the fact.

In December 2019, architect Erica Tishman was killed by façade debris falling from 729 Seventh Avenue. The building had an open façade violation from April that year ([Commercial Observer](https://commercialobserver.com/2019/12/729-seventh-avenue-erica-tishman-construction-death/)). Inspectors have limited time, so **the critical decision is which buildings to look at first.**

## 2. Our solution

| Before: reactive | After: Urban Sentinel |
|---|---|
| A façade is inspected once every 5 years, on a fixed schedule | Every building gets a **risk score**, updated as new city records arrive |
| Problems surface through complaints, often after damage is visible | A **ranked inspection shortlist**, sized to how many inspections the team can do |
| No view of which of ~13,000 buildings is most likely to fail next | **Reasons** for each score: past ratings, violations, building traits |
| Decisions made one building at a time | A **3D city map** for planning, with search and building history |

**Key features**

| Feature | What it does |
|---|---|
| **Risk map** | A 3D map of Lower Manhattan with 1,568 scored buildings, coloured Critical / High / Medium / Low, plus 375 buildings showing their already-filed cycle-10 result |
| **Inspection shortlist** | The top buildings for a chosen number of inspections, downloadable as a spreadsheet (comma-separated values, CSV) |
| **Recalculate on IBM Z** | Re-scores a building live on LinuxONE and shows which hardware did the work (the NNPA accelerator or the main processor), the result and how long it took |
| **Why this building?** | The top factors behind each score, in plain language |
| **Satellite ground motion** | Ground movement measured from space, shown as a separate background layer |
| **Search and history** | Look up any NYC address or Building Identification Number (BIN) and see its inspection and violation record |

![Building detail: rank, probability, warning signals and the Recalculate on IBM Z button](docs/screenshots/building-panel.jpg)

## 3. How it works

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="ml/reports/figures/architecture_dark.png">
  <img alt="Architecture: NYC Open Data feeds a pipeline on IBM LinuxONE; the model is trained there and served by IBM Snap ML on the NNPA accelerator; the 3D map connects to it securely" src="ml/reports/figures/architecture_light.png">
</picture>

1. **Collect.** We download public records from NYC Open Data and note where and when each one came from.
2. **Describe each building.** For every building we calculate 73 facts ("features") using **only records dated before the day of the prediction**, so the model never peeks at the future:
   - façade history: past ratings, repairs, late or missed filings;
   - DOB façade and structural violations back to 1998;
   - wall-maintenance violations from the Environmental Control Board (ECB);
   - building traits: age, number of floors, lot size, use.
3. **Learn.** The model learns from FISP cycles 7–9 which combinations of facts came before an UNSAFE rating. Its scores are adjusted so that "30%" really means about 30 in 100 such buildings.
4. **Explain.** For each building, the model reports which facts pushed its score up or down.
5. **Serve on IBM Z.** A service on LinuxONE answers requests using the NNPA accelerator. Before switching the accelerator on, it checks that its answers match the original model on 500 buildings.
6. **Show.** The 3D map loads the scores produced on LinuxONE and can ask the live service to re-score any building.

<details>
<summary><b>Technical details</b></summary>

- **Model:** gradient-boosted decision trees (XGBoost), calibrated with Platt scaling. Explanations use TreeSHAP (SHapley Additive exPlanations for tree models).
- **Leakage guard:** a hard check plus unit tests stop any record dated after the decision date from entering the features.
- **Serving:** a FastAPI application programming interface (API) loads the model into IBM Snap ML using the `zdnn_tensors` tree format on the NNPA. If the start-up check fails, it serves with XGBoost on the main processor instead.
- **Frontend:** React, MapLibre and deck.gl.

</details>

## 4. Data

All of these are free public datasets.

| Source | What we use it for |
|---|---|
| [DOB NOW: Façade Compliance Filings](https://data.cityofnewyork.us/d/xubg-57si) (87,000 filings, cycles 6–10) | The **outcomes we predict** (SAFE / SWARMP / UNSAFE) and each building's façade history |
| [DOB Violations](https://data.cityofnewyork.us/d/3h2n-5cm9) | Façade, filing and unsafe-building violations since 1998 |
| [DOB ECB Violations](https://data.cityofnewyork.us/d/6bgk-3dad) | Failure to maintain walls, façade report not filed, sidewalk sheds |
| [NYC Primary Land Use Tax Lot Output (PLUTO)](https://data.cityofnewyork.us/d/64uk-42ks) | Building age, floors, lot size, building type, location |
| [NYC Building Footprints](https://data.cityofnewyork.us/d/5zhs-2jue) | Building shapes for the 3D map |
| Satellite ground-motion data (Interferometric Synthetic Aperture Radar, InSAR) | Background layer on the map |
| [DOB façade risk scores](https://github.com/NYCDOB/FacadeRisk) (2022) | **For comparison only.** We measure ourselves against it; our model does not use it |
| DOB Complaints | Tested; it **did not help**, so it is not used |

## 5. Results

All results come from a **test that respects time**. The model only learned from records before 21 February 2020. We then checked its ranking against what licensed inspectors actually recorded in the 2020–2025 cycle: 13,327 buildings, 25% of them rated UNSAFE.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="ml/reports/figures/precision_at_500_dark.png">
  <img alt="Share of the top 500 buildings later rated UNSAFE: Urban Sentinel 66.0%, logistic regression 58.4%, last-inspection rule 55.4%, NYC DOB published score 40.2%" src="ml/reports/figures/precision_at_500_light.png">
</picture>

| 2020–2025 test (all 13,327 buildings) | PR-AUC (higher is better) | Share of top 500 rated UNSAFE |
|---|---|---|
| Random pick | 0.25 | 25% |
| Simple rule: rank by last inspection result | 0.358 | 56.0% |
| Standard statistical model (logistic regression) on history | 0.389 | 58.2% |
| **Urban Sentinel** | **0.454** | **66.2%** |

Compared with the simple rule, Urban Sentinel finds **10 more truly UNSAFE buildings in every 100 it flags**. Even allowing for chance, the gain is between 5 and 15 per 100 (95% confidence interval, CI). Its PR-AUC is 0.096 higher (95% CI +0.083 to +0.108).

**It finds new problems, not just repeat offenders.** Take buildings whose last rating was SAFE. Of the 250 it ranks riskiest, **38.4%** turned UNSAFE, about twice the 18.3% you'd expect by chance:

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="ml/reports/figures/previously_safe_dark.png">
  <img alt="Previously SAFE buildings: share of the top 250 flagged that turned UNSAFE. Urban Sentinel 38.4%, façade-only model 32.4%, logistic regression 25.2%, rule 20.4%; base rate 18.3%" src="ml/reports/figures/previously_safe_light.png">
</picture>

**Higher scores really mean higher risk.** The 10% of buildings with the highest scores were rated UNSAFE 57% of the time; the lowest 10%, only 7%:

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="ml/reports/figures/cycle9_deciles_dark.png">
  <img alt="Actual UNSAFE rate for each tenth of buildings by predicted risk, falling from 57% in the top tenth to 7% in the bottom tenth" src="ml/reports/figures/cycle9_deciles_light.png">
</picture>

**How we kept it honest**

- **No peeking at the answers.** Three penalty fields in the filings data have no date and are filled in after the inspection. Using them would have made the model look far better than it is (PR-AUC 0.552 instead of 0.379), so we left them out ([audit](ml/reports/leakage_audit.json)).
- **Fair comparisons.** Every method is judged on the same buildings, with the same information. On 12,116 identical buildings, our model beats DOB's 2022 score (PR-AUC 0.461 vs 0.341), even though DOB's model may already have seen these outcomes.
- **Uncertainty reported.** Every comparison comes with a 95% confidence interval, so you can see how much of a gain could be luck.
- **Satellite data tested.** Ground-motion data from satellites did not improve predictions, so it appears on the map as background only.

![Satellite ground-motion layer on the map](docs/screenshots/satellite-layer.jpg)

Full tables: [`ml/reports/RESULTS.md`](ml/reports/RESULTS.md) · What each data source adds: [`ml/reports/ABLATION.md`](ml/reports/ABLATION.md)

## 6. Why IBM Z and LinuxONE

- **Everything runs on LinuxONE.** Downloading data, testing, training the model (about 20 seconds), scoring 13,650 buildings and running the live service all happen on our IBM LinuxONE virtual machine (VM).
- **AI built into the chip.** The IBM Telum processor includes the NNPA accelerator. IBM Snap ML runs our model on it, and its predictions match the original to within **0.00000038 across all 13,650 buildings**, with the identical top 500.
- **Real-time answers.** A live request is scored in **0.122 milliseconds on the NNPA, versus 0.358 milliseconds on the main processor**, about 3 times faster (median of 200 real requests). The full round trip, including gathering the building's latest records, takes about 86 milliseconds. For scoring all buildings at once the main processor is faster, so we use the NNPA for live, one-at-a-time requests.
- **Same answers on any hardware.** An automatic test confirms the mainframe gives the same predictions as a laptop.
- **Secure by default.** The live service is not open to the internet; it can only be reached through an encrypted connection. Retraining requires a password-like token, and no secrets are stored in the code.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="ml/reports/figures/nnpa_latency_dark.png">
  <img alt="Time to score on the LinuxONE machine: one request at a time, Snap ML on the NNPA is several times faster than the main processor; in large batches it is slower; predictions are identical" src="ml/reports/figures/nnpa_latency_light.png">
</picture>

<details>
<summary><b>Technical details and evidence</b></summary>

- **Machine:** Red Hat Enterprise Linux (RHEL) 9.8 on s390x (IBM Z's big-endian processor architecture), running IBM's `jupyterlab-image-s390x` container under Podman.
- **Accelerator library:** IBM Z Deep Neural Network (zDNN) library 1.1.2 confirms the NNPA. Snap ML compiles the trees to the `zdnn_tensors` format.
- **Cross-hardware test:** a parity test checks that predictions match between an arm64 laptop and the s390x mainframe.
- **Security:** the API listens on the VM's local address only and is reached through a Secure Shell (SSH) tunnel.

What the running service reports (`GET /health` on the VM):

```json
"platform": { "machine": "s390x", "byteorder": "big", "platform": "Linux-5.14.0-687.58.1.el9_8.s390x-s390x-with-glibc2.39" },
"inference_engine": { "engine": "snapml-nnpa", "zdnn_version": "1.1.2", "tree_format": "zdnn_tensors",
                      "parity_rows": 500, "parity_max_abs_diff": 2.87e-07 }
```

Raw evidence captured on the VM is in [`ml/reports/linuxone/`](ml/reports/linuxone/README.md). It includes the run record, the s390x evaluation report, the NNPA benchmark, live service responses and timing measurements.

</details>

## 7. Try it

**3D map.** It works offline, using the scores exported from LinuxONE.

```bash
cd frontend && npm ci && npm run dev
```

<details>
<summary><b>Live predictions and the ML pipeline</b></summary>

**Live predictions** (needs access to the team's LinuxONE VM): open an SSH tunnel with `ssh -N -L 8000:127.0.0.1:8000 linux1@<vm>`. The map then switches to the live service, and **Recalculate on IBM Z** scores buildings on the mainframe. Setup steps are in the [LinuxONE runbook](ml/deploy/linuxone/RUNBOOK.md).

**ML pipeline** (laptop or LinuxONE; Python 3.12):

```bash
pip install -r ml/requirements.txt
cd ml && python -m pytest tests -q            # 16 tests, incl. leakage guards and s390x parity
python -m urban_sentinel.pipeline             # download → evaluate → train → score
```

</details>

## 8. Limitations and next steps

**Limitations**
- **We predict what an inspector will record, not whether a building will collapse.** Buildings that never file a report have no recorded outcome, so there are fewer of them in the training data.
- **The map shows Lower Manhattan only.** The model scores 13,650 buildings across the whole city, but the 3D demo covers a smaller area.
- **Some building facts (from PLUTO) are a 2026 snapshot,** not the values at the time of each past prediction. Most of them, like age and size, rarely change. Even without them, the model still beats the simple rule (PR-AUC 0.424).

**Next steps**
- **A citywide map that re-scores automatically** as new filings and violations arrive. The re-scoring endpoint already exists.
- **Field testing with NYC DOB:** compare our shortlist with the buildings inspectors check on their own initiative.
- **Using a large language model (LLM)** to read inspection reports and pull out the types of defects found.
- **Other cities** that have similar façade-inspection laws.

## Repository

| Folder | What's inside |
|---|---|
| [`ml/`](ml/README.md) | Data pipeline, model, evaluation, live service, LinuxONE setup guide, figures and evidence |
| [`ml/insar/`](ml/insar/README.md) | Satellite ground-motion processing |
| [`frontend/`](frontend/README.md) | 3D map (React, MapLibre, deck.gl) |

## Built with

**IBM:** [IBM LinuxONE Community Cloud](https://linuxone.cloud.marist.edu), [IBM Snap ML](https://snapml.readthedocs.io), [zDNN](https://github.com/IBM/zDNN), [jupyterlab-image-s390x](https://github.com/linuxone-community-cloud/jupyter-lab-ml).

**Open source:**
- ML and data: [pandas](https://pandas.pydata.org), [NumPy](https://numpy.org), [scikit-learn](https://scikit-learn.org), [XGBoost](https://xgboost.ai), [matplotlib](https://matplotlib.org), [opera-utils](https://github.com/opera-adt/opera-utils).
- Service: [FastAPI](https://fastapi.tiangolo.com), [Uvicorn](https://www.uvicorn.org).
- Frontend: [React](https://react.dev), [Vite](https://vitejs.dev), [MapLibre GL JS](https://maplibre.org), [deck.gl](https://deck.gl), [react-map-gl](https://visgl.github.io/react-map-gl), [Vitest](https://vitest.dev).

**Data:** NYC Open Data. Satellite data from the National Aeronautics and Space Administration (NASA) Observational Products for End-Users from Remote Sensing Analysis (OPERA) project, via the Alaska Satellite Facility Distributed Active Archive Center (ASF DAAC). Basemap © [OpenFreeMap](https://openfreemap.org) / [OpenMapTiles](https://openmaptiles.org) / [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors.

*Urban Sentinel is a decision-support tool: it ranks buildings for human review. Field inspection by a licensed professional is always required.*
