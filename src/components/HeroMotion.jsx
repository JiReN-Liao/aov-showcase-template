import { useEffect, useRef } from 'react'

export default function HeroMotion({ src, alt }) {
  const rootRef = useRef(null)
  const imageRef = useRef(null)
  const canvasRef = useRef(null)

  useEffect(() => {
    const root = rootRef.current
    const image = imageRef.current
    const canvas = canvasRef.current
    if (!root || !image || !canvas) return undefined

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches
    if (reduceMotion) {
      image.style.transform = 'scale(1.035)'
      return undefined
    }

    const context = canvas.getContext('2d')
    if (!context) return undefined
    let frame = 0
    let particles = []
    let targetX = 0
    let targetY = 0
    let currentX = 0
    let currentY = 0
    let scrollOffset = 0

    const resize = () => {
      const bounds = root.getBoundingClientRect()
      const ratio = Math.min(window.devicePixelRatio || 1, 1.5)
      canvas.width = Math.max(1, Math.floor(bounds.width * ratio))
      canvas.height = Math.max(1, Math.floor(bounds.height * ratio))
      canvas.style.width = `${bounds.width}px`
      canvas.style.height = `${bounds.height}px`
      context.setTransform(ratio, 0, 0, ratio, 0, 0)
      const count = bounds.width < 640 ? 20 : 44
      particles = Array.from({ length: count }, (_, index) => ({
        x: Math.random() * bounds.width,
        y: Math.random() * bounds.height,
        radius: 0.45 + Math.random() * 1.35,
        speed: 0.08 + Math.random() * 0.18,
        phase: index * 0.73 + Math.random() * Math.PI,
        alpha: 0.18 + Math.random() * 0.38,
      }))
    }

    const onPointerMove = (event) => {
      if (!finePointer) return
      targetX = (event.clientX / window.innerWidth - 0.5) * 2
      targetY = (event.clientY / window.innerHeight - 0.5) * 2
    }

    const onScroll = () => {
      scrollOffset = Math.min(window.scrollY / Math.max(root.offsetHeight, 1), 1)
    }

    const draw = (time) => {
      const width = canvas.clientWidth
      const height = canvas.clientHeight
      currentX += (targetX - currentX) * 0.035
      currentY += (targetY - currentY) * 0.035
      image.style.transform = `translate3d(${currentX * -12}px, ${currentY * -8 - scrollOffset * 18}px, 0) scale(1.085)`

      context.clearRect(0, 0, width, height)
      for (const particle of particles) {
        particle.y -= particle.speed
        particle.x += Math.sin(time * 0.00035 + particle.phase) * 0.045
        if (particle.y < -4) {
          particle.y = height + 4
          particle.x = Math.random() * width
        }
        const pulse = 0.65 + Math.sin(time * 0.0012 + particle.phase) * 0.35
        context.beginPath()
        context.fillStyle = `rgba(255,255,255,${Math.max(0.05, particle.alpha * pulse)})`
        context.arc(particle.x, particle.y, particle.radius, 0, Math.PI * 2)
        context.fill()
      }
      frame = window.requestAnimationFrame(draw)
    }

    resize()
    onScroll()
    frame = window.requestAnimationFrame(draw)
    window.addEventListener('resize', resize)
    window.addEventListener('pointermove', onPointerMove, { passive: true })
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      window.cancelAnimationFrame(frame)
      window.removeEventListener('resize', resize)
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('scroll', onScroll)
    }
  }, [])

  return (
    <div ref={rootRef} className="hero-motion absolute inset-0 overflow-hidden">
      <img ref={imageRef} src={src} alt={alt} className="hero-motion-image absolute inset-0 h-full w-full object-cover object-[58%_center] opacity-90 sm:object-center" />
      <canvas ref={canvasRef} className="hero-particles absolute inset-0" aria-hidden="true" />
    </div>
  )
}
