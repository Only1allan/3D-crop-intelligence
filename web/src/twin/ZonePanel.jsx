import { useState } from 'react'
import { X, Droplets, Sprout, FlaskConical, Tractor, CloudRain, Thermometer, Wind, AlertTriangle, Database, Users, ClipboardCheck } from 'lucide-react'
import { METRICS, STAGES, STAGE_ORDER, TEXTURE, SOURCE_LABEL } from '../data/zones'
import { STATUS_COLOR, STATUS_LABEL, metricLevel, fmt, ago, blightBand } from '../lib/status'
import Sparkline from './Sparkline'
import PhGauge from './PhGauge'

const LEVEL_COLOR = { nominal: '#4ade80', warning: '#fbbf24', critical: '#f87171' }

function Row({ k, v, zone, series }) {
  const m = METRICS[k]
  const lvl = metricLevel(k, v, zone)
  return (
    <div className="m-row" title={`USD attribute: ${m.attr}`}>
      <span className={`dot ${lvl}`} />
      <span className="m-label">{m.label}<code>{m.attr}</code></span>
      {series && <Sparkline data={series} color={LEVEL_COLOR[lvl]} />}
      <span className="m-val">{fmt(v, m.digits)}<small>{m.unit}</small></span>
    </div>
  )
}

function Group({ icon: Icon, title, source, children }) {
  return (
    <section className="m-group">
      <header><Icon size={15} /><h4>{title}</h4><span className="prov">{SOURCE_LABEL[source]}</span></header>
      {children}
    </section>
  )
}

const TABS = ['Overview', 'Soil', 'pH', 'Crop', 'Agronomy']

