import { useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { PLOT_W, PLOT_D, GAP, plotCenter, mulberry32 } from './layout'
import { swayMaterial } from './materials'

// ---------- terrain: flat farm pad, rolling hills beyond ---------------------
export function Terrain() {
  const geo = useMemo(() => {
    const g = new THREE.PlaneGeometry(320, 320, 160, 160)
    g.rotateX(-Math.PI / 2)
    const pos = g.attributes.position, col = []
    const c = new THREE.Color(), a = new THREE.Color('#1d3a1f'), b = new THREE.Color('#2f5a2a'), d = new THREE.Color('#0e1f10')
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i)
      const r = Math.hypot(x / 1.25, z)
      const k = THREE.MathUtils.smoothstep(r, 44, 90)
      const n = Math.sin(x * 0.07) * Math.cos(z * 0.06) * 3 + Math.sin(x * 0.021 + z * 0.03) * 7 + Math.sin(z * 0.13 + x * 0.05) * 1.2
      const y = k * (n + 6) - 0.05
      pos.setY(i, y)
      const v = 0.5 + 0.5 * Math.sin(x * 0.4 + Math.cos(z * 0.33) * 2)
      c.copy(a).lerp(b, v * 0.6).lerp(d, THREE.MathUtils.smoothstep(r, 70, 150))
      col.push(c.r, c.g, c.b)
    }
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
    g.computeVertexNormals()
    return g
  }, [])
  const padW = 3 * PLOT_W + 2 * GAP + 7, padD = 2 * PLOT_D + GAP + 7
  return (
    <group>
      <mesh geometry={geo} receiveShadow>
        <meshStandardMaterial vertexColors roughness={1} flatShading />
      </mesh>
      {/* dirt pad = the farm tracks between plots */}
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.01, 0]} receiveShadow>
        <planeGeometry args={[padW, padD]} />
        <meshStandardMaterial color="#5b4630" roughness={1} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.005, 0]} receiveShadow>
        <planeGeometry args={[padW + 3, padD + 3]} />
        <meshStandardMaterial color="#3d5a2c" roughness={1} />
      </mesh>
    </group>
  )
}

// ---------- trees ------------------------------------------------------------
const trunkGeo = new THREE.CylinderGeometry(0.18, 0.28, 2.2, 6); trunkGeo.translate(0, 1.1, 0)
const crownGeo = new THREE.IcosahedronGeometry(1.5, 0); crownGeo.translate(0, 3.1, 0)
const pineGeo = new THREE.ConeGeometry(1.3, 3.6, 7); pineGeo.translate(0, 3.4, 0)
const trunkMat = new THREE.MeshStandardMaterial({ color: '#4a3424', roughness: 1 })
const crownMat = swayMaterial({ flatShading: true, roughness: 0.9 }, 0.05)

export function Trees({ count = 150 }) {
  const trunks = useRef(), crowns = useRef(), pines = useRef()
  useLayoutEffect(() => {
    const rnd = mulberry32(7)
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), c = new THREE.Color()
    let ti = 0, ci = 0, pi = 0
    for (let i = 0; i < count; i++) {
      let x, z
      do { const a = rnd() * Math.PI * 2, r = 42 + rnd() * 48; x = Math.cos(a) * r * 1.25; z = Math.sin(a) * r } while (x > 28 && x < 46 && z > 6 && z < 24)
      const sc = 0.8 + rnd() * 0.9
      const hill = THREE.MathUtils.smoothstep(Math.hypot(x / 1.25, z), 44, 90) * 4
      m.compose(p.set(x, hill - 0.2, z), q.setFromEuler(new THREE.Euler(0, rnd() * 6, 0)), s.set(sc, sc, sc))
      trunks.current.setMatrixAt(ti++, m)
      c.setHSL(0.27 + rnd() * 0.07, 0.45 + rnd() * 0.2, 0.18 + rnd() * 0.1)
      if (rnd() > 0.45) { crowns.current.setMatrixAt(ci, m); crowns.current.setColorAt(ci++, c) }
      else { pines.current.setMatrixAt(pi, m); pines.current.setColorAt(pi++, c.offsetHSL(0.03, 0, -0.04)) }
    }
    trunks.current.count = ti; crowns.current.count = ci; pines.current.count = pi
    for (const im of [trunks.current, crowns.current, pines.current]) {
      im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true; im.computeBoundingSphere()
    }
  }, [count])
  return (
    <group>
      <instancedMesh ref={trunks} args={[trunkGeo, trunkMat, count]} castShadow />
      <instancedMesh ref={crowns} args={[crownGeo, crownMat, count]} castShadow />
      <instancedMesh ref={pines} args={[pineGeo, crownMat, count]} castShadow />
    </group>
  )
}

