import { useEffect, useMemo, useRef, useState } from 'react'

const MODES = new Set(['liquid', 'aurora', 'beams', 'particles'])

function seededParticles(count) {
  let seed = 1937
  return Array.from({ length: count }, () => {
    seed = (seed * 16807) % 2147483647
    const x = seed / 2147483647
    seed = (seed * 16807) % 2147483647
    const y = seed / 2147483647
    seed = (seed * 16807) % 2147483647
    const size = seed / 2147483647
    return { x, y, size }
  })
}

function drawLiquid(context, time, width, height, pointer) {
  context.globalCompositeOperation = 'screen'
  const ribbons = [
    { x: 0.08, width: 0.18, phase: 0.2, alpha: 0.16 },
    { x: 0.29, width: 0.23, phase: 1.8, alpha: 0.1 },
    { x: 0.53, width: 0.19, phase: 3.4, alpha: 0.14 },
    { x: 0.76, width: 0.24, phase: 5.1, alpha: 0.1 },
    { x: 0.94, width: 0.16, phase: 6.7, alpha: 0.15 },
  ]

  ribbons.forEach((ribbon) => {
    context.beginPath()
    for (let index = 0; index <= 28; index += 1) {
      const progress = index / 28
      const y = -height * 0.16 + progress * height * 1.32
      const wave = Math.sin(progress * 6.2 + time * 0.28 + ribbon.phase) * width * 0.09
      const detail = Math.sin(progress * 13.4 - time * 0.13 + ribbon.phase) * width * 0.025
      const x = ribbon.x * width + wave + detail + pointer.x * width * 0.045
      if (index === 0) context.moveTo(x, y)
      else context.lineTo(x, y)
    }
    const gradient = context.createLinearGradient(0, 0, width, height)
    gradient.addColorStop(0, 'rgba(255,255,255,0)')
    gradient.addColorStop(0.45, `rgba(210,214,222,${ribbon.alpha})`)
    gradient.addColorStop(1, 'rgba(90,94,104,0)')
    context.strokeStyle = gradient
    context.lineWidth = Math.max(42, width * ribbon.width)
    context.lineCap = 'round'
    context.lineJoin = 'round'
    context.stroke()
  })
}

function drawAurora(context, time, width, height, pointer) {
  context.globalCompositeOperation = 'screen'
  const layers = [
    { x: 0.18, y: 0.32, radius: 0.68, alpha: 0.28, phase: 0 },
    { x: 0.56, y: 0.5, radius: 0.72, alpha: 0.22, phase: 2.2 },
    { x: 0.86, y: 0.24, radius: 0.6, alpha: 0.19, phase: 4.4 },
  ]
  layers.forEach((layer) => {
    const x = (layer.x + Math.sin(time * 0.13 + layer.phase) * 0.12 + pointer.x * 0.04) * width
    const y = (layer.y + Math.cos(time * 0.1 + layer.phase) * 0.1 + pointer.y * 0.03) * height
    const radius = Math.max(width, height) * layer.radius
    const gradient = context.createRadialGradient(x, y, 0, x, y, radius)
    gradient.addColorStop(0, `rgba(230,233,240,${layer.alpha})`)
    gradient.addColorStop(0.3, `rgba(126,132,145,${layer.alpha * 0.7})`)
    gradient.addColorStop(0.7, `rgba(52,56,66,${layer.alpha * 0.25})`)
    gradient.addColorStop(1, 'rgba(0,0,0,0)')
    context.save()
    context.translate(x, y)
    context.scale(1.5, 0.58)
    context.translate(-x, -y)
    context.fillStyle = gradient
    context.fillRect(x - radius, y - radius, radius * 2, radius * 2)
    context.restore()
  })
}

function drawBeams(context, time, width, height, pointer) {
  context.globalCompositeOperation = 'screen'
  const centerX = width * (0.5 + pointer.x * 0.05)
  const centerY = height * (0.94 + pointer.y * 0.02)
  for (let index = 0; index < 11; index += 1) {
    const offset = index - 5
    const sway = Math.sin(time * 0.22 + index * 0.72) * 0.055
    const topX = centerX + (offset * 0.12 + sway) * width
    const halfWidth = width * (0.018 + (index % 3) * 0.008)
    const gradient = context.createLinearGradient(topX, 0, centerX, centerY)
    gradient.addColorStop(0, 'rgba(255,255,255,0)')
    gradient.addColorStop(0.35, `rgba(210,214,224,${0.05 + (index % 4) * 0.015})`)
    gradient.addColorStop(1, 'rgba(255,255,255,0.2)')
    context.fillStyle = gradient
    context.beginPath()
    context.moveTo(topX - halfWidth, -height * 0.1)
    context.lineTo(topX + halfWidth, -height * 0.1)
    context.lineTo(centerX + halfWidth * 0.2, centerY)
    context.lineTo(centerX - halfWidth * 0.2, centerY)
    context.closePath()
    context.fill()
  }
  const bloom = context.createRadialGradient(centerX, centerY, 0, centerX, centerY, width * 0.42)
  bloom.addColorStop(0, 'rgba(220,224,232,0.2)')
  bloom.addColorStop(0.4, 'rgba(88,92,102,0.08)')
  bloom.addColorStop(1, 'rgba(0,0,0,0)')
  context.fillStyle = bloom
  context.fillRect(0, 0, width, height)
}

