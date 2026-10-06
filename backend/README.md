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

### Hotspots

`results/spatial_temporal/hotspots.json` comes from `notebooks/spatial_temporal/spatial_temporal_hotspots.ipynb`. The method is HDBSCAN on OSGR metres, in 25 km tiles with a 2 km overlap. A hotspot is a cluster whose 90th-percentile radius from its centre is at most 500 m. Up to 1,000 hotspots are kept per subset and time slice. The file has 11,030 hotspots, which cover about 7.5% of all collisions and about 10.5% of Fatal and Serious collisions.

The `count` field in `/api/hotspots` is the number of hotspots returned, after `limit`. It is not the number that matched the filters.

```powershell
# Filters: subset (all | severe), slice, min_collisions, limit (max 1000)
Invoke-RestMethod "http://127.0.0.1:8000/api/hotspots?subset=severe&slice=Evening%20Rush&min_collisions=10&limit=200"
Invoke-RestMethod http://127.0.0.1:8000/api/hotspots/meta
```

If the file is missing, both return 503 with `{"available": false, "message": "Hotspot analysis has not been generated yet."}`. A malformed file returns 503 with the same shape and a message that names the problem.

Check a file before the app reads it:

```powershell
.\.venv\Scripts\python.exe tools\validate_hotspots.py results\spatial_temporal\hotspots.json
```

The file contract:

```json
{
  "version": 1,
  "generated_at": "2026-01-01T12:00:00+00:00",
  "method": "DBSCAN",
  "parameters": {"eps_m": 200, "min_samples": 10},
  "subsets": ["all", "severe"],
  "slices": ["All times", "Night", "Morning Rush", "Midday", "Evening Rush", "Evening"],
  "hotspots": [
    {"id": 1, "subset": "severe", "slice": "Evening Rush", "latitude": 51.5, "longitude": -0.12,
     "radius_m": 180, "collisions": 42, "fatal": 1, "serious": 14, "slight": 0, "label": null}
  ]
}
```

- `collisions` must equal `fatal + serious + slight`.
- Coordinates must be inside the UK bounds used by the form.
- `subset` and `slice` must appear in the file's `subsets` and `slices`.
- A `severe` hotspot counts Fatal and Serious only, so its `slight` must be 0.
- Ids must be unique.

For a sample file for trying the endpoints, see `tools/make_sample_hotspots.py`. It writes to a path you give it. It refuses the real path unless you pass `--force`.

## Confirmed

Evidence from `tools/show_model_input.py` run on the real model (`models/rf_classifier_pipeline.joblib`, no `MODEL_PATH` override):

- **One-hot encoding:** for the example input, all 14 one-hot encoded columns have exactly one output equal to 1. Where a value was given, that 1 is on the output for the chosen code. Blank columns get the most common value.
- **Every dropdown option:** `--all-options` checked 13 select fields and 86 options, one at a time, with 0 failures.
- **Trunk road:** codes 1 and 2 reach the model unchanged, and the pass-through output equals the code. A blank trunk gives the same output as trunk 2, so the model's most common value is non-trunk (code 2).
- **Model file and speed:** 354.1 MB. Loading takes 5.0 s, including the startup checks. For 20 predictions through the same path as `POST /api/predict`, the median is 35.4 ms and the 95th percentile is 68.7 ms.
- **Structure:** 36 input columns, a `Pipeline` with the `num`, `cat` and `flag` groups, and 116 output features. The trunk code is passed through, not one-hot encoded. The classes are 1, 2 and 3.
- **Hotspots:** `results/spatial_temporal/hotspots.json` passes `tools/validate_hotspots.py`. It contains 11,030 hotspots.

## Limits

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
- The rule that a `severe` hotspot has `slight` = 0 follows from the definition of "severe". It is enforced by the file check. Confirm it matches the clustering notebook.
- The name of the true severity column in the test CSV. The default is `collision_severity`. Pass `--target` if it differs.
- Placeholders for the date and time inputs (`yyyy-mm-dd`, `HH:MM`), and the help text for the vehicle field, were chosen by the backend, not given in the brief.
