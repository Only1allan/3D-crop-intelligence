// REST + SSE client for the AgriTwin backend (docs/API_CONTRACT.md).
// Base path /api is proxied to http://localhost:8000 by vite.config.js.
// Falls back to the bundled mock (src/mock) when VITE_MOCK=1 or when the
// first /api/health probe fails, so the console demos with no backend.
import mock from '../mock'

const BASE = '/api'
let mode = import.meta.env.VITE_MOCK === '1' ? 'mock' : 'unknown'   // unknown | live | mock
const listeners = new Set()

export const isMock = () => mode === 'mock'
export const getMode = () => mode
export function onModeChange(fn) { listeners.add(fn); return () => listeners.delete(fn) }
function setMode(m) { if (mode !== m) { mode = m; listeners.forEach((fn) => fn(m)) } }

async function http(path, { method = 'GET', body, timeout = 15000 } = {}) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeout)
  try {
    const res = await fetch(BASE + path, {
      method, signal: ctrl.signal,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    })
    const text = await res.text()
    let json = null
    try { json = text ? JSON.parse(text) : null } catch { json = null }
    if (!res.ok) throw new Error(json?.detail || `${res.status} ${res.statusText}`)
    return json
  } finally { clearTimeout(t) }
}

const qs = (o = {}) => {
  const p = Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== '')
  return p.length ? '?' + p.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&') : ''
}

/** Probe the backend once. Returns the health payload with `mock: true` when falling back. */
export async function probe() {
  if (mode === 'mock') return { ...(await mock.health()), mock: true }
  try {
    const h = await http('/health', { timeout: 3500 })
    setMode('live')
    return { ...h, mock: false }
  } catch {
    setMode('mock')
    return { ...(await mock.health()), mock: true }
  }
}

/**
 * Subscribe to a Server-Sent-Events stream. onEvent({ type, data }) per event.
 * Returns a close() function. In mock mode `url` is a run id.
 */
export function subscribe(url, onEvent, { types = EVENT_TYPES } = {}) {
  if (mode === 'mock') return mock.runEvents(url, onEvent)
  const es = new EventSource(url)
  let closed = false
  const close = () => { if (!closed) { closed = true; es.close() } }
  const handle = (type) => (e) => {
    let data = null
    try { data = e.data ? JSON.parse(e.data) : null } catch { data = { text: e.data } }
    onEvent({ type, data })
    if (type === 'done' || type === 'decision' || (type === 'error' && data && data.recoverable === false)) close()
  }
  types.forEach((t) => es.addEventListener(t, handle(t)))
  es.onmessage = (e) => handle(e.type || 'message')(e)
  es.onerror = () => {
    if (closed) return
    if (es.readyState === EventSource.CLOSED) { onEvent({ type: 'error', data: { text: 'Event stream closed by the server before the run finished.', recoverable: true } }); close() }
  }
  return close
}

export const EVENT_TYPES = ['status', 'tool_call', 'tool_result', 'token', 'llm', 'draft', 'awaiting_officer', 'decision', 'message', 'error', 'done']

const live = {
  health: () => http('/health'),
  office: () => http('/office'),
  farms: () => http('/farms'),
  farm: (farmId) => http(`/farms/${encodeURIComponent(farmId)}`),
  createFarm: (body) => http('/farms', { method: 'POST', body }),
  ingestWeather: (farmId) => http(`/farms/${encodeURIComponent(farmId)}/ingest/weather`, { method: 'POST', timeout: 30000 }),
  plot: (plotId) => http(`/plots/${encodeURIComponent(plotId)}`),
  plotRules: (plotId) => http(`/plots/${encodeURIComponent(plotId)}/rules`),
  advisories: (params) => http(`/advisories${qs(params)}`),
  advisory: (id) => http(`/advisories/${encodeURIComponent(id)}`),
  decide: (id, body) => http(`/advisories/${encodeURIComponent(id)}/decision`, { method: 'POST', body }),
  runAgent: (body) => http('/agent/run', { method: 'POST', body }),
  chat: (body) => http('/chat', { method: 'POST', body }),
  run: (runId) => http(`/agent/runs/${encodeURIComponent(runId)}`),
  audit: (params) => http(`/audit${qs(params)}`),
  followups: (params) => http(`/followups${qs(params)}`),
  flags: (params) => http(`/flags${qs(params)}`),
}

const pick = (name) => (...args) => (mode === 'mock' ? mock : live)[name](...args)

export const api = {
  health: pick('health'), office: pick('office'),
  farms: pick('farms'), farm: pick('farm'), createFarm: pick('createFarm'), ingestWeather: pick('ingestWeather'),
  plot: pick('plot'), plotRules: pick('plotRules'),
  advisories: pick('advisories'), advisory: pick('advisory'), decide: pick('decide'),
  runAgent: pick('runAgent'), chat: pick('chat'), run: pick('run'),
  audit: pick('audit'), followups: pick('followups'), flags: pick('flags'),
  /** Subscribe to a run's event stream; returns close(). */
  runEvents: (runId, onEvent) => subscribe(mode === 'mock' ? runId : `${BASE}/agent/runs/${encodeURIComponent(runId)}/events`, onEvent),
}

export default api
