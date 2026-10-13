import { lazy, Suspense, useEffect } from 'react'
import { Routes, Route, useLocation } from 'react-router-dom'
import Landing from './pages/Landing'
import Loader from './components/Loader'
import { TwinProvider } from './state/TwinContext'

const Twin = lazy(() => import('./pages/Twin'))
const Desk = lazy(() => import('./pages/Desk'))
const Lab = lazy(() => import('./pages/Lab'))
const Credits = lazy(() => import('./pages/Credits'))

function ScrollManager() {
  const { pathname, hash } = useLocation()
  useEffect(() => {
    if (hash) {
      const el = document.querySelector(hash)
      if (el) { setTimeout(() => el.scrollIntoView({ behavior: 'smooth' }), 60); return }
    }
    window.scrollTo(0, 0)
  }, [pathname, hash])
  return null
}

export default function App() {
  return (
    <TwinProvider>
      <ScrollManager />
      <Suspense fallback={<Loader label="Loading the twin" />}>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/twin" element={<Twin />} />
          <Route path="/desk" element={<Desk />} />
          <Route path="/lab" element={<Lab />} />
          <Route path="/credits" element={<Credits />} />
          <Route path="*" element={<Landing />} />
        </Routes>
      </Suspense>
    </TwinProvider>
  )
}
