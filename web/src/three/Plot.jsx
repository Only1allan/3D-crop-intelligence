import { useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { Html, Line } from '@react-three/drei'
import { PLOT_W, PLOT_D, ROWS, PER_ROW, plotCenter, mulberry32 } from './layout'
import { swayMaterial } from './materials'
import { STATUS_COLOR, LAYERS } from '../lib/status'
import { STAGES } from '../data/zones'

const plantGeo = new THREE.IcosahedronGeometry(0.5, 0)
plantGeo.translate(0, 0.3, 0)
const leafGeo = new THREE.IcosahedronGeometry(0.32, 0)
leafGeo.translate(0, 0.62, 0)
const ridgeGeo = new THREE.BoxGeometry(PLOT_W - 0.9, 0.32, 0.62)
const plantMat = swayMaterial({ flatShading: true, roughness: 0.85 }, 0.1)
const leafMat = swayMaterial({ flatShading: true, roughness: 0.8 }, 0.14)
const ridgeMat = new THREE.MeshStandardMaterial({ roughness: 1, flatShading: true })

const STAGE_SCALE = { emergence: 0.38, tuber_initiation: 0.72, tuber_bulking: 1, maturation: 0.92, harvested: 0.1, unplanted: 0 }

function hatchTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64
  const g = c.getContext('2d')
  g.strokeStyle = 'rgba(255,255,255,0.9)'; g.lineWidth = 6
  for (let i = -64; i < 128; i += 16) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i + 64, 64); g.stroke() }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(6, 4)
  return t
}
let HATCH
const rect = (w, d, y) => [[-w / 2, y, -d / 2], [w / 2, y, -d / 2], [w / 2, y, d / 2], [-w / 2, y, d / 2], [-w / 2, y, -d / 2]]