// ---------- farmstead --------------------------------------------------------
export function Farmstead() {
  const roof = useMemo(() => {
    const s = new THREE.Shape(); s.moveTo(-3.6, 0); s.lineTo(0, 2.6); s.lineTo(3.6, 0); s.lineTo(-3.6, 0)
    return new THREE.ExtrudeGeometry(s, { depth: 9, bevelEnabled: false })
  }, [])
  return (
    <group position={[-41, 0, -3]} rotation-y={0.25}>
      <mesh castShadow receiveShadow position={[0, 2, 0]}><boxGeometry args={[7, 4, 9]} /><meshStandardMaterial color="#7f2d1d" roughness={0.9} /></mesh>
      <mesh castShadow geometry={roof} position={[0, 4, -4.5]}><meshStandardMaterial color="#2a2a2a" roughness={0.7} flatShading /></mesh>
      <mesh position={[3.52, 1.6, 0]}><boxGeometry args={[0.05, 3, 3]} /><meshStandardMaterial color="#f5f5f4" /></mesh>
      <mesh castShadow position={[-6, 3.5, 2]}><cylinderGeometry args={[1.5, 1.5, 7, 16]} /><meshStandardMaterial color="#9ca3af" metalness={0.6} roughness={0.35} /></mesh>
      <mesh castShadow position={[-6, 7.4, 2]}><coneGeometry args={[1.6, 1.4, 16]} /><meshStandardMaterial color="#6b7280" metalness={0.6} roughness={0.3} /></mesh>
      <mesh castShadow receiveShadow position={[1, 1.4, 10]}><boxGeometry args={[5, 2.8, 4]} /><meshStandardMaterial color="#e7e5e4" roughness={0.9} /></mesh>
      <mesh castShadow position={[1, 3.3, 10]} rotation-y={Math.PI / 4}><coneGeometry args={[3.9, 1.8, 4]} /><meshStandardMaterial color="#44403c" flatShading /></mesh>
      <mesh position={[2.1, 1.6, 12.02]}><planeGeometry args={[1, 1]} /><meshBasicMaterial color="#fde68a" toneMapped={false} /></mesh>
    </group>
  )
}

export function Pond() {
  const ref = useRef()
  useFrame(({ clock }) => { if (ref.current) ref.current.material.opacity = 0.82 + Math.sin(clock.elapsedTime) * 0.04 })
  return (
    <group position={[37, 0.06, 15]}>
      <mesh rotation-x={-Math.PI / 2} scale={[1.4, 1, 1]}><circleGeometry args={[5.4, 40]} /><meshStandardMaterial color="#3f5a33" roughness={1} /></mesh>
      <mesh ref={ref} rotation-x={-Math.PI / 2} position={[0, 0.03, 0]} scale={[1.4, 1, 1]}>
        <circleGeometry args={[4.6, 40]} />
        <meshStandardMaterial color="#1d6f86" emissive="#0b3a4a" emissiveIntensity={0.6} metalness={0.2} roughness={0.15} transparent opacity={0.9} />
      </mesh>
    </group>
  )
}

// ---------- ingestion: probes, hub and data packets ---------------------------
const HUB_TOP = new THREE.Vector3(0, 6.6, 0)
export function probePos(zone) {
  const [cx, cz] = plotCenter(zone.grid)
  return [cx + (zone.grid[0] === 0 ? PLOT_W / 2 - 1.2 : zone.grid[0] === 2 ? -PLOT_W / 2 + 1.2 : PLOT_W / 2 - 1.2), cz + (zone.grid[1] === 0 ? PLOT_D / 2 - 1 : -PLOT_D / 2 + 1)]
}

export function Probe({ zone, selected }) {
  const head = useRef()
  const [x, z] = probePos(zone)
  const col = zone.status === 'offline' ? '#6b7280' : zone.status === 'critical' ? '#f87171' : zone.status === 'warning' ? '#fbbf24' : '#4ade80'
  useFrame(({ clock }) => {
    if (!head.current) return
    const t = clock.elapsedTime
    head.current.material.emissiveIntensity = zone.status === 'offline' ? 0.05 : 1.2 + Math.sin(t * 5 + x) * 0.8
  })
  return (
    <group position={[x, 0, z]}>
      <mesh castShadow position={[0, 1.1, 0]}><cylinderGeometry args={[0.07, 0.07, 2.2, 8]} /><meshStandardMaterial color="#d4d4d8" metalness={0.7} roughness={0.3} /></mesh>
      <mesh ref={head} position={[0, 2.35, 0]} scale={selected ? 1.4 : 1}>
        <boxGeometry args={[0.45, 0.35, 0.45]} />
        <meshStandardMaterial color="#111" emissive={col} emissiveIntensity={1.5} toneMapped={false} />
      </mesh>
      <mesh position={[0, 2.6, 0]} rotation-x={-0.5}><boxGeometry args={[0.6, 0.03, 0.4]} /><meshStandardMaterial color="#1e3a8a" metalness={0.5} roughness={0.3} /></mesh>
    </group>
  )
}

