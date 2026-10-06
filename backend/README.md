# Backend: collision severity API

This API estimates the severity of a road collision that has **already been reported to the police**: 1 = Fatal, 2 = Serious, 3 = Slight. It is a retrospective police-report tool. It is **not** a pre-collision risk score.

Run every command below from the repo root (`D:\PortFolio\FDM`).

## Set up

```powershell
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
```

## Run

Until the real model arrives, use the stand-in model:

```powershell
.\.venv\Scripts\python.exe tools\make_dummy_model.py
$env:MODEL_PATH = "models\dummy_pipeline.joblib"
.\.venv\Scripts\python.exe -m uvicorn backend.app:app --reload
```

Without a model the app still starts. Every model endpoint returns 503 with the reason, which is the expected state until the real file is in place.

Tests (they build their own stand-in models in a temporary folder):

```powershell
.\.venv\Scripts\python.exe -m pytest
```

Environment variables:

| Variable | Purpose | Default |
|---|---|---|
| `MODEL_PATH` | Path to the pipeline file | `models/rf_classifier_pipeline.joblib` from `resources/model_config.json` |
| `HOTSPOT_PATH` | Path to the hotspot file | `results/spatial_temporal/hotspots.json` |
| `CORS_ORIGINS` | Comma-separated origins allowed to call the API | none |

If `frontend/index.html` exists, the app serves `frontend/` at `/`. Otherwise it serves only the API.

## Drop in the real model

1. Copy the file into place: `Copy-Item <source>\rf_classifier_pipeline.joblib models\`. Do not overwrite it with a stand-in.
2. Install the scikit-learn version that trained the model. The app reports a warning when the versions differ. Check which version was used before you install.
3. Check that the feature derivation matches the training data:
   `.\.venv\Scripts\python.exe tools\check_feature_logic.py <train.csv>`
   It exits non-zero when any check has mismatches.
4. Compute the test metrics and store precision and recall:
   `.\.venv\Scripts\python.exe tools\compute_test_metrics.py <test.csv> --write`
   Check the `--target` column name first (default `collision_severity`). The script warns when its recall differs from the value stored in `model_config.json`.
5. Restart the server. The model is loaded at startup, so a new file is not picked up until a restart.

### What the app checks when it loads the model

- The file must be a scikit-learn `Pipeline` with a `ColumnTransformer` step. The step names do not matter. The encoders and the input column names are found by type.
- A column the model expects that is a casualty flag, or one of `worst_casualty_severity`, `pedestrian_involved`, `enhanced_severity_collision`, `collision_severity`, `number_of_casualties`, is refused and named. So is a column the form cannot produce. The app then starts, and the endpoints return 503 with the reason.
- The model must contain class 1 (Fatal). Its `score_method` must exist on the final estimator.
- Every categorical column must be one-hot encoded, with two exceptions: `trunk_road_flag` may be passed through as a number instead.
- A saved scikit-learn version that differs from the installed one gives one warning.
- Warnings are raised for encoders that do not know the season, time-of-day or day-of-week values the form produces.

### Trunk road

`trunk_road_flag` can reach the model in two ways. The app decides at load time:

- **One-hot encoded in the model:** the field is a dropdown of the encoder's codes, the same as the other categories.
- **Passed through as a number (the real model):** the field is a dropdown from `flag_options` in `backend/resources/model_config.json`. The chosen code is sent as an integer. Codes are DfT's: 1 = Trunk road, 2 = Non-trunk road. A blank field is sent as NaN, and the pipeline fills in the most common value. The field is never hidden. A model that passes it through does not fail to load for that reason.

## API

Use `Invoke-RestMethod` for the examples. The predict examples use the stand-in model's codes (1 to 5). With the real model, copy option values from `GET /api/schema`.

```powershell
# Health and warnings
Invoke-RestMethod http://127.0.0.1:8000/api/health

# The form: groups, fields, options, warnings, and the score settings
Invoke-RestMethod http://127.0.0.1:8000/api/schema

