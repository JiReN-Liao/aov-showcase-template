import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'

const VISIBLE_OFFSETS = [-3, -2, -1, 0, 1, 2, 3]
const AUTOPLAY_DELAY = 2400

function wrapIndex(index, length) {
  return ((index % length) + length) % length
}

export default function AccountCarousel({ products, ImageComponent, formatPrice, onOpen }) {
  const orderedProducts = useMemo(
    () => products.slice().sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0)),
    [products],
  )
  const [activeIndex, setActiveIndex] = useState(0)
  const [paused, setPaused] = useState(false)
  const swipeStart = useRef(null)

  useEffect(() => {
    setActiveIndex((current) => orderedProducts.length ? wrapIndex(current, orderedProducts.length) : 0)
  }, [orderedProducts.length])

  useEffect(() => {
    if (paused || orderedProducts.length < 2 || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return undefined
    const timer = window.setInterval(() => {
      setActiveIndex((current) => wrapIndex(current + 1, orderedProducts.length))
    }, AUTOPLAY_DELAY)
    return () => window.clearInterval(timer)
  }, [orderedProducts.length, paused])

  if (!orderedProducts.length) return null

  const move = (step) => setActiveIndex((current) => wrapIndex(current + step, orderedProducts.length))
  const visibleCards = VISIBLE_OFFSETS.map((offset) => ({
    offset,
    product: orderedProducts[wrapIndex(activeIndex + offset, orderedProducts.length)],
  }))

  const finishSwipe = (event) => {
    if (swipeStart.current === null) return
    const distance = event.clientX - swipeStart.current
    swipeStart.current = null
    if (Math.abs(distance) > 42) move(distance > 0 ? -1 : 1)
  }

  return (
    <section className="account-carousel overflow-hidden border-y border-zinc-800 bg-[#080808] py-10 sm:py-14" aria-labelledby="account-carousel-title">
      <div className="mx-auto flex max-w-[1400px] items-end justify-between gap-5 px-5 sm:px-8">
        <div>
          <p className="text-xs font-black tracking-[0.2em] text-zinc-500">FEATURED STOCK</p>
          <h2 id="account-carousel-title" className="mt-2 text-3xl font-black text-white sm:text-5xl">推薦現貨</h2>
        </div>
        <p className="shrink-0 text-sm font-bold tabular-nums text-zinc-500"><span className="text-white">{activeIndex + 1}</span> / {orderedProducts.length}</p>
      </div>

      <div
        className="account-carousel-stage relative mx-auto mt-7 h-[290px] max-w-[1600px] touch-pan-y select-none sm:mt-10 sm:h-[430px]"
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
        onFocusCapture={() => setPaused(true)}
        onBlurCapture={() => setPaused(false)}
        onPointerDown={(event) => { swipeStart.current = event.clientX }}
        onPointerUp={finishSwipe}
        onPointerCancel={() => { swipeStart.current = null }}
      >
        <div className="account-carousel-glow absolute left-1/2 top-1/2 h-40 w-[55%] -translate-x-1/2 -translate-y-1/2 bg-white/10 blur-[90px]" aria-hidden="true" />
        {visibleCards.map(({ product, offset }) => (
          <a
            key={product.id}
            href={`#/product/${product.id}`}
            onClick={() => onOpen?.(product.id)}
            className="account-carousel-card absolute left-1/2 top-1/2 block w-[56vw] max-w-[220px] overflow-hidden rounded border border-zinc-700 bg-black shadow-[0_24px_60px_rgba(0,0,0,0.55)] focus-visible:z-20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white sm:w-[24vw] sm:max-w-[290px]"
            data-offset={offset}
            aria-label={`查看 ${product.code}`}
            tabIndex={offset === 0 ? 0 : -1}
          >
            <div className="aspect-[4/5] bg-black p-1.5 sm:p-2">
              <ImageComponent imageKey={product.imageKey} imageUrl={product.imageUrl} alt={product.code} className="h-full w-full object-contain" />
            </div>
            <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 bg-gradient-to-t from-black via-black/85 to-transparent px-3 pb-3 pt-10 sm:px-4 sm:pb-4">
              <span className="text-xs font-black text-white sm:text-sm">{product.code}</span>
              {formatPrice(product.price) && <span className="text-xs font-black tabular-nums text-zinc-200 sm:text-sm">{formatPrice(product.price)}</span>}
            </div>
          </a>
        ))}
      </div>

      <div className="mx-auto mt-1 flex max-w-[1400px] items-center justify-center gap-3 px-5 sm:mt-2 sm:px-8">
        <button type="button" onClick={() => move(-1)} aria-label="上一個帳號" className="account-carousel-control grid h-11 w-11 place-items-center rounded-full border border-zinc-700 text-white hover:border-zinc-300 hover:bg-white hover:text-black"><ChevronLeft size={20} /></button>
        <button type="button" onClick={() => move(1)} aria-label="下一個帳號" className="account-carousel-control grid h-11 w-11 place-items-center rounded-full border border-zinc-700 text-white hover:border-zinc-300 hover:bg-white hover:text-black"><ChevronRight size={20} /></button>
      </div>
    </section>
  )
}
