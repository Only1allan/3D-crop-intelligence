// Shared advisory UI: action chips, draft card with citations, run trace,
// decision form and decision view. Used by the Twin's Advisory tab and the Desk.
import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, Check, X, Cpu, Wrench, Server, AlertTriangle, Quote, Send, UserCheck, Sparkles, Clock, Lock } from 'lucide-react'

export const ACTION_META = {
  irrigate: { label: 'Irrigate', cls: 'blue' }, spray: { label: 'Spray', cls: 'red' }, plant: { label: 'Plant', cls: '' },
  hold: { label: 'Hold', cls: 'gray' }, harvest: { label: 'Harvest', cls: 'lime' }, lime: { label: 'Lime', cls: 'amber' },
  fertilise: { label: 'Fertilise', cls: 'amber' }, scout: { label: 'Scout', cls: 'amber' }, check_sensor: { label: 'Check sensor', cls: 'gray' }, none: { label: 'No action', cls: 'gray' },
}
export function ActionChip({ action, size }) {
  const m = ACTION_META[action] || { label: action || '—', cls: 'gray' }
  return <span className={`chip action ${m.cls} ${size || ''}`}>{m.label}</span>
}

export const fmtTs = (iso) => {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toISOString().slice(0, 16).replace('T', ' ') + 'Z'
}

export function JsonToggle({ label, value, open: initial = false }) {
  const [open, setOpen] = useState(initial)
  if (value === undefined || value === null) return null
  return (
    <div className="json-toggle">
      <button type="button" onClick={() => setOpen((o) => !o)}>{open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}{label}</button>
      {open && <pre>{typeof value === 'string' ? value : JSON.stringify(value, null, 2)}</pre>}
    </div>
  )
}

export function ModelChip({ drafter, compact }) {
  if (!drafter) return null
  const name = (drafter.model || drafter.provider || 'model').split('/').pop().replace(':free', '')
  return (
    <span className="chip gray model-chip" title={`${drafter.provider || ''} ${drafter.model || ''}`}>
      <Cpu size={12} />{compact ? name : `${drafter.provider ? drafter.provider + ' · ' : ''}${name}`}
      {drafter.openWeights && <em className="ow">open-weights</em>}
      {drafter.kind === 'template' && <em className="ow tpl">template</em>}
    </span>
  )
}

export function Citations({ citations = [], compact }) {
  if (!citations.length) return <p className="cite-empty"><AlertTriangle size={13} /> No citations attached. A draft without sources must not be approved.</p>
  return (
    <ol className={`cites ${compact ? 'compact' : ''}`}>
      {citations.map((c, i) => (
        <li key={`${c.field}-${i}`}>
          <code className="cite-field">{c.field}</code>
          <b className="cite-val">{typeof c.value === 'number' ? c.value : String(c.value)}<small>{c.unit}</small></b>
          <span className="cite-src">{c.source}</span>
          <span className="cite-ts"><Clock size={11} />{fmtTs(c.observedAt)}</span>
        </li>
      ))}
    </ol>
  )
}

export function DraftCard({ advisory, plot, showPlot = true, children }) {
  if (!advisory) return null
  const len = (advisory.message || '').length
  return (
    <section className="draft-card">
      <header className="draft-head">
        <div className="draft-title">
          <ActionChip action={advisory.action} />
          <div>
            <b>{advisory.advisoryId}</b>
            {showPlot && <span>Plot {advisory.plotId}{plot?.displayName ? ` · ${plot.displayName}` : ''} · {advisory.householdName} · {advisory.contactMethod?.toUpperCase()}</span>}
          </div>
        </div>
        <span className={`chip status-chip ${advisory.status}`}>{advisory.status}</span>
      </header>
      <div className="sms-box">
        <div className="sms-label"><Send size={12} />Message to household · {advisory.contactMethod || 'sms'} draft</div>
        <p>{advisory.message}</p>
        <div className={`sms-count ${len > 320 ? 'over' : ''}`}>{len} / 320 chars{len > 320 ? ' · over SMS limit' : ''}</div>
      </div>
      {advisory.reasoning && (
        <div className="draft-reason">
          <div className="draft-sub"><Sparkles size={12} />Reasoning for the officer</div>
          <p>{advisory.reasoning}</p>
        </div>
      )}
      <div className="draft-cites">
        <div className="draft-sub"><Quote size={12} />Citations · {advisory.citations?.length || 0}</div>
        <Citations citations={advisory.citations} />
      </div>
      <footer className="draft-foot">
        <ModelChip drafter={advisory.drafter} />
        <span className="muted-xs">drafted {fmtTs(advisory.createdAt)}{advisory.runId ? ` · ${advisory.runId}` : ''}</span>
      </footer>
      {children}
    </section>
  )
}

