// Plot vocabulary shared by the twin UI. Plot VALUES now come from the
// AgriTwin API (or the bundled mock) through src/state/TwinContext.jsx; the
// metric metadata below is keyed by the real OpenUSD attribute names from
// schema/farmSensor/schema.usda so a live sensor can drop in without renaming.

export const STAGES = {
  unplanted: 'Unplanted', emergence: 'Emergence', tuber_initiation: 'Tuber initiation',
  tuber_bulking: 'Tuber bulking', maturation: 'Maturation', harvested: 'Harvested',
}
export const STAGE_ORDER = ['emergence', 'tuber_initiation', 'tuber_bulking', 'maturation', 'harvested']

export const TEXTURE = { sandy_loam: 'Sandy loam', loam: 'Loam', clay_loam: 'Clay loam', clay: 'Clay', unknown: 'Unknown' }

export const SOURCE_LABEL = {
  agrifusion_assessment: 'soil assessment schema',
  farmwise_snapshot: 'crop snapshot schema',
  synthetic: 'synthetic (demo)',
  unknown: 'no readings yet',
}

// Metric metadata: label, unit, schema attribute and a one-line meaning.
export const METRICS = {
  soilMoisture: { label: 'Soil moisture', unit: '% VWC', attr: 'farmSensor:soilMoisture', digits: 1 },
  soilTemperature: { label: 'Soil temperature', unit: '°C', attr: 'farmSensor:soilTemperature', digits: 1 },
  soilEC: { label: 'Electrical conductivity', unit: 'dS/m', attr: 'farmSensor:soilEC', digits: 2 },
  soilOrganicCarbon: { label: 'Organic carbon', unit: '%', attr: 'farmSensor:soilOrganicCarbon', digits: 1 },
  nitrogenLevel: { label: 'Nitrogen (N)', unit: '%', attr: 'farmSensor:nitrogenLevel', digits: 2 },
  phosphorusLevel: { label: 'Phosphorus (P)', unit: 'ppm', attr: 'farmSensor:phosphorusLevel', digits: 0 },
  potassiumLevel: { label: 'Potassium (K)', unit: 'cmol/kg', attr: 'farmSensor:potassiumLevel', digits: 2 },
  aluminiumLevel: { label: 'Aluminium', unit: 'cmol/kg', attr: 'farmSensor:aluminiumLevel', digits: 2 },
  soilPH: { label: 'Soil pH', unit: '', attr: 'farmSensor:soilPH', digits: 1 },
  ndvi: { label: 'NDVI', unit: '', attr: 'farmZone:ndvi', digits: 2 },
  evi: { label: 'EVI', unit: '', attr: 'farmZone:evi', digits: 2 },
  cloudCover: { label: 'Cloud cover', unit: '%', attr: 'farmZone:cloudCover', digits: 0 },
  daysAfterPlanting: { label: 'Days after planting', unit: 'days', attr: 'farmZone:daysAfterPlanting', digits: 0 },
  accumulatedGDD: { label: 'Growing degree days', unit: 'GDD', attr: 'farmZone:accumulatedGDD', digits: 0 },
  ambientTemperature: { label: 'Air temp', unit: '°C', attr: 'farmSensor:ambientTemperature', digits: 1 },
  relativeHumidity: { label: 'Humidity', unit: '%', attr: 'farmSensor:relativeHumidity', digits: 0 },
  precipitation: { label: 'Rain (24h)', unit: 'mm', attr: 'farmSensor:precipitation', digits: 1 },
  areaHa: { label: 'Area', unit: 'ha', attr: 'farmZone:areaHa', digits: 1 },
  substorTuberFreshYield: { label: 'Yield outlook', unit: 't/ha', attr: 'cropModel:substorTuberFreshYield', digits: 1 },
  substorLeafAreaIndex: { label: 'Leaf area index', unit: '', attr: 'cropModel:substorLeafAreaIndex', digits: 1 },
}

