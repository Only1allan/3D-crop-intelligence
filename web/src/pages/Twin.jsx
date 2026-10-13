import { Component, useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowLeft, Home, Layers, Box, MousePointerClick, MessageSquareText, BarChart3, ClipboardCheck, Plus, Inbox, WifiOff, AlertTriangle } from 'lucide-react'
import FarmScene from '../three/FarmScene'
import { ZonePanel, FarmOverview } from '../twin/ZonePanel'
import ChatPanel from '../twin/ChatPanel'
import AdvisoryPanel from '../twin/AdvisoryPanel'
import RegisterFarmModal from '../twin/RegisterFarmModal'
import Logo from '../components/Logo'
import { ModelChip } from '../twin/Advisory'
import { useTwin } from '../state/TwinContext'
import { LAYERS, STATUS_LABEL } from '../lib/status'
import '../twin/twin.css'

class GLBoundary extends Component {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() {
    if (this.state.failed) return (
      <div className="gl-fallback">
        <img src="/images/aerial-farm.jpg" alt="Aerial view of farm plots" />
        <div><b>3D is unavailable on this device.</b> Pick a plot from the list; the data, the advisory desk and the agent still work.</div>
      </div>
    )
    return this.props.children
  }
}

function webglOk() {
  try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')) } catch { return false }
}

const FIELD = (t) => ['INPUT', 'TEXTAREA', 'SELECT'].includes(t?.tagName)

