import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Box, Inbox, Check, X, CalendarClock, Flag, ScrollText, RefreshCw, WifiOff, Filter, ChevronDown, ChevronRight, Bot, User, Cpu, AlertTriangle, Map } from 'lucide-react'
import Logo from '../components/Logo'
import { api } from '../lib/api'
import { useTwin } from '../state/TwinContext'
import { ActionChip, DecisionForm, DecisionView, Citations, ModelChip, fmtTs } from '../twin/Advisory'
import '../twin/twin.css'
import './desk.css'

const TABS = [
  { id: 'draft', label: 'Queue', icon: Inbox },
  { id: 'approved', label: 'Approved', icon: Check },
  { id: 'rejected', label: 'Rejected', icon: X },
]

export default function Desk() {
  const { farms, office, officers, isMock, health, decide, loading } = useTwin()
  const [tab, setTab] = useState('draft')
  const [farmId, setFarmId] = useState('')
  const [lists, setLists] = useState({ draft: [], approved: [], rejected: [] })
  const [followups, setFollowups] = useState([])
  const [flags, setFlags] = useState([])
  const [audit, setAudit] = useState([])
  const [auditFilter, setAuditFilter] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  const farmName = useCallback((id) => farms.find((f) => f.farmId === id)?.name || id, [farms])

  const load = useCallback(async () => {
    setBusy(true); setErr(null)
    try {
      const p = farmId ? { farmId } : {}
      const [draft, approved, rejected, fu, fl, au] = await Promise.all([
        api.advisories({ status: 'draft', ...p }), api.advisories({ status: 'approved', ...p }), api.advisories({ status: 'rejected', ...p }),
        api.followups(p), api.flags(p), api.audit({ limit: 100, plotId: auditFilter || undefined }),
      ])
      setLists({ draft, approved, rejected }); setFollowups(fu); setFlags(fl); setAudit(au)
    } catch (e) { setErr(e.message || String(e)) } finally { setBusy(false) }
  }, [farmId, auditFilter])

  useEffect(() => { if (!loading) load() }, [load, loading])
  useEffect(() => { document.title = 'Advisory Desk · Crop Intelligence' }, [])

  async function onDecide(id, body) {
    await decide(id, body)
    await load()
  }

  const counts = { draft: lists.draft.length, approved: lists.approved.length, rejected: lists.rejected.length }
  const items = lists[tab]

  return (
    <div className="desk">
      <header className="desk-top">
        <Link to="/" className="twin-logo" aria-label="Back to home"><ArrowLeft size={16} /><Logo /></Link>
        <div className="twin-badges">
          <span className="chip"><span className="live-dot" />{office?.name || 'Extension office'}</span>
          {isMock ? <span className="chip amber"><WifiOff size={12} />Mock data · backend offline</span> : <span className="chip amber">Dispatch simulated · nothing is really sent</span>}
          {health?.model && <ModelChip drafter={health.model} compact />}
        </div>
        <div className="twin-links">
          <Link to="/twin" className="btn btn-ghost btn-sm"><Map size={15} />Open the twin</Link>
          <Link to="/lab" className="btn btn-ghost btn-sm"><Box size={15} />Real 3D data</Link>
        </div>
      </header>

      <main className="desk-main">
        <section className="desk-col desk-queue glass">
          <div className="desk-head">
            <div>
              <div className="zp-id"><Inbox size={13} />Advisory desk · {farms.length} farm{farms.length === 1 ? '' : 's'} · {officers.length} officers</div>
              <h2>{counts.draft ? `${counts.draft} draft${counts.draft > 1 ? 's' : ''} waiting for a decision` : 'Queue is clear'}</h2>
            </div>
            <div className="desk-tools">
              <label className="desk-filter"><Filter size={13} />
                <select value={farmId} onChange={(e) => setFarmId(e.target.value)} aria-label="Filter by farm">
                  <option value="">All farms</option>
                  {farms.map((f) => <option key={f.farmId} value={f.farmId}>{f.name}</option>)}
                </select>
              </label>
              <button className="icon-btn sm" onClick={load} disabled={busy} title="Refresh" aria-label="Refresh"><RefreshCw size={14} className={busy ? 'spin-icon' : ''} /></button>
            </div>
          </div>
          <div className="tabs desk-tabs" role="tablist">
            {TABS.map((t) => <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'on' : ''} onClick={() => setTab(t.id)}><t.icon size={14} />{t.label}<span className="count">{counts[t.id]}</span></button>)}
          </div>
          {err && <div className="adv-error soft" style={{ margin: '0 18px' }}><AlertTriangle size={14} /><span>{err}</span></div>}
          <div className="desk-list">
            {!items.length && <div className="desk-empty">{busy ? 'Loading…' : tab === 'draft' ? 'No drafts waiting. Open the twin and draft one for a plot that needs attention.' : `No ${tab} advisories yet.`}</div>}
            {items.map((a) => <AdvisoryCard key={a.advisoryId} a={a} farmName={farmName} officers={officers} onDecide={onDecide} />)}
          </div>
        </section>

        <aside className="desk-col desk-side">
          <section className="glass desk-panel">
            <div className="desk-panel-head"><CalendarClock size={14} /><h3>Follow-ups</h3><span className="count">{followups.length}</span></div>
            <ul className="desk-rows">
              {!followups.length && <li className="desk-empty">No follow-ups scheduled.</li>}
              {followups.map((f) => (
                <li key={f.followupId} className="desk-row">
                  <span className={`who ${f.createdBy === 'agent' ? 'agent' : 'human'}`}>{f.createdBy === 'agent' ? <Bot size={11} /> : <User size={11} />}{f.createdBy}</span>
                  <div><b>{f.date} · {f.plotId}{f.householdName ? ` · ${f.householdName}` : ''}</b><span>{f.note}</span></div>
                </li>
              ))}
            </ul>
          </section>
          <section className="glass desk-panel">
            <div className="desk-panel-head"><Flag size={14} /><h3>Flags</h3><span className="count">{flags.length}</span></div>
            <ul className="desk-rows">
              {!flags.length && <li className="desk-empty">No open flags.</li>}
              {flags.map((f) => (
                <li key={f.flagId} className="desk-row">
                  <span className={`dot ${f.severity === 'critical' ? 'critical' : 'warning'}`} style={{ marginTop: 5 }} />
                  <div><b>{f.plotId}{f.householdName ? ` · ${f.householdName}` : ''} · {f.severity}</b><span>{f.reason}</span><small>{fmtTs(f.createdAt)}</small></div>
                </li>
              ))}
            </ul>
          </section>
          <section className="glass desk-panel desk-audit">
            <div className="desk-panel-head"><ScrollText size={14} /><h3>Audit log</h3><span className="count">{audit.length}</span>
              <input className="audit-filter" value={auditFilter} onChange={(e) => setAuditFilter(e.target.value.trim().toUpperCase())} placeholder="plot id" aria-label="Filter audit by plot" />
            </div>
            <AuditTimeline rows={audit} />
          </section>
        </aside>
      </main>
    </div>
  )
}

