import { Suspense, useEffect, useRef } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { CameraControls, AdaptiveDpr } from '@react-three/drei'
import Plot from './Plot'
import { Terrain, Trees, Farmstead, Pond, Hub, Probe, DataPackets, SatelliteSweep } from './Environment'
import { wind } from './materials'
import { plotCenter, HOME_CAM } from './layout'
import './farm.css'

function Clock() {
  useFrame((_, dt) => { wind.value += dt })
  return null
}

function Rig({ selected, autoRotate, controlsRef, homeSignal, plots }) {
  const idle = useRef(0)
  const plotsRef = useRef(plots)
  plotsRef.current = plots
  useEffect(() => {
    const c = controlsRef.current
    if (!c) return
    if (selected) {
      const z = plotsRef.current.find((q) => q.zoneId === selected)
      if (!z) return
      const [x, zz] = plotCenter(z.grid)
      c.setLookAt(x + 16, 30, zz + (zz < 0 ? 26 : 34), x + 5, 0.5, zz + 1, true)
    } else {
      c.setLookAt(...HOME_CAM.pos, ...HOME_CAM.target, true)
    }
  }, [selected, homeSignal, controlsRef])
  useFrame((_, dt) => {
    const c = controlsRef.current
    if (!c || !autoRotate) return
    idle.current += dt
    if (idle.current > 0.5) c.azimuthAngle += dt * 0.07
  })
  return null
}

export default function FarmScene({
  plots = [], selected = null, hovered = null, layer = 'status', onHover, onSelect,
  interactive = true, autoRotate = false, showLabels = true, homeSignal = 0, onReady, className, paused = false, maxDpr = 2,
}) {
  const controls = useRef()
  return (
    <Canvas
      className={className}
      shadows
      dpr={[1, maxDpr]}
      frameloop={paused ? 'never' : 'always'}
      camera={{ position: HOME_CAM.pos, fov: 38, near: 0.5, far: 600 }}
      gl={{ antialias: true, powerPreference: 'high-performance' }}
      onCreated={() => onReady?.()}
      onPointerMissed={() => interactive && onSelect?.(null)}
    >
      <color attach="background" args={['#000000']} />
      <fog attach="fog" args={['#000000', 95, 190]} />
      <hemisphereLight args={['#cfe9ff', '#2a1d10', 0.75]} />
      <directionalLight
        position={[-38, 46, 24]} intensity={2.4} color="#ffe2b0" castShadow
        shadow-mapSize={[2048, 2048]} shadow-bias={-0.0004} shadow-normalBias={0.04}
        shadow-camera-left={-60} shadow-camera-right={60} shadow-camera-top={45} shadow-camera-bottom={-45} shadow-camera-far={160}
      />
      <directionalLight position={[40, 20, -30]} intensity={0.5} color="#9ecbff" />
      <Clock />
      <Suspense fallback={null}>
        <Terrain />
        <Trees />
        <Farmstead />
        <Pond />
        <Hub />
        <DataPackets zones={plots} />
        <SatelliteSweep />
        {plots.map((z) => (
          <group key={z.zoneId}>
            <Plot zone={z} layer={layer} interactive={interactive} showLabel={showLabels}
              hovered={hovered === z.zoneId} selected={selected === z.zoneId}
              dimmed={!!selected && selected !== z.zoneId}
              onHover={onHover} onSelect={onSelect} />
            <Probe zone={z} selected={selected === z.zoneId} />
          </group>
        ))}
      </Suspense>
      <CameraControls
        ref={controls} makeDefault
        minDistance={10} maxDistance={120} maxPolarAngle={Math.PI / 2.25} minPolarAngle={0.15}
        smoothTime={0.6} draggingSmoothTime={0.15}
        enabled={interactive}
      />
      <Rig selected={selected} autoRotate={autoRotate} controlsRef={controls} homeSignal={homeSignal} plots={plots} />
      <AdaptiveDpr pixelated={false} />
    </Canvas>
  )
}