export function DecisionForm({ advisory, officers = [], onDecide, busy: busyExt = false, defaultOfficer }) {
  const [officer, setOfficer] = useState(() => { try { return localStorage.getItem('ci.officer') || defaultOfficer || officers[0]?.name || '' } catch { return defaultOfficer || officers[0]?.name || '' } })
  const [mode, setMode] = useState(null) // null | 'reject'
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  useEffect(() => { if (!officer && officers[0]) setOfficer(officers[0].name) }, [officers, officer])
  const valid = officers.some((o) => o.name === officer)

  async function submit(decision) {
    if (!valid) { setErr('Pick an officer from the roster.'); return }
    if (decision === 'reject' && !reason.trim()) { setErr('A reason is required to reject.'); return }
    setBusy(true); setErr(null)
    try {
      try { localStorage.setItem('ci.officer', officer) } catch { /* ignore */ }
      await onDecide(advisory.advisoryId, { officerName: officer, decision, reason: reason.trim() || undefined })
      setMode(null); setReason('')
    } catch (e) { setErr(e.message || String(e)) } finally { setBusy(false) }
  }
  const disabled = busy || busyExt

  return (
    <div className="decision-form">
      <div className="df-top">
        <label className="df-officer"><UserCheck size={14} />
          <select value={officer} onChange={(e) => setOfficer(e.target.value)} aria-label="Deciding officer" disabled={disabled}>
            {!officers.length && <option value="">No officers loaded</option>}
            {officers.map((o) => <option key={o.name} value={o.name}>{o.name} · {o.role}</option>)}
          </select>
        </label>
        <span className="df-gate"><Lock size={12} />Named-officer gate · nothing is sent without this decision</span>
      </div>
      {mode === 'reject' && (
        <textarea className="df-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why is this draft rejected? (required, kept in the audit log)" rows={3} autoFocus disabled={disabled} />
      )}
      {err && <div className="df-err"><AlertTriangle size={13} />{err}</div>}
      <div className="df-actions">
        {mode === 'reject' ? (
          <>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setMode(null); setErr(null) }} disabled={disabled}>Back</button>
            <button type="button" className="btn btn-danger btn-sm" onClick={() => submit('reject')} disabled={disabled || !reason.trim()}><X size={15} />Confirm reject</button>
          </>
        ) : (
          <>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setMode('reject')} disabled={disabled}><X size={15} />Reject</button>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => submit('approve')} disabled={disabled || !valid}><Check size={15} />{busy ? 'Recording…' : 'Approve & simulate send'}</button>
          </>
        )}
      </div>
    </div>
  )
}

export function DecisionView({ advisory }) {
  const d = advisory?.decision
  if (!d) return null
  const ok = d.decision === 'approve'
  return (
    <div className={`decision-view ${ok ? 'ok' : 'no'}`}>
      <div className="dv-head">
        {ok ? <Check size={16} /> : <X size={16} />}
        <div><b>{ok ? 'Approved' : 'Rejected'} by {d.officerName}</b><span>{fmtTs(d.decidedAt)}{d.reason ? ` · ${d.reason}` : ''}</span></div>
      </div>
      {ok && d.dispatch && (
        <div className="dispatch-box">
          <div className="dispatch-label"><AlertTriangle size={12} />Simulated dispatch — no message was really sent</div>
          <div className="dispatch-meta"><span>channel <b>{d.dispatch.channel?.toUpperCase()}</b></span><span>to <b>{d.dispatch.to}</b></span><span>{fmtTs(d.dispatch.sentAt)}</span></div>
          <p>{d.dispatch.text}</p>
        </div>
      )}
      {!ok && <p className="dv-note">Nothing was sent to the household. The rejection and its reason are in the audit log; the agent can re-draft when readings change.</p>}
    </div>
  )
}

