import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { api, probe, onModeChange, getMode } from '../lib/api'

const TwinCtx = createContext(null)

const SOIL = { soilMoisture: 22, soilTemperature: 17, soilEC: 0.3, soilOrganicCarbon: 2, nitrogenLevel: 0.15, phosphorusLevel: 15, potassiumLevel: 0.4, aluminiumLevel: 0.5, soilTextureClass: 'unknown' }
const CROP = { ndvi: 0.4, evi: 0.3, cloudCover: 0, growthStage: 'unplanted', daysAfterPlanting: 0, accumulatedGDD: 0 }
const ATMO = { ambientTemperature: 18, relativeHumidity: 65, precipitation: 0 }
const AGRO = { variety: '', plantingDate: null, areaHa: 1, substorTuberFreshYield: null, substorLeafAreaIndex: null, simcastBlightRisk: 'none', simcastSprayRecommended: false }

/** Make any Plot from the API safe for the 3D scene and the panels (new twins start with sparse state). */
export function normalizePlot(p, i = 0) {
  const soil = { ...SOIL, ...(p.soil || {}) }, crop = { ...CROP, ...(p.crop || {}) }
  const soilPH = typeof p.soilPH === 'number' ? p.soilPH : 6
  const series = p.series || {}
  const fill = (v) => Array(7).fill(v)
  return {
    ...p,
    plotId: p.plotId || p.zoneId, zoneId: p.zoneId || p.plotId,
    grid: Array.isArray(p.grid) ? p.grid : [i % 3, Math.floor(i / 3) % 2],
    status: p.status || 'unknown',
    source: { soil: 'unknown', crop: 'unknown', model: 'unknown', ...(p.source || {}) },
    atmosphere: { ...ATMO, ...(p.atmosphere || {}) }, soil, crop, soilPH,
    agronomy: { ...AGRO, ...(p.agronomy || {}) },
    series: { soilMoisture: series.soilMoisture || fill(soil.soilMoisture), soilPH: series.soilPH || fill(soilPH), ndvi: series.ndvi || fill(crop.ndvi), accumulatedGDD: series.accumulatedGDD || fill(crop.accumulatedGDD) },
    insight: p.insight || 'No readings ingested yet.',
    flags: p.flags || [],
    pendingAdvisoryId: p.pendingAdvisoryId || null,
    latestAdvisoryStatus: p.latestAdvisoryStatus || null,
  }
}

export function TwinProvider({ children }) {
  const [health, setHealth] = useState(null)
  const [mode, setMode] = useState(getMode())
  const [office, setOffice] = useState(null)
  const [farms, setFarms] = useState([])
  const [selectedFarmId, setSelectedFarmId] = useState(() => { try { return localStorage.getItem('ci.farm') || null } catch { return null } })
  const [farm, setFarm] = useState(null)
  const [plots, setPlots] = useState([])
  const [advisories, setAdvisories] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const booted = useRef(false)

  useEffect(() => onModeChange(setMode), [])

  const refreshFarms = useCallback(async () => {
    const list = await api.farms()
    setFarms(list)
    return list
  }, [])

  const refreshFarm = useCallback(async (id) => {
    if (!id) return null
    const f = await api.farm(id)
    setFarm(f)
    setPlots((f.plots || []).map(normalizePlot))
    return f
  }, [])

  const refreshAdvisories = useCallback(async (id) => {
    if (!id) return []
    const list = await api.advisories({ farmId: id })
    setAdvisories(list)
    return list
  }, [])

  // boot: probe backend, load office + farms, pick a farm
  useEffect(() => {
    if (booted.current) return
    booted.current = true
    ;(async () => {
      try {
        const h = await probe()
        setHealth(h)
        const [o, list] = await Promise.all([api.office(), api.farms()])
        setOffice(o); setFarms(list)
        setSelectedFarmId((cur) => (cur && list.some((f) => f.farmId === cur) ? cur : list[0]?.farmId || null))
      } catch (e) {
        setError(e.message || String(e))
      } finally { setLoading(false) }
    })()
  }, [])

  // load the selected farm's twin + advisories
  useEffect(() => {
    if (!selectedFarmId) return
    try { localStorage.setItem('ci.farm', selectedFarmId) } catch { /* private mode */ }
    let alive = true
    setError(null)
    Promise.all([refreshFarm(selectedFarmId), refreshAdvisories(selectedFarmId)]).catch((e) => { if (alive) setError(e.message || String(e)) })
    return () => { alive = false }
  }, [selectedFarmId, refreshFarm, refreshAdvisories])

  const refreshAll = useCallback(async () => {
    await Promise.all([refreshFarms(), refreshFarm(selectedFarmId), refreshAdvisories(selectedFarmId)])
  }, [refreshFarms, refreshFarm, refreshAdvisories, selectedFarmId])

  const registerFarm = useCallback(async (body) => {
    const created = await api.createFarm(body)
    await refreshFarms()
    setSelectedFarmId(created.farmId)
    return created
  }, [refreshFarms])

  const decide = useCallback(async (advisoryId, body) => {
    const updated = await api.decide(advisoryId, body)
    await refreshAll()
    return updated
  }, [refreshAll])

  const value = useMemo(() => ({
    health, mode, isMock: mode === 'mock', office, officers: office?.officers || [],
    farms, selectedFarmId, selectFarm: setSelectedFarmId, farm, plots, advisories,
    plotById: (id) => plots.find((p) => p.plotId === id) || null,
    loading, error,
    refreshFarms, refreshFarm: () => refreshFarm(selectedFarmId), refreshAdvisories: () => refreshAdvisories(selectedFarmId), refreshAll,
    registerFarm, decide,
  }), [health, mode, office, farms, selectedFarmId, farm, plots, advisories, loading, error, refreshFarms, refreshFarm, refreshAdvisories, refreshAll, registerFarm, decide])

  return <TwinCtx.Provider value={value}>{children}</TwinCtx.Provider>
}

export function useTwin() {
  const ctx = useContext(TwinCtx)
  if (!ctx) throw new Error('useTwin must be used inside <TwinProvider>')
  return ctx
}
