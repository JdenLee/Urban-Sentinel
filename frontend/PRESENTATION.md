# Guided building presentation

This extends merged PR #19's aerial → Street View → landmark photo carousel. Images enlarge in a keyboard-accessible native dialog with previous/next controls, credits and a Street View link. Without a valid browser key (or when Google has no image), the Street View slide is an explicitly labeled link card, never a substitute photograph. Escape closes the viewer, not the building. Swipe, arrow-key, dot and next/previous controls remain.

On a fresh page load **all buildings start gray** and grow from the ground for 2.3 seconds. The camera then sweeps in over 3.6 seconds. Priority colors start fading in 0.9 seconds into that move and finish before arrival—there is no separate color-wait stage. **Start tour repeats the same gray rise → moving color reveal** before the building story. Shared GPU uniforms animate ordinary footprints and modeled landmarks without regenerating geometry; landmark crowns are neutral during the rise too.

During the demo's building close-up, selection color and the pin wait for the actual camera `moveend` event, not a guessed timer. Stopping or restarting cancels that pending selection. The ringed marker drops over 0.9 seconds, makes a small 0.8-second landing bounce, then hovers over a 2.8-second cycle. Its thin axis stays anchored through the building. Hover freezes at the official-records pause and while the page is hidden; reduced motion and 2D use a static marker. Camera moves use smooth start/stop easing without increasing their durations. Map gestures, selection, 2D or starting the demo cancel the startup entrance.

Building facts stay visible. Units are **total units**, with residential units separately noted; MapPLUTO class/land use supplies the use label and icon. Multi-building lots retain the “on lot” and “tallest” qualifiers. A missing value is not shown as zero. Utility and transportation classes are distinct; ambiguous condos are not assumed residential.

The Summary probability uses a compact, flattened speedometer: a single-colour arc matching the percentage, 0/50/100% labels, a gently sweeping needle and a large percentage. Only the dial geometry is compressed vertically; the labels and percentage retain their normal size. Needle position follows the real probability; the existing priority chip is unchanged (exported tiers may be rank-based, so the arc is not a set of category thresholds). Reduced motion disables the sweep. Non-probability scores retain their existing score display; invalid probabilities never become a zero reading.

Selecting a building flies to it, then orbits at 2.5 degrees/second. Pause, drag, zoom, 2D, closing the panel, or Escape stops the camera orbit. Reduced-motion preferences disable orbit. The mark and favicon use a simple Empire State-inspired setback silhouette. Glass surfaces have translucent backgrounds and bright edges, with an opaque reduced-transparency fallback.

## Before recording

1. Start the existing LinuxONE API using `ml/deploy/linuxone/RUNBOOK.md`. Do not expose its port publicly.
2. Open your existing SSH tunnel (replace placeholders with your configured instance/key):

   ```sh
   ssh -i /path/to/existing-key -N -L 127.0.0.1:8000:127.0.0.1:8000 \
     -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 -o ServerAliveCountMax=3 \
     linux1@YOUR_LINUXONE_HOST
   ```

3. In another terminal, check `curl http://localhost:8000/health`. The service must report `s390x` to establish IBM Z execution; NNPA is used only if its existing parity check enables it. XGBoost fallback is explicitly labeled CPU.
4. In `frontend/.env.local`, keep `VITE_API_URL=http://localhost:8000` (or your configured service URL). Never commit keys. For embedded Street View, configure the existing `VITE_GOOGLE_MAPS_KEY` with Street View Static API and HTTP-referrer restrictions. Without it, aerial/landmark photos and the external Street View link still work.
5. Run `npm ci` if needed, then `npm run dev -- --host 127.0.0.1`. Open http://127.0.0.1:5173/, allow the entrance and tiles to finish, and choose **Show controls → Start tour**. Use 1280×720 or larger. Backgrounding stops an actively playing tour; the presenter-controlled pauses stay intact.

If SSH reports `Broken pipe`, the connection dropped; that does not establish that the API stopped. Reconnect the tunnel with the keep-alive options above. If the key is encrypted, unlock it in your own terminal with `ssh-add /path/to/existing-key`; never paste the passphrase or key into chat, source, or saved outputs. See [LINUXONE_LIVE.md](LINUXONE_LIVE.md) for targeted checks.

## 41 seconds of active narration + inference/chart waits + records pause

