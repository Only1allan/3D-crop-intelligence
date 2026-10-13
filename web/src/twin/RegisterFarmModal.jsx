import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Plus, Trash2, MapPin, AlertTriangle } from 'lucide-react'
import { useTwin } from '../state/TwinContext'

const emptyPlot = (i) => ({ plotId: `P${i + 1}`, displayName: '', householdName: '', contactMethod: 'sms', areaHa: '1.0', variety: '', plantingDate: '' })

// POST /api/farms: register a new digital twin for the office (1–3 plots to start).
export default function RegisterFarmModal({ open, onClose }) {
  const { registerFarm } = useTwin()
  const [form, setForm] = useState({ name: '', region: '', crop: 'potato', lat: '-0.39', lon: '36.87', agroZoneId: 'KE-HL-UPPER' })
  const [plots, setPlots] = useState([emptyPlot(0)])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  useEffect(() => {
    if (!open) return
    const on = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  }, [open, onClose])

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))
  const setPlot = (i, k) => (e) => setPlots((ps) => ps.map((p, j) => (j === i ? { ...p, [k]: e.target.value } : p)))

  async function submit(e) {
    e.preventDefault()
    setErr(null)
    const lat = Number(form.lat), lon = Number(form.lon)
    if (!form.name.trim()) return setErr('Give the farm a name.')
    if (Number.isNaN(lat) || Number.isNaN(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return setErr('Latitude/longitude must be valid decimal degrees (used for Open-Meteo rainfall).')
    if (plots.some((p) => !p.householdName.trim())) return setErr('Every plot needs a household name.')
    setBusy(true)
    try {
      await registerFarm({
        name: form.name.trim(), region: form.region.trim(), crop: form.crop, lat, lon, agroZoneId: form.agroZoneId,
        plots: plots.map((p, i) => ({ plotId: p.plotId.trim() || `P${i + 1}`, displayName: p.displayName.trim() || `Plot ${i + 1}`, householdName: p.householdName.trim(), contactMethod: p.contactMethod, areaHa: Number(p.areaHa) || 1, variety: p.variety.trim() || undefined, plantingDate: p.plantingDate || undefined })),
      })
      setForm({ name: '', region: '', crop: 'potato', lat: '-0.39', lon: '36.87', agroZoneId: 'KE-HL-UPPER' }); setPlots([emptyPlot(0)])
      onClose()
    } catch (ex) { setErr(ex.message || String(ex)) } finally { setBusy(false) }
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div className="modal" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
          <motion.form className="modal-box glass" initial={{ scale: 0.96, y: 16 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.97, opacity: 0 }} onClick={(e) => e.stopPropagation()} onSubmit={submit}>
            <header className="modal-head">
              <div><span className="eyebrow" style={{ fontSize: 11 }}>New digital twin</span><h3>Register a farm</h3></div>
              <button type="button" className="icon-btn sm" onClick={onClose} aria-label="Close"><X size={16} /></button>
            </header>
            <p className="modal-note">One twin per farm, many farms per office. Plots start with no readings; rainfall for the coordinates is fetched from Open-Meteo on the first ingest.</p>
            <div className="form-grid">
              <label>Farm name<input value={form.name} onChange={set('name')} placeholder="e.g. Kipipiri Cluster" required autoFocus /></label>
              <label>Region<input value={form.region} onChange={set('region')} placeholder="e.g. Nyandarua, Kenya" /></label>
              <label>Crop<select value={form.crop} onChange={set('crop')}><option value="potato">Potato</option><option value="maize">Maize</option></select></label>
              <label>Agro-zone<input value={form.agroZoneId} onChange={set('agroZoneId')} /></label>
              <label><span><MapPin size={12} /> Latitude</span><input value={form.lat} onChange={set('lat')} inputMode="decimal" /></label>
              <label><span><MapPin size={12} /> Longitude</span><input value={form.lon} onChange={set('lon')} inputMode="decimal" /></label>
            </div>
            <div className="plots-edit">
              <div className="adv-sub">Plots · {plots.length} / 3</div>
              {plots.map((p, i) => (
                <div key={i} className="plot-edit">
                  <input value={p.plotId} onChange={setPlot(i, 'plotId')} placeholder="ID" aria-label="Plot id" style={{ width: 64 }} />
                  <input value={p.displayName} onChange={setPlot(i, 'displayName')} placeholder="Plot name" aria-label="Plot name" />
                  <input value={p.householdName} onChange={setPlot(i, 'householdName')} placeholder="Household name *" aria-label="Household name" required />
                  <select value={p.contactMethod} onChange={setPlot(i, 'contactMethod')} aria-label="Contact method"><option value="sms">SMS</option><option value="ussd">USSD</option><option value="visit">Visit</option></select>
                  <input value={p.areaHa} onChange={setPlot(i, 'areaHa')} placeholder="ha" aria-label="Area in hectares" inputMode="decimal" style={{ width: 60 }} />
                  <input value={p.variety} onChange={setPlot(i, 'variety')} placeholder="Variety" aria-label="Variety" />
                  <input type="date" value={p.plantingDate} onChange={setPlot(i, 'plantingDate')} aria-label="Planting date" />
                  <button type="button" className="icon-btn sm" onClick={() => setPlots((ps) => ps.filter((_, j) => j !== i))} disabled={plots.length === 1} aria-label="Remove plot"><Trash2 size={14} /></button>
                </div>
              ))}
              {plots.length < 3 && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPlots((ps) => [...ps, emptyPlot(ps.length)])}><Plus size={14} />Add plot</button>}
            </div>
            {err && <div className="df-err"><AlertTriangle size={13} />{err}</div>}
            <footer className="modal-foot">
              <button type="button" className="btn btn-ghost btn-sm" onClick={onClose} disabled={busy}>Cancel</button>
              <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>{busy ? 'Registering…' : 'Register twin'}</button>
            </footer>
          </motion.form>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