# Predict
$form = @{
    date = "2024-03-15"
    time = "18:30"
    road_type = 3
    speed_limit = "30"
    urban_or_rural_area = 1
    junction_detail = 2
    light_conditions = 1
    weather_conditions = 1
    road_surface_conditions = 1
    number_of_vehicles = 2
    vehicles = @("car", "pedal_cycle")
    driver_ages = "34, 9"
    latitude = 51.5072
    longitude = -0.1276
} | ConvertTo-Json
Invoke-RestMethod -Uri http://127.0.0.1:8000/api/predict -Method Post -ContentType "application/json" -Body $form
```

A `/api/predict` response looks like this:

```json
{
  "severity_code": 3,
  "severity": "Slight",
  "scores": {"Fatal": 0.12, "Serious": 0.38, "Slight": 0.5},
  "adjusted_scores": {"Fatal": 0.18, "Serious": 0.38, "Slight": 0.5},
  "score_kind": "probability",
  "fatal_adjust": 1.5,
  "adjust_mode": "multiply",
  "adjustment_note": "The Fatal probability is multiplied by 1.5 before the result is chosen, so more Fatal collisions are caught.",
  "left_blank": ["Road class", "Junction control"]
}
```

**Validation errors** return HTTP 422 with every problem at once:

```json
{"errors": [{"field": "date", "message": "Enter a valid date."},
            {"field": "number_of_vehicles", "message": "Enter a whole number from 1 to 30."}]}