export default function Plot({ zone, layer, hovered, selected, dimmed, onHover, onSelect, interactive = true, showLabel = true }) {
  const [cx, cz] = plotCenter(zone.grid)
  const plants = useRef(), leaves = useRef(), ridges = useRef(), pulse = useRef(), beacon = useRef(), overlay = useRef()
  const scale = STAGE_SCALE[zone.crop.growthStage] ?? 1
  const seed = zone.zoneId.charCodeAt(0) * 31 + zone.zoneId.charCodeAt(1)

  // Soil colour tracks moisture: dry = pale tan, wet = dark loam.
  const soilColor = useMemo(() => {
    const t = Math.min(1, Math.max(0, (zone.soil.soilMoisture - 10) / 28))
    return new THREE.Color('#8a6a45').lerp(new THREE.Color('#2b1d12'), t)
  }, [zone.soil.soilMoisture])

  useLayoutEffect(() => {
    const rnd = mulberry32(seed)
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3()
    const e = new THREE.Euler()
    // canopy colour from NDVI; maturation yellows
    const lush = new THREE.Color('#2f9e44'), weak = new THREE.Color('#a3a33a'), senesce = new THREE.Color('#b59a3c')
    const t = Math.min(1, Math.max(0, (zone.crop.ndvi - 0.38) / 0.4))
    const base = zone.crop.growthStage === 'maturation' ? senesce.clone().lerp(lush, 0.25) : weak.clone().lerp(lush, t)
    const c = new THREE.Color()
    let i = 0
    const dz = PLOT_D / ROWS, dx = PLOT_W / PER_ROW
    for (let r = 0; r < ROWS; r++) {
      const z = -PLOT_D / 2 + dz * (r + 0.5)
      m.compose(p.set(0, 0.16, z), q.identity(), s.set(1, 1, 1))
      ridges.current.setMatrixAt(r, m)
      for (let k = 0; k < PER_ROW; k++) {
        const x = -PLOT_W / 2 + dx * (k + 0.5) + (rnd() - 0.5) * 0.25
        const sc = scale * (0.8 + rnd() * 0.45)
        e.set((rnd() - 0.5) * 0.3, rnd() * Math.PI * 2, (rnd() - 0.5) * 0.3)
        m.compose(p.set(x, 0.3, z + (rnd() - 0.5) * 0.12), q.setFromEuler(e), s.set(sc * 1.1, sc * (0.8 + rnd() * 0.3), sc * 1.1))
        plants.current.setMatrixAt(i, m)
        leaves.current.setMatrixAt(i, m)
        c.copy(base).offsetHSL((rnd() - 0.5) * 0.03, (rnd() - 0.5) * 0.1, (rnd() - 0.5) * 0.08)
        plants.current.setColorAt(i, c)
        leaves.current.setColorAt(i, c.offsetHSL(0.01, 0.05, 0.07))
        i++
      }
    }
    for (const im of [plants.current, leaves.current, ridges.current]) {
      im.instanceMatrix.needsUpdate = true
      if (im.instanceColor) im.instanceColor.needsUpdate = true
      im.computeBoundingSphere()
    }
    for (let r = 0; r < ROWS; r++) ridges.current.setColorAt(r, soilColor.clone().offsetHSL(0, 0, 0.03))
    ridges.current.instanceColor.needsUpdate = true
  }, [zone, seed, scale, soilColor])

  const alert = zone.status === 'warning' || zone.status === 'critical'
  const statusColor = STATUS_COLOR[zone.status]
  const layerOn = layer !== 'status'
  const overlayColor = LAYERS[layer].color(zone)

  useFrame(({ clock }) => {
    const t = clock.elapsedTime
    if (pulse.current) {
      const k = (t * (zone.status === 'critical' ? 0.9 : 0.55)) % 1
      pulse.current.scale.set(1 + k * 0.14, 1, 1 + k * 0.2)
      pulse.current.children.forEach((l) => { if (l.material) l.material.opacity = (1 - k) * 0.9 })
    }
    if (beacon.current) {
      beacon.current.material.opacity = 0.18 + Math.sin(t * 4) * 0.08
      beacon.current.rotation.y = t * 0.6
    }
    if (overlay.current) {
      const target = layerOn ? 0.5 : selected ? 0.1 : hovered ? 0.14 : 0
      overlay.current.material.opacity += (target - overlay.current.material.opacity) * 0.12
      overlay.current.visible = overlay.current.material.opacity > 0.01
    }
  })

  if (!HATCH && typeof document !== 'undefined') HATCH = hatchTexture()
  const n = ROWS * PER_ROW
  const borderColor = selected ? '#bef264' : hovered ? '#ffffff' : statusColor
  const handlers = interactive ? {
    onPointerOver: (e) => { e.stopPropagation(); onHover?.(zone.zoneId); document.body.style.cursor = 'pointer' },
    onPointerOut: () => { onHover?.(null); document.body.style.cursor = '' },
    onClick: (e) => { e.stopPropagation(); onSelect?.(zone.zoneId) },
  } : {}

  return (
    <group position={[cx, 0, cz]}>
      {/* soil bed */}
      <mesh receiveShadow position={[0, 0.04, 0]}>
        <boxGeometry args={[PLOT_W, 0.1, PLOT_D]} />
        <meshStandardMaterial color={soilColor} roughness={1} />
      </mesh>
      <instancedMesh ref={ridges} args={[ridgeGeo, ridgeMat, ROWS]} receiveShadow castShadow />
      <instancedMesh ref={plants} args={[plantGeo, plantMat, n]} castShadow receiveShadow />
      <instancedMesh ref={leaves} args={[leafGeo, leafMat, n]} castShadow />

      {/* data-layer / hover overlay */}
      <mesh ref={overlay} rotation-x={-Math.PI / 2} position={[0, 1.45, 0]} visible={false} renderOrder={2}>
        <planeGeometry args={[PLOT_W, PLOT_D]} />
        <meshBasicMaterial color={layerOn ? overlayColor : selected ? '#bef264' : '#ffffff'} transparent opacity={0} depthWrite={false} toneMapped={false} />
      </mesh>
      {zone.status === 'offline' && (
        <mesh rotation-x={-Math.PI / 2} position={[0, 1.5, 0]} renderOrder={3}>
          <planeGeometry args={[PLOT_W, PLOT_D]} />
          <meshBasicMaterial color="#9ca3af" alphaMap={HATCH} transparent opacity={dimmed ? 0.18 : 0.32} depthWrite={false} />
        </mesh>
      )}

      {/* border: status colour, brighter on hover, lime when selected */}
      <Line points={rect(PLOT_W + 0.6, PLOT_D + 0.6, 0.22)} color={borderColor} lineWidth={selected ? 4 : hovered ? 3 : 1.6}
        transparent opacity={selected || hovered ? 1 : 0.75} toneMapped={false} />
      {alert && (
        <group ref={pulse}>
          <Line points={rect(PLOT_W + 0.6, PLOT_D + 0.6, 0.25)} color={statusColor} lineWidth={2.5} transparent opacity={0.8} toneMapped={false} />
        </group>
      )}
      {(zone.status === 'critical' || selected) && (
        <mesh ref={beacon} position={[0, 7, 0]}>
          <cylinderGeometry args={[0.5, 1.6, 14, 24, 1, true]} />
          <meshBasicMaterial color={selected ? '#bef264' : statusColor} transparent opacity={0.2} side={THREE.DoubleSide} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
        </mesh>
      )}

      {/* hit area */}
      <mesh position={[0, 0.9, 0]} {...handlers}>
        <boxGeometry args={[PLOT_W + 0.6, 1.8, PLOT_D + 0.6]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>

      {showLabel && (
        <Html position={[0, selected ? 4.2 : 3.2, 0]} center zIndexRange={[9, 0]} style={{ pointerEvents: 'none' }}>
          <div className={`plot-label ${zone.status} ${selected ? 'sel' : ''} ${hovered ? 'hov' : ''} ${dimmed ? 'dim' : ''}`}>
            <span className={`dot ${zone.status}`} />
            <b>{zone.zoneId}</b>
            <span className="pl-name">{zone.displayName}</span>
            {(hovered || selected) && (
              <span className="pl-extra">
                pH {zone.soilPH} · {zone.soil.soilMoisture}% H₂O · NDVI {zone.crop.ndvi} · {STAGES[zone.crop.growthStage]}
              </span>
            )}
          </div>
        </Html>
      )}
    </group>
  )
}
