import { useEffect, useState } from 'react'
import { Link, NavLink } from 'react-router-dom'
import { ArrowRight, Menu, X } from 'lucide-react'
import Logo from './Logo'
import './nav.css'

const LINKS = [
  { to: '/#problem', label: 'Problem' },
  { to: '/#solution', label: 'Solution' },
  { to: '/#features', label: 'Features' },
  { to: '/desk', label: 'Desk' },
  { to: '/lab', label: 'Real 3D data' },
  { to: '/#honesty', label: 'What is real' },
]

export default function Nav() {
  const [scrolled, setScrolled] = useState(false)
  const [open, setOpen] = useState(false)
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 24)
    on(); window.addEventListener('scroll', on, { passive: true })
    return () => window.removeEventListener('scroll', on)
  }, [])
  return (
    <header className={`nav ${scrolled ? 'scrolled' : ''} ${open ? 'open' : ''}`}>
      <div className="container nav-inner">
        <Link to="/" aria-label="Home" onClick={() => setOpen(false)}><Logo /></Link>
        <nav className="nav-links" aria-label="Main">
          {LINKS.map((l) => <NavLink key={l.to} to={l.to} onClick={() => setOpen(false)}>{l.label}</NavLink>)}
        </nav>
        <div className="nav-cta">
          <Link to="/twin" className="btn btn-primary btn-sm">Open the twin <ArrowRight size={16} className="arrow" /></Link>
          <button className="nav-burger" aria-label="Menu" onClick={() => setOpen((o) => !o)}>{open ? <X /> : <Menu />}</button>
        </div>
      </div>
    </header>
  )
}