```

**Unavailable** returns 503. For `/api/health` the body is `{"status": "error", "error": "..."}`. For `/api/schema` and `/api/predict` it is `{"loaded": false, "error": "..."}`.

Rules applied to the form:

- Required: date, time, road layout, speed limit, area type, junction, lighting, weather, road surface, number of vehicles, types of vehicle involved.
- Latitude and longitude must be given together, or both left blank. Latitude 49 to 61, longitude -9 to 2.5.
- Driver ages are whole numbers from 1 to 105. An age under 10 is allowed only when a pedal cycle is ticked.
- The number of vehicles must be at least the number of vehicle types ticked, and there can be at most one driver age per vehicle.
- Fields the loaded model does not use are hidden, and they are not validated.

### Location coverage

The Location fields are checked against a coverage grid, so that a point in Ireland or far from the collision data is flagged. The old box (latitude 49 to 61, longitude -9 to 2.5) also covers Ireland and Northern Ireland, which are not in the data.

**Build the grid** from a collision CSV (only the `latitude` and `longitude` columns are read):

```powershell
.\.venv\Scripts\python.exe tools\build_coverage_grid.py <collisions.csv>
# optional: --out backend\resources\gb_coverage.npz --cell 0.01
```

The tool drops blank coordinates and points outside the box, bins the rest into cells of `--cell` degrees (default 0.01, about 1.1 km by 0.65 km at this latitude), and stores the centre of each occupied cell. It prints the rows used and dropped, the occupied cells, and the file size. Restart the server after building the grid.

**Thresholds** are in `backend/resources/model_config.json` under `location`: `sparse_km` (default 3) and `outside_km` (default 10). The distance is the great-circle distance to the nearest occupied cell centre, measured with a haversine BallTree. Because cells are about 1.1 km by 0.65 km, the distance is accurate to roughly 0.7 km.

| Status | Distance | Effect |
|---|---|---|
| `covered` | up to `sparse_km` | none |
| `sparse` | over `sparse_km`, up to `outside_km` | a warning on predict |
| `outside` | over `outside_km` | a 422 error on `latitude` on predict; `allowed` is false |
| `unchecked` | no grid built, point inside the box | none |

With no grid, the app still starts. Points inside the box are `unchecked`, and points outside it are `outside`. `/api/health` warns: "Coverage grid not built: locations are checked against a coarse box that includes Ireland and Northern Ireland." It also reports `coverage_grid` as `missing` (or `loaded (N cells)` when the grid is present).

**Check one location:**

```powershell
$loc = @{ latitude = 51.5072; longitude = -0.1276 } | ConvertTo-Json
Invoke-RestMethod -Uri http://127.0.0.1:8000/api/location/check -Method Post -ContentType "application/json" -Body $loc
```

```json
{"status": "covered", "nearest_km": 0.0, "message": null, "allowed": true}
```

Missing or out-of-range coordinates return 422 in the usual `{"errors": [...]}` shape.

**Predict** runs the same check when both latitude and longitude are given. Its response always has `warnings` (a list, empty when there is nothing to report) and `location` (`{"status", "nearest_km"}`, or `null` when no location was given). An outside point is refused with a 422 on `latitude`, collected with any other errors. A sparse point returns 200 with the message in `warnings`.

### About

`GET /api/about` returns `backend/resources/about.json`: the model, the data source and licence, the test results with the confusion matrix, and the limits. At startup the file is checked: each confusion-matrix row must sum to its class support, and the splits must sum to the collision count. If the check fails, the endpoint returns 503 and names the problem.

### Hotspots

`results/spatial_temporal/hotspots.json` is the hotspot file. Version 2 is the current format. Version 1 still loads, with the new features off. The profiles file `hotspot_profiles.json.gz` sits next to it and feeds the details and busiest time. The hotspot file comes from `notebooks/spatial_temporal/spatial_temporal_hotspots.ipynb`, as the project notes say. The profiles file has no recorded producer in this repo, so its source is to be confirmed.

The data: HDBSCAN on OSGR metres in 25 km tiles with a 2 km overlap. A hotspot is a compact cluster whose 90th-percentile radius from its centre is at most 500 m. The file has 70,395 hotspots (52,646 All collisions, 17,749 Fatal and Serious). Each hotspot belongs to one view. An "All times" row has `month: null`, a time-of-day row has `month: null` with its slice name, and a month row has `month: 1..12` with slice "All times". A default request returns only `month: null` rows, so month rows never leak into the All times view.

**Endpoints** (all under `/api/hotspots`):

| Method and path | What it does |
|---|---|
| `GET /meta` | Generated time, method, parameters, the feature flags, months, persistence labels and rules, years, and hotspot counts per subset. |
| `GET ?subset&slice&month&persistence&bbox&sort&min_collisions&limit` | The list. `limit` defaults to 200 and goes up to 1,000. Returns `count`, `total_matched` (everything that matches, before `limit`) and `truncated` (`total_matched > count`). |
| `GET /nearby?latitude&longitude&radius_m&subset&slice&month&min_collisions&limit` | Hotspots whose CENTRE is within `radius_m` (50 to 2,000 m) of the point, nearest first, then most collisions. Each item has `distance_m` and `busiest_time` (null without profiles). `limit` is 1 to 50, default 10. |
| `GET /{id}` | One hotspot with its profile: `years`, `months`, `time_of_day`, `shares` (each with `here_pct` and `gb_pct`) and `persistence`. Unknown id: 404 `{"detail": "No hotspot with id N."}`. |
| `POST /along-route` | Body: `{"path": [[lat, lng], ...], "buffer_m": 200, "subset", "slice", "month", "min_collisions", "persistence"}`. Two to 2,000 points, buffer 50 to 1,000 m. A hotspot is returned when its centre is within the buffer of the path. Returns `length_km`, `count`, `truncated`, `hotspots` (ordered by `km_from_start`, at most 5,000) and a `summary` with `hotspots`, `collisions`, `fatal` and `per_10_km`. |

**Filters.** `subset` is `all` or `severe` (Fatal and Serious only). `slice` is "All times" or a time of day. `month` (1 to 12) needs slice "All times". `persistence` is `any`, `persistent`, `recent`, `fading`, `mixed` or `too_few`. `bbox` is `west,south,east,north` in degrees, and the edges are inclusive. `sort` is `collisions` (default), `fatal` or `share` (Fatal and Serious as a share of collisions). Ties go to more collisions, then the lower id.

**Persistence labels** are set in this order: "Too few to judge" for fewer than 8 collisions, then "Persistent" for collisions in at least 4 of the 5 years, then "Recent" for at least 60% of collisions in 2024 and 2025, then "Fading" for at least 60% in 2021 and 2022, otherwise "Mixed". The real file applies "Persistent" before "Recent": 2,484 hotspots meet both and are labelled Persistent.

**Example** (PowerShell):

```powershell
Invoke-RestMethod "http://127.0.0.1:8000/api/hotspots?subset=severe&slice=Evening%20Rush&limit=3"
Invoke-RestMethod "http://127.0.0.1:8000/api/hotspots?subset=all&bbox=-0.3,51.4,0.1,51.6&sort=fatal&limit=20"
$route = @{ path = @(@(51.50, -0.20), @(51.52, -0.10)); buffer_m = 200; subset = "all" } | ConvertTo-Json -Depth 4
Invoke-RestMethod -Uri http://127.0.0.1:8000/api/hotspots/along-route -Method Post -ContentType "application/json" -Body $route
```

**Unavailable data.** A missing hotspot file gives 503 `{"available": false, "message": "Hotspot analysis has not been generated yet."}` on every endpoint. A missing profiles file gives the same 503 on the details endpoint only: nearby still works, with `busiest_time` null, and `features.details` is false. A corrupt file gives 503 with the problem named. A version 1 file gives `features` all false, and the new parameters and endpoints return 422 `not available in this data file`.

**Validation.** A bad request returns 422 `{"errors": [{"field", "message"}]}` with every problem at once. `tools/validate_hotspots.py <file>` checks a file against every rule, and checks the profiles next to it. `tools/check_hotspots_real.py` runs a smoke test against a running backend.

**Hotspot file (version 2)**, one row per hotspot:

```json
{"id": 9031, "subset": "severe", "slice": "Evening Rush", "month": null,
 "latitude": 51.514775, "longitude": -0.141966, "radius_m": 280,
 "collisions": 18, "fatal": 0, "serious": 18, "slight": 0,
 "label": "LSOA E01033595", "years_present": 4, "persistence": "Persistent"}