export function ZonePanel({ zone, plots = [], onClose, onAdvisory }) {
  const [tab, setTab] = useState('Overview')
  const s = zone.soil, c = zone.crop, a = zone.agronomy, at = zone.atmosphere
  const stageIdx = STAGE_ORDER.indexOf(c.growthStage)
  return (
    <div className="zp">
      <div className="zp-head">
        <div>
          <div className="zp-id"><span className={`dot ${zone.status}`} />Plot {zone.zoneId} · {a.variety} · {a.areaHa} ha</div>
          <h3>{zone.displayName}</h3>
        </div>
        <button className="icon-btn" onClick={onClose} aria-label="Close plot (Esc)"><X size={18} /></button>
      </div>
      <div className="zp-household">
        <Users size={13} />
        <span><b>{zone.householdName || 'Unassigned household'}</b>{zone.contactMethod ? ` · ${zone.contactMethod.toUpperCase()}` : ''}{zone.lastVisit?.date ? ` · last visit ${zone.lastVisit.date}` : ''}</span>
        {onAdvisory && <button type="button" className={`zp-adv ${zone.pendingAdvisoryId ? 'pending' : ''}`} onClick={onAdvisory}><ClipboardCheck size={12} />{zone.pendingAdvisoryId ? 'Draft waiting' : 'Advisory'}</button>}
      </div>
      <div className="zp-status" style={{ '--sc': STATUS_COLOR[zone.status] }}>
        {zone.status !== 'nominal' && <AlertTriangle size={16} />}
        <div><b>{STATUS_LABEL[zone.status]}</b><span>{zone.insight}</span></div>
      </div>
      <div className="zp-atmo">
        <span><Thermometer size={14} />{at.ambientTemperature}°C</span>
        <span><Wind size={14} />{at.relativeHumidity}% RH</span>
        <span><CloudRain size={14} />{at.precipitation} mm</span>
        <span className={zone.status === 'offline' ? 'stale' : ''}><Database size={14} />{ago(zone.lastUpdateTime)}</span>
      </div>
      <div className="tabs" role="tablist">
        {TABS.map((t) => <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>{t}</button>)}
      </div>
      <div className="zp-body">
        {tab === 'Overview' && (
          <>
            <div className="kpis">
              <Kpi icon={FlaskConical} label="Soil pH" v={zone.soilPH.toFixed(1)} lvl={metricLevel('soilPH', zone.soilPH)} series={zone.series.soilPH} />
              <Kpi icon={Droplets} label="Moisture" v={`${s.soilMoisture}%`} lvl={metricLevel('soilMoisture', s.soilMoisture)} series={zone.series.soilMoisture} />
              <Kpi icon={Sprout} label="NDVI" v={c.ndvi.toFixed(2)} lvl={metricLevel('ndvi', c.ndvi, zone)} series={zone.series.ndvi} />
              <Kpi icon={Tractor} label="Blight risk" v={a.simcastBlightRisk} lvl={blightBand(a.simcastBlightRisk).level} />
            </div>
            <div className="stage">
              <div className="stage-top"><span>Growth stage</span><b>{STAGES[c.growthStage]} · day {c.daysAfterPlanting}</b></div>
              <div className="stage-track">
                {STAGE_ORDER.slice(0, 4).map((st, i) => <i key={st} className={i < stageIdx ? 'done' : i === stageIdx ? 'now' : ''} title={STAGES[st]} />)}
              </div>
              <div className="stage-lbl">{STAGE_ORDER.slice(0, 4).map((st) => <span key={st}>{STAGES[st]}</span>)}</div>
            </div>
          </>
        )}
        {tab === 'Soil' && (
          <Group icon={Droplets} title="Soil ingestion intelligence" source={zone.source.soil}>
            <Row k="soilMoisture" v={s.soilMoisture} zone={zone} series={zone.series.soilMoisture} />
            {['soilTemperature', 'soilEC', 'soilOrganicCarbon', 'nitrogenLevel', 'phosphorusLevel', 'potassiumLevel', 'aluminiumLevel'].map((k) => <Row key={k} k={k} v={s[k]} zone={zone} />)}
            <div className="m-row"><span className="dot nominal" /><span className="m-label">Texture<code>farmSensor:soilTextureClass</code></span><span className="m-val">{TEXTURE[s.soilTextureClass]}</span></div>
          </Group>
        )}
        {tab === 'pH' && (
          <Group icon={FlaskConical} title="pH levels" source={zone.source.soil}>
            <PhGauge ph={zone.soilPH} />
            <Row k="soilPH" v={zone.soilPH} zone={zone} series={zone.series.soilPH} />
            <Row k="aluminiumLevel" v={s.aluminiumLevel} zone={zone} />
            <div className="farm-ph">
              {plots.map((z) => <div key={z.zoneId} className={z.zoneId === zone.zoneId ? 'me' : ''}><span>{z.zoneId}</span><b style={{ color: z.soilPH < 5.5 ? '#fbbf24' : '#4ade80' }}>{z.soilPH}</b></div>)}
            </div>
          </Group>
        )}
        {tab === 'Crop' && (
          <Group icon={Sprout} title="Crop monitoring intelligence" source={zone.source.crop}>
            <Row k="ndvi" v={c.ndvi} zone={zone} series={zone.series.ndvi} />
            <Row k="evi" v={c.evi} zone={zone} />
            <Row k="accumulatedGDD" v={c.accumulatedGDD} zone={zone} series={zone.series.accumulatedGDD} />
            <Row k="daysAfterPlanting" v={c.daysAfterPlanting} zone={zone} />
            <Row k="cloudCover" v={c.cloudCover} zone={zone} />
            <div className="m-row"><span className="dot nominal" /><span className="m-label">Growth stage<code>farmZone:growthStage</code></span><span className="m-val">{STAGES[c.growthStage]}</span></div>
          </Group>
        )}
        {tab === 'Agronomy' && (
          <Group icon={Tractor} title="Agronomic data" source={zone.source.model}>
            <div className="m-row"><span className="dot nominal" /><span className="m-label">Variety<code>farmZone:variety</code></span><span className="m-val">{a.variety}</span></div>
            <div className="m-row"><span className="dot nominal" /><span className="m-label">Planting date<code>farmZone:plantingDate</code></span><span className="m-val">{a.plantingDate}</span></div>
            <Row k="areaHa" v={a.areaHa} zone={zone} />
            <Row k="substorTuberFreshYield" v={a.substorTuberFreshYield} zone={zone} />
            <Row k="substorLeafAreaIndex" v={a.substorLeafAreaIndex} zone={zone} />
            <div className="m-row"><span className={`dot ${blightBand(a.simcastBlightRisk).level}`} /><span className="m-label">Blight risk<code>cropModel:simcastBlightRisk</code></span><span className="m-val">{a.simcastBlightRisk}</span></div>
            <div className="m-row"><span className={`dot ${a.simcastSprayRecommended ? 'critical' : 'nominal'}`} /><span className="m-label">Spray recommended<code>cropModel:simcastSprayRecommended</code></span><span className="m-val">{a.simcastSprayRecommended ? 'Yes' : 'No'}</span></div>
            <p className="stub-note">Yield and blight values are synthetic model outputs on the SUBSTOR / SimCast attribute names; the rule engine treats them as one signal among several.</p>
          </Group>
        )}
      </div>
      <div className="zp-foot">Synthetic plot values on the real farmSensor schema · rainfall live from Open-Meteo · updated via the AgriTwin MCP server</div>
    </div>
  )
}

