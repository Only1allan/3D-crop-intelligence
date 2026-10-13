import { useCallback, useEffect, useRef, useState } from 'react'
import { Sparkles, Play, RefreshCw, AlertTriangle, Inbox, ShieldCheck, History } from 'lucide-react'
import { api } from '../lib/api'
import { useTwin } from '../state/TwinContext'
import { ActionChip, DraftCard, DecisionForm, DecisionView, RunTrace, fmtTs } from './Advisory'

// Advisory tab for one plot: draft (live run trace) -> draft card -> officer decision.
export default function AdvisoryPanel({ plot, onSelect }) {
  const { officers, advisories, decide, refreshAll, farm } = useTwin()
  const [events, setEvents] = useState([])
  const [runId, setRunId] = useState(null)
  const [phase, setPhase] = useState('idle')   // idle | running | awaiting | decided | error
  const [advisory, setAdvisory] = useState(null)
  const [err, setErr] = useState(null)
  const closeRef = useRef(null)
  const plotId = plot?.plotId

  const stop = useCallback(() => { closeRef.current?.(); closeRef.current = null }, [])
  useEffect(() => stop, [stop])

  // On plot change: reset, then load a pending draft (or the latest decided one) for this plot.
  useEffect(() => {
    stop(); setEvents([]); setRunId(null); setErr(null); setAdvisory(null); setPhase('idle')
    if (!plotId) return
    let alive = true
    const pendingId = plot.pendingAdvisoryId
    const latest = advisories.filter((a) => a.plotId === plotId).sort((x, y) => (y.createdAt || '').localeCompare(x.createdAt || ''))[0]
    ;(async () => {
      try {
        if (pendingId) {
          const a = await api.advisory(pendingId)
          if (!alive) return
          setAdvisory(a); setPhase(a.status === 'draft' ? 'awaiting' : 'decided')
        } else if (latest) {
          setAdvisory(latest); setPhase(latest.status === 'draft' ? 'awaiting' : 'decided')
        }
      } catch (e) { if (alive) setErr(e.message || String(e)) }
    })()
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plotId])

  // A draft produced elsewhere (Desk, another officer) shows up here without wiping a trace in progress.
  const pendingId = plot?.pendingAdvisoryId
  useEffect(() => {
    if (!pendingId || phase === 'running' || advisory?.advisoryId === pendingId) return
    let alive = true
    api.advisory(pendingId).then((a) => { if (alive) { setAdvisory(a); setPhase(a.status === 'draft' ? 'awaiting' : 'decided') } }).catch(() => {})
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingId])

  const onEvent = useCallback((ev) => {
    setEvents((list) => [...list, ev])
    const { type, data } = ev
    if (type === 'draft') setAdvisory(data)
    if (type === 'awaiting_officer') setPhase('awaiting')
    if (type === 'decision') { setAdvisory(data); setPhase('decided') }
    if (type === 'error' && data?.recoverable === false) { setPhase('error'); setErr(data.text) }
    if (type === 'done') { setPhase((p) => (p === 'running' ? 'done' : p)); refreshAll().catch(() => {}) }
  }, [refreshAll])

  async function draft() {
    if (!plotId) return
    stop(); setEvents([]); setErr(null); setAdvisory(null); setPhase('running')
    try {
      const { runId: id } = await api.runAgent({ plotId })
      setRunId(id)
      closeRef.current = api.runEvents(id, onEvent)
    } catch (e) { setPhase('error'); setErr(e.message || String(e)) }
  }

  async function onDecide(id, body) {
    const updated = await decide(id, body)
    setAdvisory(updated); setPhase('decided')
  }

  if (!plot) return <FarmQueue onSelect={onSelect} />

  const running = phase === 'running'
  const canDraft = !running && phase !== 'awaiting'

  return (
    <div className="adv">
      <div className="adv-head">
        <div>
          <div className="zp-id"><span className={`dot ${plot.status}`} />Plot {plot.plotId} · {plot.householdName} · {plot.contactMethod?.toUpperCase()}</div>
          <h3>{plot.displayName}</h3>
        </div>
        <button className="btn btn-primary btn-sm" onClick={draft} disabled={!canDraft} title={phase === 'awaiting' ? 'A draft is already waiting for a decision' : 'Ask the agent to draft an advisory for this plot'}>
          {running ? <><RefreshCw size={15} className="spin-icon" />Drafting…</> : phase === 'decided' || phase === 'done' || phase === 'error' ? <><RefreshCw size={15} />Re-draft</> : <><Play size={15} />Draft advisory</>}
        </button>
      </div>

      <div className="adv-body">
        {phase === 'idle' && !advisory && (
          <div className="adv-empty">
            <Sparkles size={22} className="accent" />
            <p><b>No advisory yet for this plot.</b> The agent gathers the twin state, rainfall and pest bulletins through the AgriTwin MCP server, cross-checks the rule engine, and drafts a cited message. You decide whether it goes out.</p>
            {plot.status === 'offline' && <p className="adv-warn"><AlertTriangle size={13} /> This plot's probe is offline; expect the engine to refuse and raise a sensor-check flag.</p>}
            {plot.status === 'unknown' && <p className="adv-warn"><AlertTriangle size={13} /> No readings ingested yet; the engine will refuse to draft until the twin has data.</p>}
          </div>
        )}

        {(events.length > 0) && (
          <section className="adv-section">
            <div className="adv-sub"><History size={13} />Run trace{runId ? <code>{runId}</code> : null}</div>
            <RunTrace events={events} />
          </section>
        )}

        {phase === 'error' && err && (
          <div className="adv-error">
            <AlertTriangle size={16} />
            <div><b>No advisory drafted.</b><span>{err}</span></div>
          </div>
        )}
        {err && phase !== 'error' && <div className="adv-error soft"><AlertTriangle size={14} /><span>{err}</span></div>}

        {advisory && (
          <section className="adv-section">
            <div className="adv-sub"><ShieldCheck size={13} />{advisory.status === 'draft' ? 'Draft awaiting your decision' : `Last decision · ${fmtTs(advisory.decision?.decidedAt)}`}</div>
            <DraftCard advisory={advisory} plot={plot} showPlot={false}>
              {advisory.status === 'draft' ? <DecisionForm advisory={advisory} officers={officers} onDecide={onDecide} /> : <DecisionView advisory={advisory} />}
            </DraftCard>
          </section>
        )}
      </div>
      <div className="zp-foot">Agent drafts · officer decides · dispatch is simulated · every tool call is audit-logged{farm ? ` · ${farm.name}` : ''}</div>
    </div>
  )
}

function FarmQueue({ onSelect }) {
  const { advisories, farm, plots } = useTwin()
  const drafts = advisories.filter((a) => a.status === 'draft')
  const decided = advisories.filter((a) => a.status !== 'draft').slice(0, 5)
  const name = (id) => plots.find((p) => p.plotId === id)?.displayName || id
  return (
    <div className="adv">
      <div className="adv-head">
        <div>
          <div className="zp-id"><Inbox size={13} />{farm?.name || 'Farm'} · advisory queue</div>
          <h3>{drafts.length ? `${drafts.length} draft${drafts.length > 1 ? 's' : ''} waiting` : 'Queue is clear'}</h3>
        </div>
      </div>
      <div className="adv-body">
        {drafts.map((a) => (
          <button key={a.advisoryId} className="queue-row" onClick={() => onSelect(a.plotId)}>
            <ActionChip action={a.action} />
            <div><b>{a.plotId} · {name(a.plotId)}</b><span>{a.householdName} · {a.citations?.length || 0} citations · {fmtTs(a.createdAt)}</span></div>
          </button>
        ))}
        {!drafts.length && <p className="adv-empty-note">Select a plot and press <b>Draft advisory</b> to have the agent prepare one. Nothing reaches a household without a named officer's approval.</p>}
        {decided.length > 0 && (
          <>
            <div className="adv-sub" style={{ marginTop: 14 }}><History size={13} />Recent decisions</div>
            {decided.map((a) => (
              <button key={a.advisoryId} className={`queue-row ${a.status}`} onClick={() => onSelect(a.plotId)}>
                <ActionChip action={a.action} />
                <div><b>{a.plotId} · {name(a.plotId)}</b><span>{a.status} by {a.decision?.officerName} · {fmtTs(a.decision?.decidedAt)}</span></div>
              </button>
            ))}
          </>
        )}
      </div>
      <div className="zp-foot">Click a plot in 3D or in the list, then open Advisory to draft.</div>
    </div>
  )
}