| Seconds | Suggested narration |
| --- | --- |
| 0–2.3 | Gray buildings grow out of the ground; the camera stays wide. |
| 2.3–6 | Swoop into the first city view. Colors fade in during the move (3.2–5.4). “Municipal records help us rank where to inspect first.” |
| 6–10.5 | Fly to the priority building without a premature selection highlight or pin. |
| 10.5–11 | On actual camera arrival, highlight the building and begin the pin drop. |
| 11–13 | “This is an estimated UNSAFE façade filing probability—not collapse risk.” |
| 13–15 | “Here is the real aerial image, with the footprint outlined.” |
| 15–17.5 | “And the street-level view.” Embedded Google image when configured; otherwise a link card, not invented imagery. |
| 17.5–19 | “Floors, total units and use come from NYC records.” Keep multi-building lot caveats. |
| 19: automatic inference | The tour starts **Run on LinuxONE** automatically, once per run. The old live result is cleared; a loading card appears before the new result. The tour resumes when the result or explicit error arrives. **Skip live step →** goes directly to explanations (26 s), cancelling any pending request/reveal. No click is needed. |
| 19–26 | “Now we have recomputed one score on the configured service.” Read the actual returned engine, machine and timing; if unavailable, say so. |
| 26–30 | “These signed contributions explain the loaded export.” They are log-odds, not causal effects or percentage points. |
| 30–33 | “These are actual filing dates, showing whether the recorded rating changed.” The chart uses real calendar spacing, not cumulative record count as risk. |
| 33: automatic chart wait | The clock holds while the visible dots and connecting lines finish drawing, then the model prediction fades in on the right. No click needed. |
| 33–35.5 | Read the completed history → prediction graphic for 2.5 active seconds before scrolling to official records. |
| 35.5–37 | “Check the underlying official NYC records.” The links open automatically into view. |
| 37: paused | Open links, inspect records, or switch panel tabs at your own pace. The clock, orbit and hovering pin stay still, including when you open another tab. |
| Finish tour → | After you click, the final overview plays and the tour ends (41 active seconds total). Stop/Escape also leaves the current section available. |

The exact scored address 707 FDR Drive is preferred when available. In the current export it is absent; the tour therefore uses the actual #1: **709 F D R DRIVE**, BIN **1078054**. The address is never silently changed to 707.

## Live inference and limits

At the 19-second step, the tour automatically starts live inference without requiring a click. It holds the narration clock while the real request and presentation reveal finish, then continues automatically. The strip says **Running live prediction…** and keeps **Skip live step →** available. The controls button reads **Start tour** when idle and **Tour in progress** while active. The official-records pause still waits for **Finish tour →**. Outside the tour, Run on LinuxONE remains a manual button.

The automatic step sends one `POST /score/{bin}?engine=auto` request per tour run/building. Rerenders do not repeat it; a new tour run can request again. The loading-to-result transition lasts at least 1.8 seconds from request initiation; fast responses say “Response received · preparing result” while waiting to reveal. Slower responses receive no extra delay. This is presentation pacing, not server execution time: all displayed hardware and timing values come from the real response. A 6.5-second request deadline prevents an offline tunnel from stalling the tour; manual requests outside the tour have a 15-second deadline. Stop, skip, building changes and unmount cancel pending requests/reveals. After a result or explicit error, the tour resumes and leaves seven active seconds to discuss it. Successful responses must contain valid probability, timing, engine, architecture and model fields. Saved predictions are never passed off as a live result. The map, rank and contribution charts remain the loaded export and are labeled accordingly.

The live step demonstrates execution, not a new scientific result: `serve.py` loads the model and municipal context at service startup; `/score/{bin}` rebuilds features with today's cutoff from that cached context and runs inference. It does not download NYC records or retrain. With unchanged inputs/model/cutoff it should reproduce the saved result (within numerical precision). Changed data, time-derived features or model can change it. Saved predictions let the map remain fast and usable offline.

History charts show recognized SAFE/SWARMP/UNSAFE FISP ratings only. Dots fade/scale into view progressively, then connecting lines draw on. The reveal waits until the chart enters the panel viewport. At 33 active seconds, the tour waits for the actual CSS animation completion promises (dots and line masks), then leaves 2.5 active seconds to read the finished chart. Reduced motion shows the chart immediately; missing ratings do not strand the tour. Stop, hiding/replacing the chart and replay cancel pending completion callbacks. Calendar positions remain fixed as the replay advances. Unknown ratings and conflicting same-day records have no question-mark markers: dashed connections bridge those gaps between known ratings, with a caption explaining that condition in between is unknown. Solid connections join consecutive rated filings. These are visual links, not continuous measurements or inferred ratings; the condition-summary logic still requires comparable consecutive filings to describe a change. Complaints and rising record counts are not condition ratings. No future filing is shown at an earlier replay date. “Worse” means more concern in the last comparable filing, not a current engineering diagnosis. Saved history may be incomplete; use official records for the latest information.

History cards use a tinted background, border, heading and labeled badge: teal for SAFE, amber for SWARMP, red for UNSAFE. Colour follows the recorded rating, independently of trend direction: an improved-but-still-SWARMP filing remains amber. A last-known rating keeps its explicit missing-record caveat; conflicting or absent ratings remain neutral. The chart's three rating lanes carry matching subtle tints.