function Kpi({ icon: Icon, label, v, lvl, series }) {
  return (
    <div className={`kpi ${lvl}`}>
      <div className="kpi-top"><Icon size={14} /><span>{label}</span></div>
      <div className="kpi-v">{v}</div>
      {series ? <Sparkline data={series} color={LEVEL_COLOR[lvl]} w={110} h={18} /> : <div className="kpi-bar"><i /></div>}
    </div>
  )
}

export function FarmOverview({ farm, plots = [], onSelect }) {
  const alerts = plots.filter((z) => z.status !== 'nominal')
  const n = plots.length || 1
  const avg = (f) => (plots.reduce((s, z) => s + f(z), 0) / n)
  const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '')
  return (
    <div className="zp">
      <div className="zp-head">
        <div>
          <div className="zp-id"><span className="dot nominal" />{farm?.name || 'Farm'} · {plots.length} plots · {farm?.totalHa ?? '—'} ha · {cap(farm?.crop)}</div>
          <h3>Whole-farm view</h3>
        </div>
      </div>
      <div className="kpis" style={{ padding: '0 18px' }}>
        <Kpi icon={FlaskConical} label="Avg pH" v={avg((z) => z.soilPH).toFixed(1)} lvl="nominal" />
        <Kpi icon={Droplets} label="Avg moisture" v={`${avg((z) => z.soil.soilMoisture).toFixed(0)}%`} lvl="nominal" />
        <Kpi icon={Sprout} label="Avg NDVI" v={avg((z) => z.crop.ndvi).toFixed(2)} lvl="nominal" />
        <Kpi icon={AlertTriangle} label="Plots flagged" v={`${alerts.length} / ${plots.length}`} lvl={alerts.length ? 'warning' : 'nominal'} />
      </div>
      <div className="alerts">
        <h4>Needs the office's attention</h4>
        {alerts.map((z) => (
          <button key={z.zoneId} className="alert-row" style={{ '--sc': STATUS_COLOR[z.status] }} onClick={() => onSelect(z.zoneId)}>
            <span className={`dot ${z.status}`} />
            <div><b>{z.zoneId} · {z.displayName} · {z.householdName}</b><span>{z.insight}</span></div>
          </button>
        ))}
        {!alerts.length && <p className="adv-empty-note">All plots are inside their bands.</p>}
      </div>
      <div className="zp-foot">Click any plot in 3D to open its intelligence. Synthetic plot values on the real schema; rainfall is live.</div>
    </div>
  )
}
