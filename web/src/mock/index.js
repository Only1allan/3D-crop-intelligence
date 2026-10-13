// Bundled mock of the AgriTwin API (docs/API_CONTRACT.md). Used when
// VITE_MOCK=1 or when /api/health cannot be reached, so the console is fully
// demoable without the backend. Everything here is in-memory and canned.
import seed from './farm_demo.json'

const TODAY = '2026-09-27'
const NOW = () => new Date().toISOString()
const clone = (x) => JSON.parse(JSON.stringify(x))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const LATENCY = 120

const MODEL = { provider: 'openrouter', model: 'google/gemma-4-26b-a4b-it:free', openWeights: true }
const OFFICE_SHORT = 'Ol Kalou Extension Office'

// ---------------------------------------------------------------- state
const S = {
  office: clone(seed.office),
  farms: clone(seed.farms),
  plots: clone(seed.plots).map((p) => ({ ...p, zoneId: p.zoneId || p.plotId, plotId: p.plotId || p.zoneId, flags: [], pendingAdvisoryId: null, latestAdvisoryStatus: null })),
  advisories: {},
  audit: [],
  followups: [],
  flags: [],
  runs: {},
  seq: { adv: 3, run: 0, audit: 0, flag: 2, fu: 2, farm: 1, thread: 0 },
}

const plotOf = (id) => S.plots.find((p) => p.plotId === id)
const farmOf = (id) => S.farms.find((f) => f.farmId === id)

function audit(entry) {
  S.audit.unshift({ id: ++S.seq.audit, ts: NOW(), ok: true, durationMs: 4 + Math.round(Math.random() * 20), ...entry })
}

// ---------------------------------------------------------------- rule engine (mirrors agritwin rules, no LLM)
const hoursSince = (iso) => (new Date(`${TODAY}T09:00:00Z`) - new Date(iso)) / 36e5

function cite(plot, field, value, unit, attr, extraSource) {
  return { field, value, unit, source: extraSource || `plot ${plot.plotId} twin state (${plot.source?.model || 'synthetic'}, ${attr})`, observedAt: plot.lastUpdateTime }
}