```

Top level: `version` (2), `generated_at`, `method`, `parameters` (including `persistence_rules`), `subsets`, `slices`, `months`, `persistence_labels` and `features`. `label` is null for areas with no recorded LSOA, such as Scotland.

**Profile file (version 2)**, `hotspot_profiles.json.gz`: `years` (2021 to 2025), `months` (1 to 12), `time_slices` (the five time-of-day names), `share_keys` and `share_labels` (eight each), `baseline_pct` (for `all` and `severe`), and `profiles`, keyed by hotspot id. Each profile holds `y` (5 years), `m` (12 months), `t` (5 time slices) and `s` (8 share counts). `y`, `m` and `t` each add up to the hotspot's collisions. `s[i]` counts the collisions with `share_keys[i]`, so it is 0 to collisions and the eight values can add up to more than the total.

**Performance** (measured on the real files, with the test client): startup, with the hotspot file loaded, 0.67 s. The first details call, which loads the profiles, about 0.96 s. The list p95 is 11 ms, the bbox list p95 22 ms, nearby p95 3.4 ms, details p95 2 ms, and the along-route call with 500 points p95 44 ms.

## Serving the React build

If `frontend/dist/index.html` exists, the app serves `frontend/dist`. Otherwise it serves `frontend/` when `frontend/index.html` exists. Otherwise it serves only the API. Real files are served as files. Any other GET path that does not start with `/api/` returns `index.html`, so client-side routes such as `/hotspots` and `/about` work on refresh. Unknown `/api/` paths return 404 with `{"detail": "Not Found"}`. Because the fallback is registered last, a GET to a POST-only endpoint such as `/api/predict` now returns that 404 instead of a 405.

The Location group in `GET /api/schema` carries `"widget": "location"`, so the frontend can draw a map picker for latitude and longitude. The other groups carry `"widget": null`.

## Confirmed

Evidence from `tools/show_model_input.py` run on the real model (`models/rf_classifier_pipeline.joblib`, no `MODEL_PATH` override):

- **One-hot encoding:** for the example input, all 14 one-hot encoded columns have exactly one output equal to 1. Where a value was given, that 1 is on the output for the chosen code. Blank columns get the most common value.
- **Every dropdown option:** `--all-options` checked 13 select fields and 86 options, one at a time, with 0 failures.
- **Trunk road:** codes 1 and 2 reach the model unchanged, and the pass-through output equals the code. A blank trunk gives the same output as trunk 2, so the model's most common value is non-trunk (code 2).
- **Model file and speed:** 354.1 MB. Loading takes 5.0 s, including the startup checks. For 20 predictions through the same path as `POST /api/predict`, the median is 35.4 ms and the 95th percentile is 68.7 ms.
- **Structure:** 36 input columns, a `Pipeline` with the `num`, `cat` and `flag` groups, and 116 output features. The trunk code is passed through, not one-hot encoded. The classes are 1, 2 and 3.
- **Hotspots:** `results/spatial_temporal/hotspots.json` passes `tools/validate_hotspots.py`. It contains 11,030 hotspots.

## Limits

- Location coverage is only as complete as the collision locations. A remote spot in the Highlands may read as sparse or outside even when it is a valid place to ask about.

- The model is a retrospective police-report tool. Do not describe it as a pre-collision risk score.
- Test-set results, as supplied for this change: Fatal precision 7.28%, recall 40.16%; Serious precision 34.41%, recall 45.77%; Slight precision 84.20%, recall 68.49%; macro F1 42.38%. Most Fatal flags are false alarms: only about 7 in 100 flagged collisions are actually Fatal. Recall is also low, so many real Fatal collisions are missed. The 1.5 weight adds Fatal flags, so the false-alarm share is high.
- These numbers were supplied with the change request. `compute_test_metrics.py` did not reproduce them here, because the test CSV is not on disk.
- Do not quote the "~37%" validation recall from the notebook comment as the test result.
- The 1.5 weight was tuned on the train-only model, using validation data. The saved model was refit on train plus validation, so the weight has not been re-validated on that model.
- A blank optional field is filled with the model's most common value, as learned in training. For the real model that is: first road class A (code 3); junction control "Give way or uncontrolled" (code 4); no pedestrian crossing (code 0); no special site condition (code 0); no carriageway hazard (code 0); trunk road non-trunk (code 2). A blank junction control therefore scores as give way or uncontrolled, even when the collision was not at a junction. This is how the model was trained, and it matters when reading predictions with blank fields.
- The model file is 354 MB. Keep it out of git (`.gitignore` covers `models/*.joblib`) and share it outside the repo, not through the repository.

## To confirm

- The month and hour sin/cos formulas (`2*pi*month/12`, `2*pi*hour/24`). The training notes state them, and they match `features.py`. The notebook was not available to check against the code that produced the training data.
- The scikit-learn and joblib versions used for training. The app warns when the saved scikit-learn version differs from the installed one, but it cannot see the joblib version.
- The training file set. The training notes give 113 columns after preprocessing for the older notebook and 117 for the current one, from the same 36 features. Check which files the saved model was trained on. The app reads categories from the saved file, so it shows what the model learned. A code present in new data but missing from an old model is silently zeroed.
- `has_undocumented_code_33` is always 0 in the form, but it is 1 for 1.3% of training rows. Collisions with that code cannot be entered, so the model receives 0 for them.
- The wording for the trunk options. The codes are confirmed (see Confirmed). `code_labels.json` labels code 1 "Trunk (Roads managed by Highways England)" and code 2 "Non-trunk". The flag options use "Trunk road" and "Non-trunk road", as requested. Choose one wording.
- The 3 km and 10 km coverage thresholds are untested guesses. Check them with real pins before relying on the sparse and outside statuses.
- The coverage grid is only as complete as the collision locations, so a remote Highland spot may read as sparse or outside. Confirm this with real pins.
- Whether a location is checked when the model does not use the Location fields (for example, the pre-collision model). The app checks any point where both coordinates are given.
- The rule that a `severe` hotspot has `slight` = 0 follows from the definition of "severe". It is enforced by the file check. Confirm it matches the clustering notebook.
- The name of the true severity column in the test CSV. The default is `collision_severity`. Pass `--target` if it differs.
- Placeholders for the date and time inputs (`yyyy-mm-dd`, `HH:MM`), and the help text for the vehicle field, were chosen by the backend, not given in the brief.
- The source of the profiles file (`hotspot_profiles.json.gz`). Only the file itself is in the repo.
- The persistence order. The real file applies "Persistent" before "Recent". The spec's rule list does not give an order, so this is taken from the data.
- Route checks accept only points inside the Great Britain box (latitudes 49 to 61, longitudes -9 to 2.5), because the data covers Great Britain only. A route that crosses the sea to France is refused.
- On a version 1 file the `sort` parameter still works, because it needs only the counts, which version 1 has. The month, persistence and bbox parameters, and nearby, details and along-route, give 422.
- `per_10_km` in the route summary is the collisions in the matched hotspots, divided by the route length in tens of kilometres. It is not a rate per traffic volume, which the data does not have.

