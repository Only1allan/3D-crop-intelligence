import { useState } from 'react'
import Nav from '../components/Nav'
import Footer from '../components/Footer'
import Hero from '../components/landing/Hero'
import Marquee from '../components/landing/Marquee'
import Problem from '../components/landing/Problem'
import Solution from '../components/landing/Solution'
import Features from '../components/landing/Features'
import Metrics from '../components/landing/Metrics'
import RealData from '../components/landing/RealData'
import { Compare, Honesty, Roadmap, FinalCTA } from '../components/landing/Closing'
import VideoModal from '../components/landing/VideoModal'
import '../components/landing/landing.css'

export default function Landing() {
  const [video, setVideo] = useState(false)
  return (
    <>
      <Nav />
      <main>
        <Hero onPlay={() => setVideo(true)} />
        <Marquee />
        <Problem />
        <Solution />
        <Features />
        <Metrics />
        <RealData />
        <Compare />
        <Honesty />
        <Roadmap />
        <FinalCTA />
      </main>
      <Footer />
      <VideoModal open={video} onClose={() => setVideo(false)} />
    </>
  )
}