function drawParticles(context, time, width, height, pointer, particles) {
  context.globalCompositeOperation = 'screen'
  const drift = (time * 0.008) % 1
  particles.forEach((particle, index) => {
    const x = ((particle.x + drift * (0.12 + particle.size * 0.16)) % 1) * width + pointer.x * 8
    const y = particle.y * height + Math.sin(time * 0.3 + index) * 2 + pointer.y * 6
    const pulse = 0.45 + Math.sin(time * 0.8 + index * 1.7) * 0.25
    context.fillStyle = `rgba(232,235,242,${pulse})`
    context.beginPath()
    context.arc(x, y, 0.45 + particle.size * 1.6, 0, Math.PI * 2)
    context.fill()
  })

  const horizonY = height * 0.62
  const glow = context.createRadialGradient(width * 0.52, horizonY, 0, width * 0.52, horizonY, width * 0.48)
  glow.addColorStop(0, 'rgba(210,214,224,0.22)')
  glow.addColorStop(0.2, 'rgba(98,104,116,0.12)')
  glow.addColorStop(1, 'rgba(0,0,0,0)')
  context.fillStyle = glow
  context.fillRect(0, height * 0.18, width, height * 0.82)

  context.strokeStyle = 'rgba(200,204,214,0.1)'
  context.lineWidth = 1
  for (let row = 0; row < 6; row += 1) {
    const y = horizonY + row * row * height * 0.012
    context.beginPath()
    context.moveTo(0, y)
    context.lineTo(width, y)
    context.stroke()
  }
  for (let column = -6; column <= 6; column += 1) {
    context.beginPath()
    context.moveTo(width * 0.5, horizonY)
    context.lineTo(width * 0.5 + column * width * 0.16, height)
    context.stroke()
  }
}

export default function DynamicVeil({ mode = 'liquid', className = '' }) {
  const canvasRef = useRef(null)
  const [failed, setFailed] = useState(false)
  const particles = useMemo(() => seededParticles(92), [])
  const activeMode = MODES.has(mode) ? mode : 'liquid'

  useEffect(() => {
    const canvas = canvasRef.current
    const parent = canvas?.parentElement
    const context = canvas?.getContext('2d', { alpha: false })
    if (!canvas || !parent || !context) {
      setFailed(true)
      return undefined
    }

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches
    const pointerTarget = { x: 0, y: 0 }
    const pointer = { x: 0, y: 0 }
    const startedAt = performance.now()
    let frame = 0
    let lastRenderedAt = 0

    const resize = () => {
      const bounds = parent.getBoundingClientRect()
      const scale = bounds.width < 640 ? 0.42 : 0.54
      canvas.width = Math.max(1, Math.round(bounds.width * scale))
      canvas.height = Math.max(1, Math.round(bounds.height * scale))
      canvas.style.width = `${bounds.width}px`
      canvas.style.height = `${bounds.height}px`
    }

    const draw = (time) => {
      const { width, height } = canvas
      context.globalCompositeOperation = 'source-over'
      context.fillStyle = '#020203'
      context.fillRect(0, 0, width, height)
      pointer.x += (pointerTarget.x - pointer.x) * 0.025
      pointer.y += (pointerTarget.y - pointer.y) * 0.025
      if (activeMode === 'aurora') drawAurora(context, time, width, height, pointer)
      else if (activeMode === 'beams') drawBeams(context, time, width, height, pointer)
      else if (activeMode === 'particles') drawParticles(context, time, width, height, pointer, particles)
      else drawLiquid(context, time, width, height, pointer)
      context.globalCompositeOperation = 'source-over'
    }

    const render = (timestamp) => {
      frame = window.requestAnimationFrame(render)
      if (document.hidden || timestamp - lastRenderedAt < 1000 / 24) return
      lastRenderedAt = timestamp
      draw(reduceMotion ? 8 : (timestamp - startedAt) / 1000)
      if (reduceMotion) window.cancelAnimationFrame(frame)
    }

    const onPointerMove = (event) => {
      if (!finePointer) return
      pointerTarget.x = event.clientX / window.innerWidth - 0.5
      pointerTarget.y = event.clientY / window.innerHeight - 0.5
    }

    const resizeObserver = new ResizeObserver(resize)
    resizeObserver.observe(parent)
    window.addEventListener('pointermove', onPointerMove, { passive: true })
    resize()
    frame = window.requestAnimationFrame(render)
    return () => {
      window.cancelAnimationFrame(frame)
      window.removeEventListener('pointermove', onPointerMove)
      resizeObserver.disconnect()
    }
  }, [activeMode, particles])

  return (
    <div className={`dynamic-veil dynamic-veil-${activeMode} absolute inset-0 overflow-hidden ${failed ? 'dynamic-veil-fallback' : ''} ${className}`} aria-hidden="true">
      {!failed && <canvas ref={canvasRef} className="h-full w-full" />}
      <div className="dynamic-veil-vignette absolute inset-0" />
    </div>
  )
}
