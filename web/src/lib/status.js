// Agronomic bands used by the panel, the 3D heatmaps and the offline advisor.
// Thresholds are potato rules of thumb, the agent's rule engine uses the same bands server-side.

export const STATUS_COLOR = {
  nominal: '#4ade80', warning: '#fbbf24', critical: '#f87171', offline: '#6b7280', unknown: '#9ca3af',
}
export const STATUS_LABEL = {
  nominal: 'Healthy', warning: 'Needs attention', critical: 'Act now', offline: 'Sensor offline', unknown: 'Unknown',
}

export function phBand(ph) {
  if (ph < 5.5) return { level: 'warning', text: 'Too acidic: lime suggested' }
  if (ph > 7.0) return { level: 'warning', text: 'Too alkaline for potato' }
  if (ph > 6.5) return { level: 'nominal', text: 'Slightly high, acceptable' }
  return { level: 'nominal', text: 'In the potato optimum (5.5 to 6.5)' }
}
export function moistureBand(m) {
  if (m < 18) return { level: 'warning', text: 'Dry: irrigate' }
  if (m > 34) return { level: 'warning', text: 'Waterlogged: blight and rot risk' }
  return { level: 'nominal', text: 'In range' }
}
export function ndviBand(n, stage) {
  if (stage === 'maturation' && n >= 0.4) return { level: 'nominal', text: 'Normal senescence' }
  if (stage === 'emergence') return { level: 'nominal', text: 'Early canopy' }
  if (n < 0.55) return { level: 'warning', text: 'Weak canopy' }
  return { level: 'nominal', text: 'Vigorous canopy' }
}
export function blightBand(risk) {
  if (risk === 'high' || risk === 'severe') return { level: 'critical', text: 'Spray window: act within 24 h' }
  if (risk === 'moderate') return { level: 'warning', text: 'Watch closely' }
  return { level: 'nominal', text: 'Low pressure' }
}

export function metricLevel(key, value, zone) {
  switch (key) {
    case 'soilPH': return phBand(value).level
    case 'soilMoisture': return moistureBand(value).level
    case 'ndvi': return ndviBand(value, zone?.crop.growthStage).level
    case 'aluminiumLevel': return value > 1.0 ? 'warning' : 'nominal'
    case 'phosphorusLevel': return value < 12 ? 'warning' : 'nominal'
    case 'potassiumLevel': return value < 0.35 ? 'warning' : 'nominal'
    case 'nitrogenLevel': return value < 0.15 ? 'warning' : 'nominal'
    case 'relativeHumidity': return value > 90 ? 'critical' : 'nominal'
    case 'soilOrganicCarbon': return value < 1.5 ? 'warning' : 'nominal'
    default: return 'nominal'
  }
}

export function fmt(v, digits = 1) {
  if (typeof v !== 'number') return v
  return v.toFixed(digits)
}

export function ago(iso, now = new Date('2026-09-27T09:00:00Z')) {
  const mins = Math.max(0, Math.round((now - new Date(iso)) / 60000))
  if (mins < 60) return `${mins} min ago`
  const h = Math.round(mins / 60)
  if (h < 48) return `${h} h ago`
  return `${Math.round(h / 24)} days ago`
}

// Colour ramps for the 3D data layers: t in 0..1 -> hex
const lerp = (a, b, t) => a + (b - a) * t
function ramp(stops, t) {
  t = Math.min(1, Math.max(0, t))
  for (let i = 0; i < stops.length - 1; i++) {
    const [t0, c0] = stops[i], [t1, c1] = stops[i + 1]
    if (t <= t1) {
      const k = (t - t0) / (t1 - t0)
      return '#' + [0, 1, 2].map((j) => Math.round(lerp(c0[j], c1[j], k)).toString(16).padStart(2, '0')).join('')
    }
  }
  const c = stops[stops.length - 1][1]
  return '#' + c.map((x) => x.toString(16).padStart(2, '0')).join('')
}
const RED = [248, 113, 113], AMBER = [251, 191, 36], GREEN = [74, 222, 128], BLUE = [56, 189, 248], BROWN = [180, 120, 60]

export const LAYERS = {
  status: { label: 'Health', color: (z) => STATUS_COLOR[z.status] },
  ndvi: { label: 'NDVI', color: (z) => ramp([[0, RED], [0.5, AMBER], [1, GREEN]], (z.crop.ndvi - 0.35) / 0.45), legend: ['0.35', '0.80'], stops: ['#f87171', '#fbbf24', '#4ade80'] },
  moisture: { label: 'Moisture', color: (z) => ramp([[0, BROWN], [0.45, GREEN], [1, BLUE]], (z.soil.soilMoisture - 10) / 28), legend: ['10%', '38%'], stops: ['#b4783c', '#4ade80', '#38bdf8'] },
  ph: { label: 'pH', color: (z) => ramp([[0, RED], [0.55, GREEN], [1, [167, 139, 250]]], (z.soilPH - 4.8) / 2.4), legend: ['4.8', '7.2'], stops: ['#f87171', '#4ade80', '#a78bfa'] },
}