When a valid probability is available, the same history graphic includes a shaded **Predicted · Next filing** area on the right. The percentage and diamond marker use a separate 0–100% scale and the Summary's single accent colour; they never become a fourth recorded-condition dot. It predicts an UNSAFE rating among next Initial FISP filings, not collapse or an inspected condition today. This is the loaded building prediction, not the preceding live request; the export generation date is labeled as such and omitted when unavailable for that prediction. Synthetic inputs are labeled synthetic. The model value is withheld during earlier replay cutoffs and revealed at the end, after the historical lines finish. Missing probabilities are never replaced with ranking scores. The tour also awaits this 420ms reveal before its 2.5-second reading beat.

Actual IBM/NNPA execution was verified through the team's existing SSH tunnel on **2026-10-18 at 05:23 UTC**: `/health` reported s390x, `snapml-nnpa`, `zdnn_tensors`, 500 parity rows and a maximum difference of `2.583342528783561e-7`. Scoring BIN 1078054 returned probability `0.8792`, model `caaf2755a8edc35c`, `0.1214 ms` inference and `96.16 ms` including feature preparation. Those are one request's observed timings, not an aggregate benchmark. The server was already running; only the laptop tunnel needed restoration. No remote model, dependency, credential, or API contract was changed.

Embedded Google Street View and its enlarged image dialog were verified locally for BIN 1078054 on **2026-10-18**, after configuring the team's browser key in Git-ignored `frontend/.env.local`. No key value or keyed image URL is saved in this guide. Website/API restrictions must be managed in Google Cloud; a browser key is visible to browser clients even when its configuration file is ignored by Git. The external fallback, aerial and Wikimedia carousel paths were also checked. Local frontend tests alone do not establish IBM execution; the successful service response above does.

## Verification

- `npm run build`, `npm test`, `git diff --check`.
- Integrated-prediction update: 179 tests pass and the production build succeeds. Coverage includes exact probability/marker values, independent scales, preserved historical dots and gaps, 0%/100% endpoints, invalid/missing values and dates, synthetic labeling, empty history and replay cutoffs. A full 1280×720 browser tour showed the prediction hidden while the history lines drew, then revealed the loaded 88% prediction with its 2026-10-18 generation date before continuing to official records. No API or model artifacts changed.
- Connected-history update: 165 tests pass and the production build succeeds. Tests cover dashed bridges across unrated/conflicting filings, unchanged calendar positions/cutoffs, waiting for every animation promise, cancellation, reduced-motion completion and the fallback duration. Two full 1280×720 browser runs held the clock at 33 s while line masks were drawing, resumed only when both masks reached their completed state, then reached the official-records pause. The completed chart visibly connects SAFE → SWARMP → UNSAFE, with the last connection dashed. Finish tour and replay also worked.
- Automatic-tour update: 158 tests pass and the build succeeds. New tests cover once-per-run startup, cancellation before initiation, Strict Mode effect cleanup, replay and manual-request deduplication. A hands-free browser run returned a genuine s390x/NNPA result (87.92%, 0.122 ms model inference, 91 ms including feature preparation), then continued into explanations. These are one request's timings, not a benchmark. The previous skip-cancellation, official-records pause and Finish tour behavior remain intact.
- Loading/history update: 132 tests pass, including reveal pacing/cancellation, stable calendar positions, absence of question-mark markers, gap preservation and cutoff limits. Browser checks at 1280×720 verify presenter-controlled inference, a genuine s390x/NNPA response, automatic continuation, and staged chart opacity/line drawing.
- Gauge/rating-colour update: 146 tests pass and the production build succeeds. New coverage checks 0/50/100% needle positions, fractional probabilities, invalid-value handling, single-accent arc styling and rating colours independent of trends. At 1280×720, 1 Centre Street displays its 70.94% value as 71%; real historical UNSAFE, SWARMP and SAFE states were checked along with neutral missing data. No new physical-device or assistive-technology validation was performed.
- Unit coverage: deterministic cue ordering; gray rise before camera approach; color reveal during the first zoom; camera-arrival selection and cancellation; continuous landing-bounce/hover bounds; gray context/scored/landmark layers; aerial then Street View; one inference cue; pause before finale; smooth rise/pin bounds; rating improvement/deterioration/unknown/conflicting dates; cutoff invariants; preferred/fallback addresses; observed-date indices; frame-rate-independent orbit; class/land-use labels; inference validation, network errors and request cancellation.
- Browser checks: 1280×720 desktop and 390×844 mobile; direct building selection, pause/resume, zoom interrupt, enlargement and Escape focus behavior, aerial/photo carousel navigation, automatic panel tabs/scrolling, live-service failure, dated history and official records.
- Reduced-motion/transparency branches are implemented; actual assistive technology, touchscreen hardware and low-powered GPU performance remain unverified. The scripted browser inference succeeded on NNPA/s390x (87.92%, 0.123 ms model / 90 ms including features on that separate request).

The 2026-10-18 integration pass upgrades Vitest. The existing MapLibre advisory still requires a coordinated map/overlay upgrade before public deployment; see `REDESIGN.md`.
