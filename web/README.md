# web/ — Crop Intelligence · Advisory Desk (Vite + React)

The extension-officer console: a landing page, a 3D digital twin per farm
(`/twin`) with an Advisory tab where the agent drafts and the officer decides,
an office-wide desk (`/desk`) with the queue, follow-ups, flags and the audit
log, and the Lab page with the real 3D data.

## Run

```bash
cd web
npm install
npm run dev                       # http://localhost:5173  (proxies /api → http://localhost:8000)
npm run build && npm run preview  # production check on :4173
```

## Backend and mock mode

The browser only talks to the FastAPI bridge described in
`../docs/API_CONTRACT.md` (REST + Server-Sent Events under `/api`). Vite
proxies `/api` to `http://localhost:8000` in dev and preview.

Mock mode (no backend needed) is used when either:

* `VITE_MOCK=1` is set (see `.env.example`), or
* the first `GET /api/health` fails (timeout 3.5 s).

The mock lives in `src/mock/` (`farm_demo.json` is a copy of
`../fixtures/farm_demo.json`, plus a canned rule engine, run traces, chat
answers, follow-ups, flags and audit entries). An amber chip
"Mock data · backend offline" is shown in the twin and desk headers.

## Where things are

| Path | What |
|---|---|
| `src/lib/api.js` | fetch wrappers for every contract route, `subscribe(url, onEvent)` over `EventSource`, mock switching |
| `src/state/TwinContext.jsx` | office, farms, selected farm, plots (normalised), advisories, refresh/register/decide |
| `src/pages/Twin.jsx` | 3D scene, farm switcher + register modal, plot list, Insights / Advisory / Ask tabs |
| `src/twin/AdvisoryPanel.jsx` | draft run → live run trace → draft card with citations → officer decision |
| `src/twin/ChatPanel.jsx` | officer chat via `POST /api/chat` + SSE |
| `src/twin/Advisory.jsx` | shared chips, draft card, citations, run trace, decision form/view |
| `src/pages/Desk.jsx` | queue / approved / rejected, follow-ups, flags, audit timeline |
| `src/data/zones.js` | metric vocabulary only (stages, textures, metric metadata) |

`/twin-assets/*` (splat viewers, Pheno4D) is served from `../docs` by a small
plugin in `vite.config.js` and copied into `dist/` at build time.

Keyboard: `1`–`n` select plots, `Esc` clears, `I` / `A` / `K` switch the right
panel tabs.
