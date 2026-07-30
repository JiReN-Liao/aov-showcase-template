import { useRef } from 'react'

export default function SpotlightCard({ as: Element = 'div', children, className = '', style, ...props }) {
  const cardRef = useRef(null)

  const moveSpotlight = (event) => {
    const card = cardRef.current
    if (!card || event.pointerType === 'touch') return
    const bounds = card.getBoundingClientRect()
    const x = event.clientX - bounds.left
    const y = event.clientY - bounds.top
    card.style.setProperty('--spotlight-x', `${x}px`)
    card.style.setProperty('--spotlight-y', `${y}px`)
    card.style.setProperty('--card-tilt-x', `${((0.5 - y / bounds.height) * 2.2).toFixed(2)}deg`)
    card.style.setProperty('--card-tilt-y', `${((x / bounds.width - 0.5) * 2.2).toFixed(2)}deg`)
  }

  const resetSpotlight = () => {
    const card = cardRef.current
    if (!card) return
    card.style.setProperty('--card-tilt-x', '0deg')
    card.style.setProperty('--card-tilt-y', '0deg')
  }

  return (
    <Element
      ref={cardRef}
      className={`spotlight-card ${className}`}
      style={style}
      onPointerMove={moveSpotlight}
      onPointerLeave={resetSpotlight}
      {...props}
    >
      {children}
    </Element>
  )
}
