# Backend gaps and notes

Written during the frontend's pass 1. The backend was not changed.

## Inconsistent error shapes (not blocking)

The frontend reads each shape in one place, `normaliseError` in `src/api/client.ts`. Tidying these on the backend would simplify it.

| Case | Real body | Notes |
|---|---|---|
| 422 validation (predict, location check, hotspots) | `{"errors": [{"field", "message"}]}` | Consistent. Used everywhere. |
| 404 unknown `/api/` path | `{"detail": "Not Found"}` | No `message` key. |
| 503 `/api/predict` and `/api/schema` | `{"loaded": false, "error": "..."}` | Message is under `error`. |
| 503 `/api/health` | `{"status": "error", "error": "..."}` | Message is under `error`, nested in `status`. |
| 503 `/api/hotspots`, `/api/hotspots/meta`, `/api/about` | `{"available": false, "message": "..."}` | Message is under `message`. |

Suggestion: one shape for every error, such as `{"message": "...", "errors": [...]}`, so each 5xx has the same key.

The 503 bodies above were captured in-process with a missing model file, a missing hotspot file and a damaged `about.json`, not from a live outage. See `src/test/fixtures/unavailable_*.json`.

## Planned hotspot endpoints (not built)

The frontend codes against the contract in `src/api/hotspotContract.ts`. Each feature is off until `GET /api/hotspots/meta` reports it under `"features"` as `true`. Until then the UI hides or disables the feature.

### `GET /api/hotspots/meta` adds `features`

```json
{"features": {"bbox": false, "nearby": false, "details": false, "route": false, "months": false, "persistence": false}}
```

### `GET /api/hotspots` optional parameters

- `bbox=west,south,east,north` returns hotspots in the map viewport.
- `month=1..12` filters by month of collision.
- `persistence=any|persistent|recent|fading`. Persistence needs per-year counts for each hotspot.

Without `bbox`, the frontend fetches with `limit=1000` once per filter set and filters the viewport in the browser.

### `GET /api/hotspots/nearby?latitude&longitude&radius_m=500&subset&slice&limit`

Returns hotspots within `radius_m` of the point, ordered by distance, each with `distance_m`. Used by the nearby card on the Assess page. Hidden until `features.nearby` is true.

### `GET /api/hotspots/{id}`

Returns one hotspot plus its profile: `by_year`, `by_month`, `by_time_of_day`, `shares` (each with `label`, `here` and `gb`), `persistence_label` and `years_present`. Used by the details card. Hidden until `features.details` is true.

### `POST /api/hotspots/along-route`

Request: `{"path": [[lat, lng], ...], "buffer_m", "subset", "slice", "month", "min_collisions", "persistence"}`. Response: hotspots ordered along the route, each with `km_from_start`. The frontend simplifies the route to at most 500 points. Used by the route check. Disabled until `features.route` is true.

## Data the hotspot pages need

- Per-hotspot year and month counts (for persistence, the by-year and by-month charts).
- Per-hotspot time-of-day counts beyond the summary.
- Great Britain shares for each category, for the "here against GB" bars.
- Each hotspot's busiest time slice, shown on the nearby card.

## Other notes

- `GET /api/hotspots` returns `count` as the number of hotspots returned after `limit`, not the number matched. The frontend cannot tell that the list was cut short unless `count` equals the limit. With the default filters, the count reached 1,000 for "All times" and "Evening Rush" in both subsets, so those lists may be cut short. We cannot tell whether they hold exactly 1,000 or more. A `total_matched` field would let the map and list say how many are missing.
- A GET to a POST-only endpoint such as `/api/predict` returns the JSON 404 when the frontend is served, not a 405. The SPA fallback is registered last.
- The About endpoint and the coverage check depend on `backend/resources/about.json` and `gb_coverage.npz`. The frontend shows the about text only after it validates.
