import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { Canvas, useFrame } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'

// Real Pheno4D maize: 12 daily laser scans of the SAME plant, stored as one
// Float32 block per day (x,y,z,r,g,b per point). We lerp between days.
const BASE = '/twin-assets/viewer/'

function Plant({ data, t }) {
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(data.count * 3), 3))
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(data.count * 3), 3))
    return g
  }, [data])
  const last = useRef(-1)
  useFrame(() => {
    if (Math.abs(last.current - t.current) < 1e-4) return
    last.current = t.current
    const { buf, count, days } = data
    const i = Math.min(days - 2, Math.max(0, Math.floor(t.current)))
    const f = Math.min(1, Math.max(0, t.current - i))
    const A = i * count * 6, B = (i + 1) * count * 6
    const pos = geo.attributes.position.array, col = geo.attributes.color.array
    for (let k = 0; k < count; k++) {
      const a = A + k * 6, b = B + k * 6, o = k * 3
      pos[o] = buf[a] + (buf[b] - buf[a]) * f
      pos[o + 1] = buf[a + 1] + (buf[b + 1] - buf[a + 1]) * f
      pos[o + 2] = buf[a + 2] + (buf[b + 2] - buf[a + 2]) * f
      col[o] = buf[a + 3] + (buf[b + 3] - buf[a + 3]) * f
      col[o + 1] = buf[a + 4] + (buf[b + 4] - buf[a + 4]) * f
      col[o + 2] = buf[a + 5] + (buf[b + 5] - buf[a + 5]) * f
    }
    geo.attributes.position.needsUpdate = true
    geo.attributes.color.needsUpdate = true
  })
  return (
    <group rotation-x={-Math.PI / 2}>
      <points geometry={geo} frustumCulled={false}>
        <pointsMaterial size={0.009} vertexColors sizeAttenuation />
      </points>
    </group>
  )
}

function Ground() {
  return (
    <group>
      <gridHelper args={[6, 24, '#1f3a26', '#0f1f14']} />
      <mesh rotation-x={-Math.PI / 2} position={[0, -0.001, 0]}>
        <circleGeometry args={[1.2, 48]} />
        <meshBasicMaterial color="#4ade80" transparent opacity={0.06} />
      </mesh>
    </group>
  )
}

export default function PhenoViewer() {
  const [data, setData] = useState(null)
  const [err, setErr] = useState(null)
  const [pct, setPct] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [ui, setUi] = useState(0)
  const t = useRef(0)

  useEffect(() => {
    let dead = false
    ;(async () => {
      try {
        const man = await (await fetch(BASE + 'pheno_manifest.json')).json()
        const res = await fetch(BASE + 'pheno.bin')
        const total = +res.headers.get('content-length') || 16198848
        const reader = res.body.getReader()
        const out = new Uint8Array(total); let got = 0
        for (;;) { const { done, value } = await reader.read(); if (done) break; out.set(value, got); got += value.length; if (!dead) setPct(Math.round((got / total) * 100)) }
        if (dead) return
        setData({ ...man, buf: new Float32Array(out.buffer, 0, Math.floor(got / 4)) })
        setTimeout(() => setPlaying(true), 700)
      } catch (e) { if (!dead) setErr(e.message) }
    })()
    return () => { dead = true }
  }, [])

  useEffect(() => {
    if (!playing || !data) return
    let raf, last = performance.now()
    const step = (now) => {
      const dt = (now - last) / 1000; last = now
      t.current += dt * 0.9
      if (t.current >= data.days - 1) t.current = 0
      setUi(t.current)
      raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [playing, data])

  const info = data && (() => {
    const i = Math.min(data.days - 2, Math.floor(ui)), f = ui - i
    const d0 = data.dayInfo[i], d1 = data.dayInfo[i + 1]
    return { h: d0.height + (d1.height - d0.height) * f, day: Math.round(ui) + 1 }
  })()

  return (
    <div className="pheno">
      {data ? (
        <Canvas camera={{ position: [2.4, 2.2, 3.4], fov: 45, near: 0.01, far: 100 }} dpr={[1, 2]}>
          <color attach="background" args={['#000']} />
          <Plant data={data} t={t} />
          <Ground />
          <OrbitControls target={[0, 1.3, 0]} enableDamping autoRotate autoRotateSpeed={0.6} />
        </Canvas>
      ) : (
        <div className="pheno-load">
          {err ? <span>Could not load the scan data: {err}</span> : <><div className="spinner" /><b>Loading 12 real laser scans</b><span>{pct}% of 16 MB · 56,246 points per day</span></>}
        </div>
      )}
      {data && (
        <div className="pheno-ctrl glass">
          <button className="btn btn-primary btn-sm" onClick={() => setPlaying((p) => !p)}>{playing ? 'Pause' : 'Play growth'}</button>
          <input type="range" min="0" max={data.days - 1} step="0.01" value={ui}
            onChange={(e) => { setPlaying(false); t.current = +e.target.value; setUi(t.current) }} aria-label="Scan day" />
          <div className="pheno-read"><b>{info.h.toFixed(2)} m</b><span>scan {info.day} of {data.days}</span></div>
        </div>
      )}
    </div>
  )
}
