import { useEffect, useRef, useState } from 'react'

const VIDEO_URL = '/media/hero-mountains.mp4?v=60fps-1'
const POSTER_URL = '/media/hero-mountains-poster.webp'

export default function HeroVideoBackground() {
  const videoRef = useRef(null)
  const [hasError, setHasError] = useState(false)
  const [reduceMotion, setReduceMotion] = useState(
    () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false,
  )

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
    const handlePreference = (event) => setReduceMotion(event.matches)
    mediaQuery.addEventListener('change', handlePreference)
    return () => mediaQuery.removeEventListener('change', handlePreference)
  }, [])

  useEffect(() => {
    const video = videoRef.current
    if (!video || hasError) return
    if (reduceMotion) {
      video.pause()
      return
    }
    video.play().catch(() => {})
  }, [hasError, reduceMotion])

  const showVideo = !hasError && !reduceMotion

  return (
    <div className="hero-video-background absolute inset-0 overflow-hidden" aria-hidden="true">
      <img
        src={POSTER_URL}
        alt=""
        className="hero-video-poster absolute inset-0 h-full w-full object-cover transition-opacity duration-700"
        style={{ opacity: showVideo ? 0 : 1 }}
      />
      <video
        ref={videoRef}
        className="absolute inset-0 h-full w-full object-cover transition-opacity duration-700"
        style={{ opacity: showVideo ? 1 : 0 }}
        autoPlay={!reduceMotion}
        muted
        loop
        playsInline
        preload="metadata"
        poster={POSTER_URL}
        onError={() => setHasError(true)}
      >
        <source src={VIDEO_URL} type="video/mp4" />
      </video>
      <div className="hero-video-shade absolute inset-0" />
    </div>
  )
}
