import { useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X } from 'lucide-react'

export default function VideoModal({ open, onClose }) {
  useEffect(() => {
    if (!open) return
    const on = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', on); document.body.style.overflow = 'hidden'
    return () => { window.removeEventListener('keydown', on); document.body.style.overflow = '' }
  }, [open, onClose])
  return (
    <AnimatePresence>
      {open && (
        <motion.div className="vmodal" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
          <motion.div className="vmodal-box" initial={{ scale: 0.94, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.96 }} onClick={(e) => e.stopPropagation()}>
            <button className="icon-btn vmodal-x" onClick={onClose} aria-label="Close"><X size={18} /></button>
            <video src="/twin-assets/viewer-garden/orbit.mp4" autoPlay controls loop muted playsInline />
            <p>Real 3D Gaussian Splatting render, trained on a free GPU from a public reference capture (Mip-NeRF 360 “garden”, PSNR 27.3). It proves the scan pipeline; it is not our farm yet.</p>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