export function evaluate(plot) {
  const findings = []
  const s = plot.soil || {}, c = plot.crop || {}, a = plot.agronomy || {}, at = plot.atmosphere || {}
  if (plot.status === 'unknown' || !plot.lastUpdateTime) {
    return { plotId: plot.plotId, primaryAction: 'check_sensor', blocked: { reason: 'no_readings', detail: 'no twin readings ingested yet for this plot' }, findings, profile: 'potato@1' }
  }
  if (plot.status === 'offline' || hoursSince(plot.lastUpdateTime) > 48) {
    return { plotId: plot.plotId, primaryAction: 'check_sensor', blocked: { reason: 'stale_readings', detail: `probe offline since ${plot.lastUpdateTime}` }, findings, profile: 'potato@1' }
  }
  if (a.simcastBlightRisk === 'high' || a.simcastBlightRisk === 'severe') {
    findings.push({ ruleId: 'potato.blight.spray_window', action: 'spray', severity: 'critical',
      reasoning: `SimCast blight risk is ${a.simcastBlightRisk} with relative humidity ${at.relativeHumidity}% after ${at.precipitation} mm of rain, and the canopy is in ${c.growthStage}. A protectant spray within 24 h is advised; a regional late-blight bulletin is active for this stage.`,
      citations: [cite(plot, 'agronomy.simcastBlightRisk', a.simcastBlightRisk, 'band', 'cropModel:simcastBlightRisk'), cite(plot, 'atmosphere.relativeHumidity', at.relativeHumidity, '%', 'farmSensor:relativeHumidity'), cite(plot, 'atmosphere.precipitation', at.precipitation, 'mm', 'farmSensor:precipitation'),
        { field: 'alerts[0].severity', value: 'high', unit: 'severity', source: 'pest bulletin PA-2026-41-01 (synthetic, county plant-health desk)', observedAt: '2026-09-26T06:00:00Z' }] })
  }
  if (s.soilMoisture < 18 && ['tuber_initiation', 'tuber_bulking'].includes(c.growthStage)) {
    const sm = plot.series?.soilMoisture || []
    const fc7 = Math.round(rainfall(plot).forecast.reduce((t, d) => t + d.mm, 0) * 10) / 10
    findings.push({ ruleId: 'potato.irrigation.dry_at_initiation', action: 'irrigate', severity: 'warning',
      reasoning: `Soil moisture ${s.soilMoisture}% VWC is below the 18% floor during ${c.growthStage.replace('_', ' ')}${sm.length ? ` and has fallen from ${sm[0]}% over 7 days` : ''}. The 7-day Open-Meteo forecast gives ${fc7} mm, so rain will not close the gap.`,
      citations: [cite(plot, 'soil.soilMoisture', s.soilMoisture, '% VWC', 'farmSensor:soilMoisture'), ...(sm.length ? [cite(plot, 'series.soilMoisture[0]', sm[0], '% VWC', 'farmSensor:soilMoisture')] : []),
        { field: 'signals.rainfall.forecast.total7d', value: fc7, unit: 'mm', source: 'open-meteo forecast for farm coordinates', observedAt: `${TODAY}T07:00:00Z` }] })
  }
  if (plot.soilPH < 5.5) {
    findings.push({ ruleId: 'potato.soil.acidic_lime', action: 'lime', severity: 'warning',
      reasoning: `Soil pH ${plot.soilPH} is below the 5.5 floor of the potato optimum and exchangeable aluminium is ${s.aluminiumLevel} cmol/kg. Agricultural lime between seasons is the standard correction; P (${s.phosphorusLevel} ppm) and K (${s.potassiumLevel} cmol/kg) are also low.`,
      citations: [cite(plot, 'soilPH', plot.soilPH, 'pH', 'farmSensor:soilPH'), cite(plot, 'soil.aluminiumLevel', s.aluminiumLevel, 'cmol/kg', 'farmSensor:aluminiumLevel'), cite(plot, 'soil.phosphorusLevel', s.phosphorusLevel, 'ppm', 'farmSensor:phosphorusLevel')] })
  }
  if (c.growthStage === 'maturation' && c.daysAfterPlanting >= 90) {
    findings.push({ ruleId: 'potato.harvest.window', action: 'harvest', severity: 'info',
      reasoning: `Day ${c.daysAfterPlanting} after planting at ${c.accumulatedGDD} GDD; NDVI ${c.ndvi} shows normal senescence. Harvest window opens in about two weeks; dehaulm 10–14 days before lifting.`,
      citations: [cite(plot, 'crop.daysAfterPlanting', c.daysAfterPlanting, 'days', 'farmZone:daysAfterPlanting'), cite(plot, 'crop.accumulatedGDD', c.accumulatedGDD, 'GDD', 'farmZone:accumulatedGDD'), cite(plot, 'crop.ndvi', c.ndvi, 'index', 'farmZone:ndvi')] })
  }
  if (!findings.length) {
    findings.push({ ruleId: 'potato.general.hold', action: 'hold', severity: 'info',
      reasoning: `All readings are inside their bands: moisture ${s.soilMoisture}% VWC, pH ${plot.soilPH}, NDVI ${c.ndvi}, blight risk ${a.simcastBlightRisk}. No intervention this week; keep the current plan.`,
      citations: [cite(plot, 'soil.soilMoisture', s.soilMoisture, '% VWC', 'farmSensor:soilMoisture'), cite(plot, 'soilPH', plot.soilPH, 'pH', 'farmSensor:soilPH'), cite(plot, 'crop.ndvi', c.ndvi, 'index', 'farmZone:ndvi')] })
  }
  const order = { critical: 0, warning: 1, info: 2 }
  findings.sort((x, y) => order[x.severity] - order[y.severity])
  return { plotId: plot.plotId, primaryAction: findings[0].action, blocked: null, findings, profile: 'potato@1' }
}

function messageFor(plot, action) {
  const s = plot.soil || {}, c = plot.crop || {}, at = plot.atmosphere || {}, a = plot.agronomy || {}
  const who = plot.householdName?.split(' ')[0] || 'Farmer'
  const where = plot.displayName
  switch (action) {
    case 'spray': return `${who}, ${where}: late-blight risk is HIGH (humidity ${at.relativeHumidity}%, ${at.precipitation} mm rain). Spray a protectant fungicide within 24 h and scout lower leaves for brown lesions. Keep tubers covered. - ${OFFICE_SHORT}`
    case 'irrigate': return `${who}, ${where}: soil moisture is ${s.soilMoisture}% (below 18%) during tuber initiation and no useful rain is forecast this week. Irrigate within 2 days if the shared pump is available; aim for 20 mm. - ${OFFICE_SHORT}`
    case 'lime': return `${who}, ${where}: soil test shows pH ${plot.soilPH} (too acidic) with high aluminium. Apply agricultural lime (about 1 t/acre) after harvest and before the next planting. P and K are low; plan DAP at planting. - ${OFFICE_SHORT}`
    case 'harvest': return `${who}, ${where}: crop is at day ${c.daysAfterPlanting}, maturing normally. Cut the haulms in 10-14 days and plan harvest around early October. No spray needed. - ${OFFICE_SHORT}`
    default: return `${who}, ${where}: readings are in range this week (moisture ${s.soilMoisture}%, pH ${plot.soilPH}, blight ${a.simcastBlightRisk}). No action needed; keep the current plan. Next check in 7 days. - ${OFFICE_SHORT}`
  }
}