function AdvisoryCard({ a, farmName, officers, onDecide }) {
  const [open, setOpen] = useState(false)
  const len = (a.message || '').length
  return (
    <article className={`adv-card ${a.status}`}>
      <header className="adv-card-head">
        <ActionChip action={a.action} />
        <div className="adv-card-title">
          <b>{a.householdName} · plot {a.plotId}</b>
          <span>{farmName(a.farmId)} · {a.contactMethod?.toUpperCase()} · {a.advisoryId} · {fmtTs(a.createdAt)}</span>
        </div>
        <div className="adv-card-chips">
          <span className="chip gray"><Cpu size={11} />{a.citations?.length || 0} cites</span>
          <ModelChip drafter={a.drafter} compact />
        </div>
      </header>
      <div className="sms-box">
        <p>{a.message}</p>
        <div className={`sms-count ${len > 320 ? 'over' : ''}`}>{len} / 320</div>
      </div>
      <button type="button" className="adv-card-more" onClick={() => setOpen((o) => !o)}>{open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}{open ? 'Hide' : 'Show'} reasoning and citations</button>
      {open && (
        <div className="adv-card-detail">
          {a.reasoning && <p>{a.reasoning}</p>}
          <Citations citations={a.citations} compact />
        </div>
      )}
      {a.status === 'draft' ? <DecisionForm advisory={a} officers={officers} onDecide={onDecide} /> : <DecisionView advisory={a} />}
    </article>
  )
}

function AuditTimeline({ rows }) {
  const groups = useMemo(() => {
    const g = []
    for (const r of rows) {
      const day = (r.ts || '').slice(0, 10)
      if (!g.length || g[g.length - 1].day !== day) g.push({ day, rows: [] })
      g[g.length - 1].rows.push(r)
    }
    return g
  }, [rows])
  if (!rows.length) return <div className="desk-empty">No audit entries.</div>
  return (
    <div className="audit">
      {groups.map((g) => (
        <div key={g.day} className="audit-day">
          <div className="audit-date">{g.day}</div>
          {g.rows.map((r) => <AuditRow key={r.id} r={r} />)}
        </div>
      ))}
    </div>
  )
}

function AuditRow({ r }) {
  const [open, setOpen] = useState(false)
  const human = typeof r.actor === 'string' && r.actor.startsWith('human:')
  const actorLabel = human ? r.actor.slice(6) : r.actor
  return (
    <div className={`audit-row ${r.ok === false ? 'fail' : ''}`}>
      <button type="button" className="audit-main" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="audit-ts">{(r.ts || '').slice(11, 19)}</span>
        <span className={`who ${human ? 'human' : r.actor === 'api' ? 'api' : 'agent'}`}>{human ? <User size={11} /> : <Bot size={11} />}{actorLabel}</span>
        <code className="tool-name">{r.tool}</code>
        <span className="audit-plot">{r.plotId || ''}{r.advisoryId ? ` · ${r.advisoryId}` : ''}</span>
        <span className={`audit-ok ${r.ok === false ? 'fail' : ''}`}>{r.ok === false ? 'fail' : 'ok'}{typeof r.durationMs === 'number' ? ` · ${r.durationMs} ms` : ''}</span>
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
      </button>
      {open && (
        <pre className="audit-json">{JSON.stringify({ id: r.id, runId: r.runId, input: r.input, output: r.output }, null, 2)}</pre>
      )}
    </div>
  )
}
