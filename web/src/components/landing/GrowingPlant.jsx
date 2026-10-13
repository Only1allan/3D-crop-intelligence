import { motion } from 'framer-motion'
// A seedling that draws itself: stem grows, leaves unfurl, then gently sways.
export default function GrowingPlant({ className, delay = 0.4 }) {
  const leaf = (d, i) => (
    <motion.path key={i} d={d} fill="url(#gp-leaf)" stroke="#86efac" strokeWidth="1"
      initial={{ scale: 0, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
      style={{ transformBox: 'fill-box', transformOrigin: i % 2 ? '0% 100%' : '100% 100%' }}
      transition={{ delay: delay + 0.9 + i * 0.25, duration: 0.9, ease: [0.34, 1.56, 0.64, 1] }} />
  )
  return (
    <motion.svg className={className} viewBox="0 0 200 320" aria-hidden="true"
      animate={{ rotate: [0, 1.6, -1.2, 0] }} transition={{ duration: 7, repeat: Infinity, ease: 'easeInOut', delay: delay + 2.5 }}
      style={{ transformOrigin: '50% 100%' }}>
      <defs>
        <linearGradient id="gp-leaf" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#bef264" /><stop offset="1" stopColor="#15803d" /></linearGradient>
        <radialGradient id="gp-soil" cx=".5" cy=".5" r=".5"><stop offset="0" stopColor="#4ade80" stopOpacity=".35" /><stop offset="1" stopColor="#4ade80" stopOpacity="0" /></radialGradient>
      </defs>
      <ellipse cx="100" cy="308" rx="90" ry="12" fill="url(#gp-soil)" />
      <motion.path d="M100 310 C 98 250, 108 200, 96 140 S 104 60, 100 30" fill="none" stroke="#4ade80" strokeWidth="4" strokeLinecap="round"
        initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ delay, duration: 1.8, ease: 'easeInOut' }} />
      {[
        'M98 250 C 70 240, 50 250, 36 232 C 60 222, 84 228, 98 250 Z',
        'M101 212 C 128 200, 150 208, 166 190 C 140 180, 116 188, 101 212 Z',
        'M97 160 C 72 150, 56 158, 44 140 C 66 130, 88 138, 97 160 Z',
        'M100 110 C 124 100, 142 106, 156 90 C 132 80, 112 88, 100 110 Z',
        'M100 60 C 84 50, 76 40, 78 24 C 94 32, 102 44, 100 60 Z',
      ].map(leaf)}
    </motion.svg>
  )
}