function buildAdvisory(plot, rules, runId) {
  const id = `ADV-${String(++S.seq.adv).padStart(4, '0')}`
  const top = rules.findings[0]
  return {
    advisoryId: id, plotId: plot.plotId, farmId: plot.farmId, householdId: plot.householdId, householdName: plot.householdName,
    contactMethod: plot.contactMethod, action: rules.primaryAction, message: messageFor(plot, rules.primaryAction),
    reasoning: rules.findings.map((f) => f.reasoning).join(' '),
    citations: rules.findings.flatMap((f) => f.citations), findings: rules.findings,
    status: 'draft', createdAt: NOW(), runId, drafter: { kind: 'llm', ...MODEL }, decision: null, _topRule: top.ruleId,
  }
}

function linkAdvisory(adv) {
  S.advisories[adv.advisoryId] = adv
  const p = plotOf(adv.plotId)
  if (!p) return
  p.latestAdvisoryStatus = adv.status
  p.pendingAdvisoryId = adv.status === 'draft' ? adv.advisoryId : null
}

// ---------------------------------------------------------------- seed advisories, follow-ups, flags, audit
function seedHistory() {
  const a3 = plotOf('A3'), a2 = plotOf('A2'), b1 = plotOf('B1')
  const adv1 = { ...buildAdvisory(a3, evaluate(a3), 'run-20260927-a3f1'), advisoryId: 'ADV-0001', createdAt: `${TODAY}T06:12:40Z` }
  const adv2 = { ...buildAdvisory(a2, evaluate(a2), 'run-20260926-c2e9'), advisoryId: 'ADV-0002', createdAt: '2026-09-26T07:40:12Z', status: 'approved',
    decision: { officerName: 'Amina Wekesa', decision: 'approve', reason: 'Matches the lab result from 18 Sept.', decidedAt: '2026-09-26T08:02:30Z',
      dispatch: { simulated: true, channel: 'ussd', to: 'H-002', sentAt: '2026-09-26T08:02:31Z', text: messageFor(a2, 'lime') } } }
  const adv3 = { ...buildAdvisory(b1, evaluate(b1), 'run-20260925-b1d4'), advisoryId: 'ADV-0003', createdAt: '2026-09-25T09:15:02Z', status: 'rejected',
    decision: { officerName: 'Joseph Kariuki', decision: 'reject', reason: 'Harvest labour is already booked for 3 Oct; I will confirm on the visit rather than by message.', decidedAt: '2026-09-25T09:31:50Z', dispatch: null } }
  S.seq.adv = 3
  ;[adv2, adv3, adv1].forEach(linkAdvisory)
  S.followups = [
    { followupId: 'FU-1', plotId: 'B2', farmId: 'F-001', householdName: 'Mary Wairimu', date: '2026-10-02', note: 'Re-read soil moisture 3 days after irrigation; expect > 20% VWC.', createdBy: 'agent', createdAt: '2026-09-27T06:14:00Z' },
    { followupId: 'FU-2', plotId: 'A3', farmId: 'F-001', householdName: 'Grace Achieng', date: '2026-09-29', note: 'Scout lower leaves 48 h after spray; photograph any lesions.', createdBy: 'officer', createdAt: '2026-09-27T06:20:00Z' },
  ]
  S.flags = [
    { flagId: 'FLG-1', plotId: 'B3', farmId: 'F-001', householdName: 'Joseph Otieno', reason: 'Soil probe offline since 2026-09-24; readings stale, drafting blocked.', severity: 'warning', createdAt: '2026-09-26T06:00:00Z' },
    { flagId: 'FLG-2', plotId: 'A2', farmId: 'F-001', householdName: 'Peter Kamau', reason: 'pH below 5.5 for three seasons; lime never applied.', severity: 'warning', createdAt: '2026-09-18T10:00:00Z' },
  ]
  S.flags.forEach((f) => plotOf(f.plotId)?.flags.push(f))
  const base = Date.parse(`${TODAY}T06:12:00Z`)
  const at = (m) => new Date(base + m * 1000).toISOString()
  ;[
    { tool: 'get_plot', actor: 'agent', runId: 'run-20260927-a3f1', plotId: 'A3', input: { plotId: 'A3' }, output: { status: 'critical', soilMoisture: 36.4 } },
    { tool: 'get_weather', actor: 'agent', runId: 'run-20260927-a3f1', plotId: 'A3', input: { farmId: 'F-001', days: 7 }, output: { last7Mm: 31.2, source: 'open-meteo' } },
    { tool: 'get_pest_alerts', actor: 'agent', runId: 'run-20260927-a3f1', plotId: 'A3', input: { agroZoneId: 'KE-HL-UPPER', crop: 'potato' }, output: { count: 1, top: 'PA-2026-41-01' } },
    { tool: 'evaluate_rules', actor: 'agent', runId: 'run-20260927-a3f1', plotId: 'A3', input: { plotId: 'A3' }, output: { primaryAction: 'spray', findings: 1 } },
    { tool: 'draft_advisory', actor: 'agent', runId: 'run-20260927-a3f1', plotId: 'A3', advisoryId: 'ADV-0001', input: { plotId: 'A3', action: 'spray' }, output: { advisoryId: 'ADV-0001', chars: adv1.message.length } },
    { tool: 'decide_advisory', actor: 'human:Amina Wekesa', runId: 'run-20260926-c2e9', plotId: 'A2', advisoryId: 'ADV-0002', input: { decision: 'approve' }, output: { status: 'approved', dispatch: 'simulated ussd' } },
    { tool: 'decide_advisory', actor: 'human:Joseph Kariuki', runId: 'run-20260925-b1d4', plotId: 'B1', advisoryId: 'ADV-0003', input: { decision: 'reject' }, output: { status: 'rejected' } },
    { tool: 'ingest_weather', actor: 'api', runId: null, plotId: null, input: { farmId: 'F-001' }, output: { days: 8, forecastDays: 7, source: 'open-meteo archive+forecast' } },
  ].forEach((e, i) => { S.audit.push({ id: ++S.seq.audit, ts: at(i * 7), ok: true, durationMs: 6 + i * 3, ...e }) })
  S.audit.reverse()
}
seedHistory()

