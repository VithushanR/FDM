# Road safety estimator: frontend

The React web app for the road safety project. It has three pages: **Assess** (estimate a collision's severity, pick a location, get a printable report), **Hotspots** (the second build pass) and **About** (the model's results and limits).

The estimate is for a collision that has already been reported. It is not a pre-collision risk score.

## Setup

You need Node 20 or later and the backend running.

```powershell
cd frontend
npm install
Copy-Item .env.example .env.local
# edit .env.local and set VITE_GOOGLE_MAPS_API_KEY
```

Start the backend in one terminal (from the repo root):

```powershell
.\.venv\Scripts\python.exe -m uvicorn backend.app:app --port 8000
```

Start the frontend in another:

```powershell
npm run dev
```

Open http://localhost:5173. The dev server proxies `/api` to the backend.

## Environment variables

Set these in `frontend/.env.local`. The file is git-ignored. `.env.example` lists them.

| Variable | Purpose | Default |
|---|---|---|
| `VITE_GOOGLE_MAPS_API_KEY` | Maps JavaScript, Places (New), Geocoding and Routes. Without it the page shows coordinate inputs only. | none |
| `VITE_GOOGLE_MAP_ID` | Map ID for styling. | `DEMO_MAP_ID` |
| `VITE_API_TARGET` | Where the dev server proxies `/api`. | `http://127.0.0.1:8000` |

Never commit the key. The key is used in the browser, so restrict it to your referrers (localhost:5173, localhost:8000 and 127.0.0.1:8000).

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` | Vite dev server on port 5173, proxying `/api`. |
| `npm run build` | Typechecks, then builds to `dist/`. |
| `npm run preview` | Serves the built `dist/`. |
| `npm run typecheck` | `tsc --noEmit`, strict mode. |
| `npm run lint` | ESLint with typescript-eslint (strict) and jsx-a11y. |
| `npm test` | Vitest with React Testing Library, MSW and axe. |
| `npm run gen:api` | Regenerates `src/api/openapi.ts` from the running backend's `/openapi.json`. |

## Serving the built app

`npm run build` writes `dist/`. The backend serves it at http://127.0.0.1:8000/ when `dist/index.html` exists. Client-side routes such as `/hotspots` and `/about` return `index.html`, so refreshing them works. Restart the backend after a build.

## Regenerating the API types

The types come from the backend's OpenAPI document. To regenerate them after a backend change:

1. Start the backend on port 8000.
2. Run `npm run gen:api`.
3. Run `npm run typecheck` to find code that uses changed fields.

The hotspot endpoints that are not built yet are typed by hand in `src/api/hotspotContract.ts`, so their field names are easy to change.

## Where things are

- `src/api/`: `client.ts` (the only place that knows the backend's error shapes, through `normaliseError`), `endpoints.ts`, `openapi.ts` (generated), `useLoad.ts`, `hotspotContract.ts`.
- `src/maps/`: interfaces (`types.ts`), Google implementations (`google.ts`, `GoogleMapCanvas.tsx`) and the context that hands them to the pages (`MapsContext.tsx`). Tests use fakes.
- `src/state/`: the Assess state (`assessStore.tsx`), the request payload and error mapping (`payload.ts`), the result arithmetic (`resultMath.ts`) and label lookup (`labels.ts`).
- `src/components/`: the framed card, fields, status boxes, the location picker, the place search, the result sign and the report.
- `src/pages/`: Assess, Hotspots (placeholder) and About.
- `src/styles/`: design tokens, global styles, the app layout and the print stylesheet.
- `src/test/`: MSW handlers and setup, fixtures captured from the live backend, and fake maps.
- `docs/backend-gaps.md`: the endpoints the hotspot pages need, and the error shapes that could be tidied on the backend.

## Tests

`npm test` runs the suite. The fixtures in `src/test/fixtures/` were captured from the live backend:

- `schema`, `about`, `health`, `hotspots_meta`: `GET` responses.
- `predict_standard`, `predict_invalid`, `location_london`, `location_belfast`, `hotspots_severe_evening_rush`, `hotspots_bad_slice`, `not_found`: from the running backend.
- `unavailable_*`: the 503 bodies, captured by running the real app in-process with a missing model file, a missing hotspot file, or a damaged `about.json`.

Tests never call Google. They use `FakeCanvas`, a fake place search and a fake geocoder.

## Known limits

- The 500 m ring around the Assess pin is solid at low opacity, not dashed. Google circles cannot be dashed.
- Google Places, Geocoding and the maps have not been exercised against the live key. The test suite uses fakes.
- The route check is disabled. It needs the along-route endpoint, which the backend does not provide yet.
- The details card shows the stat tiles only. The year, month and time-of-day charts, persistence pills and the Great Britain share bars need the details endpoint.
- The Month filter and the Persistence filter are disabled until the backend reports those features.
- The list is limited to 1,000 hotspots per request. The API returns only a count, so the page can show the truncation notice only when the count reaches the limit.
- The hover card sits in the map corner, not beside the circle.
- The nearby hotspot card on the Assess page and the hotspot circles around the pin stay hidden until the backend reports the nearby feature.