export function Hub() {
  const rotor = useRef(), ring = useRef()
  useFrame(({ clock }, dt) => {
    if (rotor.current) rotor.current.rotation.y += dt * 4
    if (ring.current) {
      const k = (clock.elapsedTime * 0.7) % 1
      ring.current.scale.setScalar(1 + k * 3)
      ring.current.material.opacity = (1 - k) * 0.7
    }
  })
  return (
    <group position={[0, 0, 0]}>
      <mesh castShadow position={[0, 3.2, 0]}><cylinderGeometry args={[0.1, 0.16, 6.4, 8]} /><meshStandardMaterial color="#e4e4e7" metalness={0.8} roughness={0.25} /></mesh>
      <mesh castShadow position={[0, 0.15, 0]}><cylinderGeometry args={[0.8, 0.9, 0.3, 12]} /><meshStandardMaterial color="#52525b" /></mesh>
      <group ref={rotor} position={[0, 6.5, 0]}>
        {[0, 1, 2].map((i) => (
          <group key={i} rotation-y={(i * Math.PI * 2) / 3}>
            <mesh position={[0.45, 0, 0]} rotation-z={Math.PI / 2}><cylinderGeometry args={[0.025, 0.025, 0.9, 6]} /><meshStandardMaterial color="#d4d4d8" /></mesh>
            <mesh position={[0.9, 0, 0]}><sphereGeometry args={[0.13, 10, 8, 0, Math.PI]} /><meshStandardMaterial color="#f4f4f5" side={THREE.DoubleSide} /></mesh>
          </group>
        ))}
      </group>
      <mesh position={[0.6, 4.6, 0]} rotation={[-0.6, 0, 0]} castShadow><boxGeometry args={[1.3, 0.05, 0.9]} /><meshStandardMaterial color="#1e3a8a" metalness={0.6} roughness={0.25} /></mesh>
      <mesh position={[0, 6.1, 0]}><sphereGeometry args={[0.22, 16, 16]} /><meshStandardMaterial color="#000" emissive="#4ade80" emissiveIntensity={3} toneMapped={false} /></mesh>
      <mesh ref={ring} position={[0, 6.1, 0]} rotation-x={-Math.PI / 2}>
        <ringGeometry args={[0.35, 0.45, 32]} />
        <meshBasicMaterial color="#4ade80" transparent side={THREE.DoubleSide} depthWrite={false} toneMapped={false} />
      </mesh>
    </group>
  )
}

// Glowing packets flying from each live probe to the hub = the ingestion layer.
const PER = 3
export function DataPackets({ zones }) {
  const live = zones.filter((z) => z.status !== 'offline')
  const ref = useRef()
  const curves = useMemo(() => live.map((z) => {
    const [x, zz] = probePos(z)
    const a = new THREE.Vector3(x, 2.4, zz)
    const mid = a.clone().lerp(HUB_TOP, 0.5); mid.y += 5
    return new THREE.QuadraticBezierCurve3(a, mid, HUB_TOP)
  }), [live.length])
  const colors = useMemo(() => live.map((z) => new THREE.Color(z.status === 'critical' ? '#f87171' : z.status === 'warning' ? '#fbbf24' : '#86efac')), [live.length])
  const dummy = useMemo(() => new THREE.Object3D(), [])
  useLayoutEffect(() => {
    let i = 0
    for (let c = 0; c < curves.length; c++) for (let k = 0; k < PER; k++) ref.current.setColorAt(i++, colors[c])
    if (ref.current.instanceColor) ref.current.instanceColor.needsUpdate = true
  }, [curves, colors])
  useFrame(({ clock }) => {
    const t = clock.elapsedTime
    let i = 0
    for (let c = 0; c < curves.length; c++) {
      for (let k = 0; k < PER; k++) {
        const u = ((t * 0.28 + k / PER + c * 0.17) % 1)
        curves[c].getPoint(u, dummy.position)
        dummy.scale.setScalar(0.6 + Math.sin(u * Math.PI) * 0.8)
        dummy.updateMatrix()
        ref.current.setMatrixAt(i++, dummy.matrix)
      }
    }
    ref.current.instanceMatrix.needsUpdate = true
  })
  return (
    <group>
      <instancedMesh ref={ref} args={[null, null, curves.length * PER]} frustumCulled={false}>
        <sphereGeometry args={[0.16, 10, 10]} />
        <meshBasicMaterial toneMapped={false} />
      </instancedMesh>
      {curves.map((c, i) => (
        <line key={i}>
          <bufferGeometry attach="geometry" onUpdate={(g) => g.setFromPoints(c.getPoints(40))} />
          <lineBasicMaterial attach="material" color={colors[i]} transparent opacity={0.18} />
        </line>
      ))}
    </group>
  )
}

// Satellite pass: a thin light sheet sweeping the fields (NDVI refresh).
export function SatelliteSweep() {
  const ref = useRef()
  useFrame(({ clock }) => {
    if (!ref.current) return
    const k = (clock.elapsedTime / 9) % 1
    ref.current.position.x = -34 + k * 68
    ref.current.material.opacity = Math.sin(k * Math.PI) * 0.13
  })
  return (
    <mesh ref={ref} position={[0, 3, 0]} rotation-y={Math.PI / 2}>
      <planeGeometry args={[34, 6]} />
      <meshBasicMaterial color="#86efac" transparent opacity={0} side={THREE.DoubleSide} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
    </mesh>
  )
}