// ---------------------------------------------------------------- derived payloads
const farmView = (f) => {
  const plots = S.plots.filter((p) => p.farmId === f.farmId)
  return { ...f, plotCount: plots.length, pendingAdvisories: plots.filter((p) => p.pendingAdvisoryId).length, totalHa: f.totalHa ?? Math.round(plots.reduce((s, p) => s + (p.agronomy?.areaHa || 0), 0) * 10) / 10 }
}

function rainfall(plot) {
  const base = Math.max(plot.atmosphere?.precipitation ?? 2, 1.1)   // dry plots still see trace rain in the archive
  const addDays = (n) => new Date(Date.parse(`${TODAY}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10)
  const days = [0.4, 0.9, 0.5, 1.3, 0.7, 0.6, 1].map((k, i) => ({ date: addDays(i - 6), mm: Math.round(base * k * 10) / 10 }))
  const fc = [0.3, 0.5, 0.2, 0.8, 0.6, 0.4, 0.3].map((k, i) => ({ date: addDays(i + 1), mm: Math.round(base * k * 10) / 10, probability: Math.round(30 + k * 50) }))
  return { last7Mm: Math.round(days.reduce((s, d) => s + d.mm, 0) * 10) / 10, days, forecast: fc, source: 'open-meteo archive (ERA5) + forecast', fetchedAt: `${TODAY}T07:00:00Z`, stale: false }
}

const ALERT = { alertId: 'PA-2026-41-01', pest: 'late_blight', crop: 'potato', severity: 'high', issuedAt: '2026-09-26T06:00:00Z', source: 'county plant-health desk (synthetic bulletin)', stages: ['tuber_initiation', 'tuber_bulking'], summary: 'Late-blight conducive weather across the upper highland zone; protectant sprays advised where canopy is wet > 10 h/day.' }

// ---------------------------------------------------------------- run engine (SSE emulation)
function makeRun(kind, plotId, events) {
  const runId = `run-${TODAY.replace(/-/g, '')}-${(++S.seq.run).toString(16).padStart(2, '0')}${Math.random().toString(16).slice(2, 4)}`
  S.runs[runId] = { runId, kind, plotId, status: 'running', events: [], queue: events, listeners: new Set(), timer: null, open: true }
  return runId
}

function emit(run, type, data) {
  const ev = { type, data, ts: NOW() }
  run.events.push(ev)
  run.listeners.forEach((l) => { try { l(ev) } catch { /* listener gone */ } })
  if (type === 'tool_call') audit({ tool: data.tool, actor: 'agent', runId: run.runId, plotId: run.plotId, input: data.input, output: null, ok: true, durationMs: 0 })
  if (type === 'tool_result') { const e = S.audit.find((a) => a.runId === run.runId && a.tool === data.tool && a.output == null); if (e) { e.output = data.output; e.durationMs = data.durationMs; e.ok = data.ok } }
  if (type === 'awaiting_officer') run.status = 'awaiting_officer'
  if (type === 'done') { run.status = run.status === 'error' ? 'error' : 'done'; run.open = false }
  if (type === 'error' && !data.recoverable) run.status = 'error'
}

function pump(run) {
  if (run.timer || !run.queue.length) return
  const [delay, type, data] = run.queue.shift()
  run.timer = setTimeout(() => { run.timer = null; emit(run, type, typeof data === 'function' ? data() : data); pump(run) }, delay)
}

function subscribeRun(runId, onEvent) {
  const run = S.runs[runId]
  if (!run) { onEvent({ type: 'error', data: { text: `Unknown run ${runId}`, recoverable: false } }); return () => {} }
  run.events.forEach(onEvent)
  run.listeners.add(onEvent)
  pump(run)
  return () => run.listeners.delete(onEvent)
}

function tcPair(id, server, tool, input, result, ms, summary) {
  return [[260, 'tool_call', { id, server, tool, input, ts: NOW() }], [ms, 'tool_result', { id, tool, ok: true, durationMs: ms, summary, output: result }]]
}

function advisoryEvents(plot) {
  const farm = farmOf(plot.farmId)
  const rules = evaluate(plot)
  const ev = [
    [120, 'status', { node: 'gather', text: `Gathering twin state, rainfall and pest bulletins for plot ${plot.plotId}` }],
    ...tcPair('tc-1', 'agritwin', 'get_plot', { plotId: plot.plotId }, { plotId: plot.plotId, status: plot.status, growthStage: plot.crop?.growthStage, soilMoisture: plot.soil?.soilMoisture, soilPH: plot.soilPH, ndvi: plot.crop?.ndvi, lastUpdateTime: plot.lastUpdateTime }, 14, `${plot.status} · ${plot.crop?.growthStage || 'unknown'} · updated ${plot.lastUpdateTime || 'never'}`),
    ...tcPair('tc-2', 'open-meteo', 'get_weather', { lat: farm?.lat, lon: farm?.lon, pastDays: 7, forecastDays: 7 }, () => { const r = rainfall(plot); return { last7Mm: r.last7Mm, forecast7Mm: Math.round(r.forecast.reduce((s, d) => s + d.mm, 0) * 10) / 10, source: r.source } }, 412, 'ERA5 archive + 7-day forecast for the farm coordinates'),
    ...tcPair('tc-3', 'agritwin', 'get_pest_alerts', { agroZoneId: plot.agroZoneId, crop: farm?.crop || 'potato', growthStage: plot.crop?.growthStage }, plot.agronomy?.simcastBlightRisk === 'high' ? { count: 1, alerts: [ALERT] } : { count: 0, alerts: [] }, 9, plot.agronomy?.simcastBlightRisk === 'high' ? '1 active bulletin: late blight (high)' : 'no active bulletin for this stage'),
    [200, 'status', { node: 'cross_check', text: 'Cross-checking readings against the deterministic rule profile potato@1' }],
    ...tcPair('tc-4', 'agritwin', 'evaluate_rules', { plotId: plot.plotId, profile: 'potato@1' }, { primaryAction: rules.primaryAction, blocked: rules.blocked, findings: rules.findings.map((f) => ({ ruleId: f.ruleId, action: f.action, severity: f.severity })) }, 7, rules.blocked ? `BLOCKED: ${rules.blocked.reason}` : `${rules.findings.length} finding(s) → ${rules.primaryAction}`),
  ]
  if (rules.blocked) {
    ev.push([200, 'status', { node: 'missing_data', text: 'Rule engine refused to draft: readings cannot be trusted' }])
    ev.push(...tcPair('tc-5', 'agritwin', 'raise_flag', { plotId: plot.plotId, reason: rules.blocked.detail, severity: 'warning' }, () => { const f = { flagId: `FLG-${++S.seq.flag}`, plotId: plot.plotId, farmId: plot.farmId, householdName: plot.householdName, reason: `Drafting blocked (${rules.blocked.reason}): ${rules.blocked.detail}. Sensor check needed.`, severity: 'warning', createdAt: NOW() }; S.flags.unshift(f); plot.flags = [...(plot.flags || []), f]; return { flagId: f.flagId } }, 5, 'flag raised for a sensor check'))
    ev.push([200, 'error', { text: `No advisory drafted for ${plot.plotId}: ${rules.blocked.reason.replace('_', ' ')} (${rules.blocked.detail}). The engine refuses to advise a household on readings it cannot trust; a flag has been raised for a sensor check.`, recoverable: false }])
    ev.push([100, 'done', () => ({ runId: null, costUsd: 0, tokens: { in: 0, out: 0 }, durationMs: 1800 })])
    return ev
  }
  let adv = null
  ev.push([200, 'status', { node: 'draft', text: 'Drafting a cited, SMS-length advisory with the open-weights model' }])
  ev.push([150, 'llm', { ...MODEL, attempt: 1 }])
  ev.push([900, 'tool_call', { id: 'tc-5', server: 'agritwin', tool: 'draft_advisory', input: { plotId: plot.plotId, action: rules.primaryAction, maxChars: 320 }, ts: NOW() }])
  ev.push([300, 'tool_result', () => { adv = buildAdvisory(plot, rules, null); linkAdvisory(adv); return { id: 'tc-5', tool: 'draft_advisory', ok: true, durationMs: 1140, summary: `${adv.advisoryId} · ${adv.action} · ${adv.message.length} chars · ${adv.citations.length} citations`, output: { advisoryId: adv.advisoryId, action: adv.action, chars: adv.message.length, citations: adv.citations.length } } }])
  ev.push([120, 'draft', () => adv])
  ev.push([200, 'status', { node: 'await_officer', text: 'Paused at the officer gate. Nothing is sent until a named officer approves.' }])
  ev.push([100, 'awaiting_officer', () => ({ advisoryId: adv.advisoryId })])
  return ev
}

function chatAnswer(message, plotId, farmId) {
  const q = message.toLowerCase()
  const plots = S.plots.filter((p) => p.farmId === farmId)
  const flagged = plots.filter((p) => p.status !== 'nominal')
  const named = plots.find((p) => new RegExp(`\\b${p.plotId}\\b`, 'i').test(message)) || (plotId ? plotOf(plotId) : null)
  const tools = []
  let text, sources = []
  if (/audit|trail|log/.test(q) && named) {
    const rows = S.audit.filter((a) => a.plotId === named.plotId).slice(0, 6)
    tools.push(['agritwin', 'get_audit', { plotId: named.plotId, limit: 6 }, { count: rows.length }])
    text = `**Audit trail for ${named.plotId} · ${named.displayName}** (${rows.length} most recent entries):\n` + rows.map((r) => `- ${r.ts.slice(0, 16).replace('T', ' ')} · ${r.actor} · ${r.tool}${r.advisoryId ? ` · ${r.advisoryId}` : ''} · ${r.ok ? 'ok' : 'failed'}`).join('\n') + `\n\nEvery tool call above went through the AgriTwin MCP server and is replayable from the Desk audit panel.`
    sources = rows.map((r) => `audit#${r.id}`)
  } else if (/forecast|rain|weather/.test(q)) {
    const p = named || plots[0]
    const r = rainfall(p)
    tools.push(['open-meteo', 'get_weather', { lat: farmOf(farmId)?.lat, lon: farmOf(farmId)?.lon, pastDays: 7, forecastDays: 7 }, { last7Mm: r.last7Mm, forecastDays: 7 }])
    text = `**Rainfall for ${farmOf(farmId)?.name} (zone ${p.agroZoneId})**\n- Last 7 days: **${r.last7Mm} mm** (Open-Meteo ERA5 archive, fetched ${r.fetchedAt.slice(0, 10)}).\n- Next 7 days: ${r.forecast.map((d) => `${d.date.slice(5)} ${d.mm} mm (${d.probability}%)`).join(', ')}.\n\nFor ${p.plotId} that means ${r.forecast.reduce((s, d) => s + d.mm, 0) < 10 ? 'rain will not close any moisture gap this week' : 'wet-canopy hours stay high; keep blight pressure in view'}.`
    sources = ['open-meteo archive+forecast', `plot ${p.plotId}`]
  } else if (/why|flag|wrong/.test(q) && named) {
    const rules = evaluate(named)
    tools.push(['agritwin', 'get_plot', { plotId: named.plotId }, { status: named.status }], ['agritwin', 'evaluate_rules', { plotId: named.plotId }, { primaryAction: rules.primaryAction, blocked: rules.blocked }])
    text = rules.blocked
      ? `**${named.plotId} · ${named.displayName}** is flagged because the rule engine refuses to draft: **${rules.blocked.reason.replace('_', ' ')}** (${rules.blocked.detail}). Status is *${named.status}*. Until the probe reports again, nothing can be advised to ${named.householdName} from this twin.`
      : `**${named.plotId} · ${named.displayName}** is flagged *${named.status}* because:\n` + rules.findings.map((f) => `- **${f.action}** (${f.severity}): ${f.reasoning}`).join('\n') + `\n\nRule profile potato@1; every number above is cited in the draft advisory.`
    sources = rules.findings.flatMap((f) => f.citations.map((c) => c.field)).slice(0, 4)
  } else if (/need me|this week|priorit|attention|today/.test(q) || !named) {
    tools.push(['agritwin', 'list_plots', { farmId }, { count: plots.length, flagged: flagged.length }])
    text = `**${flagged.length} of ${plots.length} plots need you this week** on ${farmOf(farmId)?.name}:\n` + flagged.map((p) => `- **${p.plotId} · ${p.displayName}** (${p.householdName}, ${p.contactMethod}): ${p.insight}${p.pendingAdvisoryId ? ` → draft ${p.pendingAdvisoryId} is waiting for your decision.` : ''}`).join('\n') + `\n\nThe rest are inside their bands. Suggested order: critical first, then the dry plot, then the lime plan; the offline probe needs a visit, not a message.`
    sources = flagged.map((p) => `plot ${p.plotId}`)
  } else {
    const rules = evaluate(named)
    tools.push(['agritwin', 'get_plot', { plotId: named.plotId }, { status: named.status }])
    text = `**${named.plotId} · ${named.displayName}** (${named.householdName}): status *${named.status}*. ${named.insight} Rule engine says **${rules.primaryAction}**${named.pendingAdvisoryId ? `; draft ${named.pendingAdvisoryId} is pending your decision` : ''}. Moisture ${named.soil?.soilMoisture}% VWC, pH ${named.soilPH}, NDVI ${named.crop?.ndvi}, blight ${named.agronomy?.simcastBlightRisk}.`
    sources = [`plot ${named.plotId}`, 'rules potato@1']
  }
  const ev = [[120, 'status', { node: 'gather', text: 'Reading the twin through the AgriTwin MCP server' }]]
  tools.forEach(([server, tool, input, output], i) => ev.push(...tcPair(`tc-${i + 1}`, server, tool, input, output, server === 'open-meteo' ? 380 : 11, JSON.stringify(output).slice(0, 80))))
  ev.push([120, 'llm', { ...MODEL, attempt: 1 }])
  const words = text.split(/(?<=\s)/)
  const chunk = Math.max(2, Math.ceil(words.length / 40))
  for (let i = 0; i < words.length; i += chunk) ev.push([28, 'token', { text: words.slice(i, i + chunk).join('') }])
  ev.push([80, 'message', { text, sources }])
  ev.push([60, 'done', { runId: null, costUsd: 0, tokens: { in: 820, out: words.length }, durationMs: 2400 }])
  return ev
}

// ---------------------------------------------------------------- public API (mirrors api.js)
const mock = {
  async health() { await sleep(LATENCY); return { ok: true, model: MODEL, mcp: { server: 'agritwin', tools: 14 }, borrowedMcp: { name: 'chuk-mcp-open-meteo', ok: true }, today: TODAY } },
  async office() { await sleep(LATENCY); return clone(S.office) },
  async farms() { await sleep(LATENCY); return S.farms.map(farmView) },
  async farm(farmId) { await sleep(LATENCY); const f = farmOf(farmId); if (!f) throw new Error(`Farm ${farmId} not found`); return { ...farmView(f), plots: clone(S.plots.filter((p) => p.farmId === farmId)) } },
  async createFarm(body) {
    await sleep(LATENCY * 3)
    if (!body?.name || !body?.plots?.length) throw new Error('name and at least one plot are required')
    const farmId = `F-${String(++S.seq.farm).padStart(3, '0')}`
    const farm = { farmId, name: body.name, region: body.region || '', crop: body.crop || 'potato', agroZoneId: body.agroZoneId || 'KE-HL-UPPER', lat: Number(body.lat), lon: Number(body.lon), elevationM: null, today: TODAY, officeId: S.office.officeId, notes: 'Registered from the console; no readings ingested yet.' }
    S.farms.push(farm)
    body.plots.forEach((pl, i) => {
      const plotId = pl.plotId || `${farmId}-P${i + 1}`
      S.plots.push({ plotId, zoneId: plotId, farmId, displayName: pl.displayName || `Plot ${i + 1}`, grid: [i % 3, Math.floor(i / 3)], status: 'unknown',
        source: { soil: 'unknown', crop: 'unknown', model: 'unknown' }, lastUpdateTime: null,
        atmosphere: { ambientTemperature: 18, relativeHumidity: 65, precipitation: 0 },
        soil: { soilMoisture: 22, soilTemperature: 17, soilEC: 0.3, soilOrganicCarbon: 2, nitrogenLevel: 0.15, phosphorusLevel: 15, potassiumLevel: 0.4, aluminiumLevel: 0.5, soilTextureClass: 'unknown' }, soilPH: 6,
        crop: { ndvi: 0.4, evi: 0.3, cloudCover: 0, growthStage: pl.plantingDate ? 'emergence' : 'unplanted', daysAfterPlanting: 0, accumulatedGDD: 0 },
        agronomy: { variety: pl.variety || '', plantingDate: pl.plantingDate || null, areaHa: Number(pl.areaHa) || 1, substorTuberFreshYield: null, substorLeafAreaIndex: null, simcastBlightRisk: 'none', simcastSprayRecommended: false },
        series: { soilMoisture: Array(7).fill(22), soilPH: Array(7).fill(6), ndvi: Array(7).fill(0.4), accumulatedGDD: Array(7).fill(0) },
        insight: 'Twin registered. No readings ingested yet; run weather ingestion and add a probe before any advisory can be drafted.',
        householdId: `H-${farmId}-${i + 1}`, householdName: pl.householdName || 'Unnamed household', contactMethod: pl.contactMethod || 'sms', lastVisit: null, agroZoneId: farm.agroZoneId,
        pendingAdvisoryId: null, latestAdvisoryStatus: null, flags: [] })
    })
    audit({ tool: 'register_farm', actor: 'api', runId: null, plotId: null, input: { name: body.name, plots: body.plots.length }, output: { farmId } })
    return { ...farmView(farm), plots: clone(S.plots.filter((p) => p.farmId === farmId)) }
  },
  async ingestWeather(farmId) { await sleep(600); audit({ tool: 'ingest_weather', actor: 'api', runId: null, plotId: null, input: { farmId }, output: { days: 8, forecastDays: 7 } }); return { ok: true, days: 8, forecastDays: 7, source: 'open-meteo archive+forecast', fetchedAt: NOW() } },
  async plot(plotId) {
    await sleep(LATENCY); const p = plotOf(plotId); if (!p) throw new Error(`Plot ${plotId} not found`)
    return { ...clone(p), signals: { rainfall: p.status === 'unknown' ? null : rainfall(p) }, alerts: p.agronomy?.simcastBlightRisk === 'high' ? [ALERT] : [], followups: S.followups.filter((f) => f.plotId === plotId) }
  },
  async plotRules(plotId) { await sleep(LATENCY); const p = plotOf(plotId); if (!p) throw new Error(`Plot ${plotId} not found`); return evaluate(p) },
  async advisories({ status, farmId } = {}) {
    await sleep(LATENCY)
    return Object.values(S.advisories).filter((a) => (!status || a.status === status) && (!farmId || a.farmId === farmId)).sort((x, y) => y.createdAt.localeCompare(x.createdAt)).map(clone)
  },
  async advisory(id) { await sleep(LATENCY); const a = S.advisories[id]; if (!a) throw new Error(`Advisory ${id} not found`); return clone(a) },
  async decide(id, { officerName, decision, reason }) {
    await sleep(LATENCY * 2)
    const a = S.advisories[id]
    if (!a) throw new Error(`Advisory ${id} not found`)
    if (!S.office.officers.some((o) => o.name === officerName)) throw new Error(`${officerName || '(nobody)'} is not on the office roster`)
    if (a.status !== 'draft') throw new Error(`Advisory ${id} is already ${a.status}`)
    if (decision === 'reject' && !reason?.trim()) throw new Error('A reason is required to reject')
    a.status = decision === 'approve' ? 'approved' : 'rejected'
    a.decision = { officerName, decision, reason: reason || '', decidedAt: NOW(),
      dispatch: decision === 'approve' ? { simulated: true, channel: a.contactMethod, to: a.householdId, sentAt: NOW(), text: a.message } : null }
    linkAdvisory(a)
    audit({ tool: 'decide_advisory', actor: `human:${officerName}`, runId: a.runId, plotId: a.plotId, advisoryId: id, input: { decision, reason: reason || '' }, output: { status: a.status, dispatch: a.decision.dispatch ? `simulated ${a.contactMethod}` : null } })
    if (decision === 'approve') {
      audit({ tool: 'dispatch_simulated', actor: 'api', runId: a.runId, plotId: a.plotId, advisoryId: id, input: { channel: a.contactMethod, to: a.householdId }, output: { simulated: true, chars: a.message.length } })
      if (!S.followups.some((f) => f.plotId === a.plotId && f.createdBy === 'agent' && f.date > TODAY)) {
        S.followups.push({ followupId: `FU-${++S.seq.fu}`, plotId: a.plotId, farmId: a.farmId, householdName: a.householdName, date: '2026-10-04', note: `Confirm the household acted on ${a.action} (${id}) and re-read the plot.`, createdBy: 'agent', createdAt: NOW() })
      }
    }
    const run = a.runId && S.runs[a.runId]
    if (run && run.open) { emit(run, 'decision', clone(a)); emit(run, 'done', { runId: a.runId, costUsd: 0, tokens: { in: 1430, out: 210 }, durationMs: 5200 }) }
    return clone(a)
  },
  async runAgent({ plotId }) {
    await sleep(LATENCY)
    const p = plotOf(plotId); if (!p) throw new Error(`Plot ${plotId} not found`)
    const runId = makeRun('advisory', plotId, advisoryEvents(p))
    const run = S.runs[runId]
    run.queue = run.queue.map(([d, t, data]) => [d, t, t === 'draft' ? () => { const a = data(); a.runId = runId; return a } : t === 'done' ? () => ({ ...(typeof data === 'function' ? data() : data), runId }) : data])
    return { runId, plotId }
  },
  async chat({ message, plotId, farmId, threadId }) {
    await sleep(LATENCY)
    const runId = makeRun('chat', plotId || null, chatAnswer(message, plotId, farmId || S.farms[0].farmId))
    return { runId, threadId: threadId || `thr-${++S.seq.thread}` }
  },
  runEvents: subscribeRun,
  async run(runId) { await sleep(LATENCY); const r = S.runs[runId]; if (!r) throw new Error(`Run ${runId} not found`); return { runId, kind: r.kind, plotId: r.plotId, status: r.status, events: clone(r.events) } },
  async audit({ plotId, advisoryId, runId, limit = 100 } = {}) {
    await sleep(LATENCY)
    return S.audit.filter((a) => (!plotId || a.plotId === plotId) && (!advisoryId || a.advisoryId === advisoryId) && (!runId || a.runId === runId)).slice(0, limit).map(clone)
  },
  async followups({ farmId } = {}) { await sleep(LATENCY); return S.followups.filter((f) => !farmId || f.farmId === farmId).sort((x, y) => x.date.localeCompare(y.date)).map(clone) },
  async flags({ farmId } = {}) { await sleep(LATENCY); return S.flags.filter((f) => !farmId || f.farmId === farmId).map(clone) },
}

export default mock