export default function Twin() {
  const { farms, farm, selectedFarmId, selectFarm, plots, plotById, isMock, health, loading, error, advisories } = useTwin()
  const [selected, setSelected] = useState(null)
  const [hovered, setHovered] = useState(null)
  const [layer, setLayer] = useState('status')
  const [ready, setReady] = useState(false)
  const [home, setHome] = useState(0)
  const [sheet, setSheet] = useState('insights')
  const [register, setRegister] = useState(false)
  const [gl] = useState(webglOk)
  const plot = selected ? plotById(selected) : null
  const pendingCount = advisories.filter((a) => a.status === 'draft').length

  const select = useCallback((id) => { setSelected(id) }, [])
  const openAdvisory = useCallback((id) => { setSelected(id); setSheet('advisory') }, [])

  useEffect(() => { setSelected(null) }, [selectedFarmId])
  useEffect(() => { if (selected && !plots.some((p) => p.plotId === selected)) setSelected(null) }, [plots, selected])

  useEffect(() => {
    const on = (e) => {
      if (register) return
      if (e.key === 'Escape') { setSelected(null); return }
      if (FIELD(e.target) || e.metaKey || e.ctrlKey || e.altKey) return
      const n = parseInt(e.key, 10)
      if (n >= 1 && n <= plots.length) setSelected(plots[n - 1].zoneId)
      if (e.key === 'a' || e.key === 'A') setSheet('advisory')
      if (e.key === 'i' || e.key === 'I') setSheet('insights')
      if (e.key === 'k' || e.key === 'K') setSheet('chat')
    }
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  }, [plots, register])
  useEffect(() => { document.title = plot ? `${plot.zoneId} ${plot.displayName} · ${farm?.name || 'Twin'} · Advisory Desk` : `${farm?.name || 'Live twin'} · Crop Intelligence · Advisory Desk` }, [plot, farm])

  return (
    <div className="twin">
      <div className="twin-canvas">
        {gl ? (
          <GLBoundary>
            <FarmScene key={selectedFarmId || 'none'} plots={plots} selected={selected} hovered={hovered} layer={layer} homeSignal={home}
              onHover={setHovered} onSelect={select} onReady={() => setTimeout(() => setReady(true), 400)} />
          </GLBoundary>
        ) : <GLBoundary><ThrowGL /></GLBoundary>}
        <AnimatePresence>
          {(!ready || loading) && gl && (
            <motion.div className="twin-splash" initial={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.8 }}>
              <div className="spinner" /><b>Composing the farm twin</b><span>plots · probes · rainfall · pest bulletins</span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <header className="twin-top">
        <Link to="/" className="twin-logo" aria-label="Back to home"><ArrowLeft size={16} /><Logo /></Link>
        <div className="twin-badges">
          <span className="chip"><span className="live-dot" />Live twin</span>
          {isMock ? <span className="chip amber"><WifiOff size={12} />Mock data · backend offline</span> : <span className="chip amber">Demo · synthetic plot values, live rainfall</span>}
          {health?.model && <ModelChip drafter={health.model} compact />}
        </div>
        <div className="twin-links">
          <Link to="/desk" className="btn btn-ghost btn-sm"><ClipboardCheck size={15} />Desk{pendingCount > 0 && <span className="pill">{pendingCount}</span>}</Link>
          <Link to="/lab" className="btn btn-ghost btn-sm"><Box size={15} />Real 3D data</Link>
        </div>
      </header>

      <aside className="twin-left glass">
        <div className="farm-switch">
          <label className="sr-only" htmlFor="farm-select">Farm</label>
          <select id="farm-select" value={selectedFarmId || ''} onChange={(e) => selectFarm(e.target.value)} aria-label="Select farm">
            {farms.map((f) => <option key={f.farmId} value={f.farmId}>{f.name}{f.pendingAdvisories ? ` · ${f.pendingAdvisories} draft${f.pendingAdvisories > 1 ? 's' : ''}` : ''}</option>)}
            {!farms.length && <option value="">{loading ? 'Loading farms…' : 'No farms'}</option>}
          </select>
          <button className="icon-btn sm" onClick={() => setRegister(true)} title="Register a new farm twin" aria-label="Register farm"><Plus size={15} /></button>
        </div>
        {farm && <div className="farm-meta">{farm.region} · {farm.crop} · {farm.plotCount ?? plots.length} plots · {farm.totalHa} ha</div>}
        {error && <div className="adv-error soft"><AlertTriangle size={13} /><span>{error}</span></div>}
        <div className="tl-title">Plots</div>
        <ul className="zone-list" role="listbox" aria-label="Farm plots">
          {plots.map((z, i) => (
            <li key={z.zoneId}>
              <button role="option" aria-selected={selected === z.zoneId}
                className={`zone-item ${selected === z.zoneId ? 'on' : ''} ${hovered === z.zoneId ? 'hov' : ''}`}
                onMouseEnter={() => setHovered(z.zoneId)} onMouseLeave={() => setHovered(null)}
                onClick={() => select(selected === z.zoneId ? null : z.zoneId)}>
                <span className={`dot ${z.status}`} />
                <span className="zi-id">{z.zoneId}</span>
                <span className="zi-name">{z.displayName}<small>{z.householdName || STATUS_LABEL[z.status]}</small></span>
                {z.pendingAdvisoryId ? <span className="zi-badge" title={`Draft ${z.pendingAdvisoryId} awaiting decision`} onClick={(e) => { e.stopPropagation(); openAdvisory(z.zoneId) }}><Inbox size={11} />draft</span> : <kbd>{i + 1}</kbd>}
              </button>
            </li>
          ))}
          {!plots.length && !loading && <li className="zone-empty">No plots in this twin yet.</li>}
        </ul>
        <div className="tl-title" style={{ marginTop: 14 }}><Layers size={13} /> Data layer</div>
        <div className="layer-seg">
          {Object.entries(LAYERS).map(([k, l]) => (
            <button key={k} className={layer === k ? 'on' : ''} onClick={() => setLayer(k)}>{l.label}</button>
          ))}
        </div>
        {LAYERS[layer].stops ? (
          <div className="legend">
            <i style={{ background: `linear-gradient(90deg, ${LAYERS[layer].stops.join(',')})` }} />
            <div><span>{LAYERS[layer].legend[0]}</span><span>{LAYERS[layer].legend[1]}</span></div>
          </div>
        ) : (
          <div className="legend-status">
            {['nominal', 'warning', 'critical', 'offline'].map((s) => <span key={s}><span className={`dot ${s}`} />{STATUS_LABEL[s]}</span>)}
          </div>
        )}
        <button className="btn btn-ghost btn-sm reset" onClick={() => { setSelected(null); setHome((h) => h + 1) }}><Home size={14} />Reset view</button>
      </aside>

      <aside className={`twin-right glass sheet-${sheet}`}>
        <div className="sheet-tabs" role="tablist">
          <button role="tab" aria-selected={sheet === 'insights'} className={sheet === 'insights' ? 'on' : ''} onClick={() => setSheet('insights')}><BarChart3 size={15} />Insights<kbd>I</kbd></button>
          <button role="tab" aria-selected={sheet === 'advisory'} className={sheet === 'advisory' ? 'on' : ''} onClick={() => setSheet('advisory')}><ClipboardCheck size={15} />Advisory{pendingCount > 0 && <span className="pill">{pendingCount}</span>}<kbd>A</kbd></button>
          <button role="tab" aria-selected={sheet === 'chat'} className={sheet === 'chat' ? 'on' : ''} onClick={() => setSheet('chat')}><MessageSquareText size={15} />Ask<kbd>K</kbd></button>
        </div>
        <div className="tr-pane">
          {sheet === 'insights' && (
            <AnimatePresence mode="wait">
              <motion.div key={selected || 'farm'} initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -16 }} transition={{ duration: 0.3 }} style={{ height: '100%' }}>
                {plot ? <ZonePanel zone={plot} plots={plots} onClose={() => setSelected(null)} onAdvisory={() => setSheet('advisory')} /> : <FarmOverview farm={farm} plots={plots} onSelect={select} />}
              </motion.div>
            </AnimatePresence>
          )}
          {sheet === 'advisory' && <AdvisoryPanel plot={plot} onSelect={openAdvisory} />}
          {sheet === 'chat' && <ChatPanel plot={plot} />}
        </div>
      </aside>

      <AnimatePresence>
        {!selected && ready && !loading && (
          <motion.div className="twin-hint" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            <MousePointerClick size={16} className="accent" />
            <span><b>Click a plot</b> to inspect it or draft its advisory · drag to orbit · scroll to zoom · keys 1–{Math.max(1, plots.length)} · I / A / K switch tabs · Esc resets</span>
          </motion.div>
        )}
      </AnimatePresence>

      <RegisterFarmModal open={register} onClose={() => setRegister(false)} />
    </div>
  )
}

function ThrowGL() { throw new Error('no webgl') }