// ---------------------------------------------------------------- run trace
const NODE_LABEL = { gather: 'Gather', cross_check: 'Cross-check', draft: 'Draft', await_officer: 'Officer gate', finalize: 'Finalise', missing_data: 'Missing data' }

function ToolRow({ call, result }) {
  const [open, setOpen] = useState(false)
  const pending = !result
  return (
    <div className={`trace-row tool ${pending ? 'pending' : result.ok ? 'ok' : 'fail'}`}>
      <button type="button" className="trace-main" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className={`srv ${call.server === 'open-meteo' ? 'meteo' : 'agri'}`}><Server size={11} />{call.server || 'agritwin'}</span>
        <code className="tool-name"><Wrench size={11} />{call.tool}</code>
        <span className="tool-sum">{pending ? 'running…' : result.summary || (result.ok ? 'ok' : 'failed')}</span>
        <span className="tool-ms">{pending ? <i className="spin" /> : `${result.durationMs ?? 0} ms`}</span>
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
      </button>
      {open && (
        <div className="trace-detail">
          <JsonToggle label="input" value={call.input} open />
          {result && <JsonToggle label="output" value={result.output ?? result} open />}
        </div>
      )}
    </div>
  )
}

export function RunTrace({ events = [], compact }) {
  const rows = useMemo(() => {
    const out = []
    const calls = new Map()
    for (const ev of events) {
      const { type, data } = ev
      if (type === 'tool_call') { const r = { kind: 'tool', call: data, result: null }; calls.set(data.id, r); out.push(r) }
      else if (type === 'tool_result') { const r = calls.get(data.id); if (r) r.result = data; else out.push({ kind: 'tool', call: { id: data.id, tool: data.tool, server: 'agritwin' }, result: data }) }
      else if (type === 'status') out.push({ kind: 'status', data })
      else if (type === 'llm') out.push({ kind: 'llm', data })
      else if (type === 'error') out.push({ kind: 'error', data })
      else if (type === 'done') out.push({ kind: 'done', data })
      else if (type === 'awaiting_officer') out.push({ kind: 'gate', data })
      else if (type === 'decision') out.push({ kind: 'decision', data })
    }
    return out
  }, [events])
  if (!rows.length) return null
  return (
    <div className={`run-trace ${compact ? 'compact' : ''}`}>
      {rows.map((r, i) => {
        if (r.kind === 'tool') return <ToolRow key={r.call.id || i} call={r.call} result={r.result} />
        if (r.kind === 'status') return <div key={i} className="trace-row status"><span className="node">{NODE_LABEL[r.data.node] || r.data.node}</span><span>{r.data.text}</span></div>
        if (r.kind === 'llm') return <div key={i} className="trace-row llm"><ModelChip drafter={r.data} />{r.data.attempt > 1 && <span className="muted-xs">attempt {r.data.attempt}</span>}</div>
        if (r.kind === 'error') return <div key={i} className="trace-row error"><AlertTriangle size={13} /><span>{r.data.text}</span></div>
        if (r.kind === 'gate') return <div key={i} className="trace-row gate"><Lock size={13} /><span>Paused at the officer gate · {r.data.advisoryId}</span></div>
        if (r.kind === 'decision') return <div key={i} className={`trace-row gate ${r.data.decision?.decision === 'approve' ? 'ok' : 'no'}`}><UserCheck size={13} /><span>{r.data.decision?.decision === 'approve' ? 'Approved' : 'Rejected'} by {r.data.decision?.officerName}</span></div>
        if (r.kind === 'done') return <div key={i} className="trace-row done"><Check size={13} /><span>Run finished{r.data.durationMs ? ` · ${(r.data.durationMs / 1000).toFixed(1)} s` : ''}{r.data.tokens ? ` · ${r.data.tokens.in}→${r.data.tokens.out} tokens` : ''}{typeof r.data.costUsd === 'number' ? ` · $${r.data.costUsd.toFixed(3)}` : ''}</span></div>
        return null
      })}
    </div>
  )
}
