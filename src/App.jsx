import { useEffect, useMemo, useRef, useState } from 'react'
import { siFacebook, siInstagram, siLine } from 'simple-icons'
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpDown,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  ImagePlus,
  LoaderCircle,
  LogOut,
  Plus,
  RotateCcw,
  Search,
  Settings2,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import {
  cancelUploadBatch,
  clearAllProducts,
  createUploadBatch,
  defaultSettings,
  deleteImage,
  deleteProductsBatch,
  loadCloudCatalog,
  loadProducts,
  loadSettings,
  hashImageFile,
  linkSyncItem,
  listAdminCatalog,
  listSuppliers,
  listVisualHashes,
  loginAdmin,
  matchProductsByImages,
  matchProductsByImageHashes,
  putImage,
  recognizeImagePrice,
  recognizeUnpublishedPrices,
  registerUploadItems,
  saveAdminSettings,
  saveVisualHashes,
  softDeleteProduct,
  setupAdmin,
  updateProduct as updateProductApi,
  updateProductStatus,
} from './storage'
import { createVisualHash } from './image-similarity'
import BlurText from './components/BlurText'
import AccountCarousel from './components/AccountCarousel'
import DynamicVeil from './components/DynamicVeil'
import HeroVideoBackground from './components/HeroVideoBackground'
import SpotlightCard from './components/SpotlightCard'

const STATUSES = {
  draft: { label: '草稿', chip: 'border-zinc-700 bg-zinc-900 text-zinc-300' },
  available: { label: '出售中', chip: 'border-zinc-300 bg-zinc-100 text-zinc-950' },
  hidden: { label: '隱藏', chip: 'border-zinc-800 bg-zinc-950 text-zinc-500' },
}

const PUBLIC_STATUSES = ['available']
const currency = new Intl.NumberFormat('zh-TW')
const ADMIN_SESSION_KEY = 'aov-marketplace:admin-session:v1'
const HOME_STATE_KEY = 'aov-marketplace:home-state:v1'
const UPLOAD_CONCURRENCY = 4
const UPLOAD_ITEM_CHUNK_SIZE = 20
const CATALOG_PAGE_SIZE = 20
const WORKING_HOURS = '上午 10:00 - 下午 10:00'

export default function App() {
  const [products, setProductsState] = useState(() => loadProducts())
  const [settings, setSettingsState] = useState(() => loadSettings())
  const [route, setRoute] = useState(() => parseRoute(window.location.hash))
  const [adminToken, setAdminToken] = useState(() => sessionStorage.getItem(ADMIN_SESSION_KEY) || '')
  const [syncError, setSyncError] = useState('')
  const isAdmin = Boolean(adminToken)

  useEffect(() => {
    const onHashChange = () => setRoute(parseRoute(window.location.hash))
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  useEffect(() => {
    loadCloudCatalog()
      .then((catalog) => {
        if (Array.isArray(catalog.products)) setProductsState(catalog.products)
        if (catalog.settings) setSettingsState((current) => ({ ...current, ...catalog.settings }))
      })
      .catch((caught) => setSyncError(caught.message || '無法載入雲端商品，請稍後重新整理。'))
  }, [])

  useEffect(() => {
    if (!adminToken) return
    listAdminCatalog(adminToken)
      .then((catalog) => {
        if (Array.isArray(catalog.products)) setProductsState(catalog.products)
        setSettingsState((current) => ({
          ...current,
          ...(catalog.settings || {}),
          adminUsers: Array.isArray(catalog.adminUsers) ? catalog.adminUsers : current.adminUsers,
          hasAdminAccount: true,
        }))
      })
      .catch((caught) => setSyncError(caught.message || '管理資料載入失敗，請重新登入。'))
  }, [adminToken])

  const setProducts = (next) => {
    setProductsState((current) => {
      const resolved = typeof next === 'function' ? next(current) : next
      return resolved
    })
  }

  const setSettings = (next) => {
    setSettingsState((current) => {
      const resolved = typeof next === 'function' ? next(current) : next
      return resolved
    })
  }

  const pageProps = { products, settings, setProducts, setSettings, syncError }
  const loginAdminSession = (token) => {
    sessionStorage.setItem(ADMIN_SESSION_KEY, token)
    setAdminToken(token)
  }
  const logoutAdmin = () => {
    sessionStorage.removeItem(ADMIN_SESSION_KEY)
    setAdminToken('')
    window.location.hash = '#/'
  }

  return (
    <div className="min-h-screen text-zinc-100">
      <Header settings={settings} isAdmin={isAdmin} page={route.page} onLogout={logoutAdmin} />
      {route.page === 'detail' ? (
        <DetailPage {...pageProps} productId={route.id} />
      ) : route.page === 'admin' ? (
        isAdmin ? <AdminPage {...pageProps} adminToken={adminToken} /> : <AdminAuthPage settings={settings} setSettings={setSettings} onLogin={loginAdminSession} target="admin" />
      ) : route.page === 'settings' ? (
        isAdmin ? <SettingsPage {...pageProps} adminToken={adminToken} /> : <AdminAuthPage settings={settings} setSettings={setSettings} onLogin={loginAdminSession} target="settings" />
      ) : route.page === 'catalog' ? (
        <CatalogPage {...pageProps} />
      ) : route.page === 'contact' ? (
        <ContactPage settings={settings} />
      ) : route.page === 'backgrounds' ? (
        <BackgroundPreviewPage />
      ) : (
        <HomePage {...pageProps} />
      )}
    </div>
  )
}

function parseRoute(hash) {
  const clean = hash.replace(/^#\/?/, '')
  const [page, id] = clean.split('/')
  if (page === 'product' && id) return { page: 'detail', id }
  if (page === 'admin') return { page: 'admin' }
  if (page === 'settings') return { page: 'settings' }
  if (page === 'catalog') return { page: 'catalog' }
  if (page === 'contact') return { page: 'contact' }
  if (page === 'backgrounds') return { page: 'backgrounds' }
  return { page: 'home' }
}

function Header({ settings, isAdmin, page, onLogout }) {
  return (
    <header className="sticky top-0 z-40 border-b border-zinc-800 bg-black/95 backdrop-blur">
      <div className="relative mx-auto flex h-[72px] max-w-[1400px] items-center justify-between gap-5 px-4 sm:px-6">
        <a href="#/" className="flex min-w-0 items-center gap-2.5" aria-label={settings.siteName || defaultSettings.siteName}>
          <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded border border-zinc-700 bg-zinc-950 p-2" aria-hidden="true"><img src="/zhu-logo.svg" alt="" className="h-full w-full object-contain" /></span>
          <span className="truncate text-base font-black text-white sm:text-lg">{settings.siteName || defaultSettings.siteName}</span>
        </a>
        <nav aria-label="主要導覽" className="absolute inset-y-0 left-1/2 hidden -translate-x-1/2 items-stretch md:flex">
          <NavLink href="#/">首頁</NavLink>
          <NavLink href="#/catalog">購買帳號</NavLink>
          <NavLink href="#/contact">聯繫我們</NavLink>
        </nav>
        <div className="flex shrink-0 items-center gap-1.5">
          {isAdmin && (page === 'admin' || page === 'settings') && (
            <>
              <NavLink href="#/admin">後台</NavLink>
              <NavLink href="#/settings">設定</NavLink>
              <IconButton label="登出" onClick={onLogout}><LogOut size={16} /></IconButton>
            </>
          )}
          <a href="#/catalog" aria-label="購買帳號" className="inline-flex h-9 items-center rounded border border-zinc-700 px-2.5 text-xs font-black text-zinc-200 md:hidden">購買帳號</a>
        </div>
      </div>
    </header>
  )
}

function NavLink({ href, children }) {
  return (
    <a className="nav-link relative inline-flex items-center px-4 text-[15px] font-bold text-zinc-400 after:absolute after:inset-x-4 after:bottom-0 after:h-px after:origin-left after:scale-x-0 after:bg-white hover:text-white hover:after:scale-x-100" href={href}>
      {children}
    </a>
  )
}

function AdminAuthPage({ settings, setSettings, onLogin, target }) {
  const hasAdminAccount = Boolean(settings.hasAdminAccount || getAdminUsers(settings).length)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')

  const submit = async (event) => {
    event.preventDefault()
    setError('')

    if (!username.trim() || !password.trim()) {
      setError('請輸入管理員帳號與密碼。')
      return
    }

    if (!hasAdminAccount) {
      try {
        const result = await setupAdmin(username.trim(), password)
        setSettings((current) => ({
          ...current,
          hasAdminAccount: true,
        }))
        onLogin(result.token)
        window.location.hash = `#/${target}`
      } catch (error) {
        setError(error.message)
      }
      return
    }

    try {
      const result = await loginAdmin(username.trim(), password)
      onLogin(result.token)
      window.location.hash = `#/${target}`
      return
    } catch (error) {
      setError(error.message)
    }
  }

  return (
    <main className="mx-auto grid min-h-[calc(100vh-4rem)] max-w-md place-items-center px-3 py-8 sm:px-4">
      <form onSubmit={submit} className="w-full space-y-5 border border-zinc-800 bg-zinc-950 p-5 shadow-[0_12px_30px_rgba(0,0,0,0.2)]">
        <div>
          <p className="text-xs font-bold text-zinc-500">CONTROL ROOM</p>
          <h1 className="mt-1 text-2xl font-black">{hasAdminAccount ? '管理員登入' : '建立管理員帳號'}</h1>
          <p className="mt-2 text-sm leading-6 text-zinc-400">
            {hasAdminAccount ? '登入後才能進入後台與設定頁。' : '第一次使用請先建立雲端管理員帳號。'}
          </p>
          <p className="mt-3 border-l-2 border-zinc-500 bg-zinc-900 px-3 py-2 text-xs leading-5 text-zinc-400">
            管理員帳密經雜湊後存於 Cloudflare D1，登入階段不會把密碼傳回瀏覽器。
          </p>
        </div>
        <label className="block">
          <span className="mb-1 block text-sm font-bold text-zinc-300">管理員帳號</span>
          <input
            className="h-11 w-full rounded-md border border-zinc-700 bg-zinc-900 px-3"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            autoComplete="username"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-bold text-zinc-300">管理員密碼</span>
          <input
            className="h-11 w-full rounded-md border border-zinc-700 bg-zinc-900 px-3"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete={hasAdminAccount ? 'current-password' : 'new-password'}
          />
        </label>
        {error && <p className="border-l-2 border-zinc-200 bg-zinc-900 px-3 py-2 text-sm text-zinc-200">{error}</p>}
        <button type="submit" className="h-11 w-full rounded bg-zinc-100 font-black text-zinc-950 transition hover:bg-white">
          {hasAdminAccount ? '登入後台' : '建立並登入'}
        </button>
      </form>
    </main>
  )
}

function HomePage({ products, settings }) {
  const publicProducts = products.filter((product) => PUBLIC_STATUSES.includes(product.status))
  return (
    <main>
      <section id="home" className="relative h-[calc(100svh-72px)] min-h-[560px] overflow-hidden bg-black">
        <HeroVideoBackground />
        <div className="relative mx-auto flex h-full max-w-[1400px] flex-col items-center justify-center px-5 pb-28 pt-10 text-center sm:px-8">
          <p className="hero-reveal mb-5 rounded-full border border-zinc-500 bg-black/50 px-4 py-2 text-xs font-black tracking-[0.2em] text-zinc-200" style={{ '--reveal-delay': '80ms' }}>AOV · 現貨帳號即時展示</p>
          <BlurText as="h1" text={settings.siteName || defaultSettings.siteName} className="max-w-5xl text-5xl font-black leading-[1.05] text-white sm:text-7xl lg:text-8xl" />
          <p className="hero-reveal mt-3 text-3xl font-black text-zinc-200 sm:text-5xl" style={{ '--reveal-delay': '240ms' }}>傳說對決帳號專門店</p>
          <p className="hero-reveal mt-6 max-w-2xl text-base font-medium leading-7 text-zinc-200 sm:text-lg" style={{ '--reveal-delay': '320ms' }}>完整帳號圖片、清楚價格與即時現貨狀態，從瀏覽到聯絡只需幾分鐘。</p>
          <div className="hero-reveal mt-7 flex flex-wrap gap-2.5" style={{ '--reveal-delay': '400ms' }}>
            <a href="#/catalog" className="interactive-button inline-flex items-center gap-2 rounded bg-white px-7 py-3.5 text-base font-black text-black shadow-[0_8px_30px_rgba(0,0,0,0.3)] hover:bg-zinc-200">瀏覽帳號<ArrowRight size={18} /></a>
            <a href="#/contact" className="interactive-button inline-flex h-13 items-center rounded border border-zinc-400 bg-black/35 px-7 py-3.5 text-base font-black text-white backdrop-blur-sm hover:border-white">聯繫我們</a>
          </div>
          <div className="hero-reveal absolute bottom-7 grid w-[min(760px,calc(100%-2rem))] grid-cols-3 divide-x divide-zinc-700 border-y border-zinc-700/80 py-4" style={{ '--reveal-delay': '500ms' }}>
            <div><strong className="block text-2xl font-black tabular-nums text-white">{publicProducts.length}</strong><span className="text-xs font-bold text-zinc-300">在售帳號</span></div>
            <div><strong className="block text-2xl font-black text-white">AOV</strong><span className="text-xs font-bold text-zinc-300">專門賣場</span></div>
            <div><strong className="block text-lg font-black leading-tight text-white sm:text-2xl"><span className="block">上午 10:00</span><span className="block">下午 10:00</span></strong><span className="mt-1 block text-xs font-bold text-zinc-300">工作時間</span></div>
          </div>
        </div>
      </section>
      <FloatingContacts settings={settings} />
    </main>
  )
}

const BACKGROUND_OPTIONS = [
  { mode: 'liquid', number: '01', name: '液態金屬', note: '流動感最明顯，黑銀對比強' },
  { mode: 'aurora', number: '02', name: '極光薄霧', note: '柔和有層次，文字最容易閱讀' },
  { mode: 'beams', number: '03', name: '光束流線', note: '視覺集中，首頁主標題更有舞台感' },
  { mode: 'particles', number: '04', name: '深空粒子', note: '科技感較強，動態細節最豐富' },
]

function BackgroundPreviewPage() {
  return (
    <main className="mx-auto max-w-[1600px] px-4 py-10 sm:px-8 sm:py-14">
      <div className="mb-8 border-b border-zinc-800 pb-7">
        <p className="text-xs font-black tracking-[0.22em] text-zinc-500">BACKGROUND STUDY</p>
        <h1 className="mt-3 text-3xl font-black text-white sm:text-5xl">首頁背景候選</h1>
        <p className="mt-3 text-sm leading-6 text-zinc-400">四種都是即時動態效果。告訴我編號，我再套用到正式首頁。</p>
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        {BACKGROUND_OPTIONS.map((option) => (
          <section key={option.mode} className="overflow-hidden rounded-lg border border-zinc-800 bg-black shadow-2xl">
            <div className="relative h-[390px] overflow-hidden sm:h-[460px]">
              <DynamicVeil mode={option.mode} />
              <div className="absolute inset-0 bg-black/10" />
              <div className="relative flex h-full flex-col items-center justify-center px-6 text-center">
                <p className="mb-4 rounded-full border border-zinc-500/80 bg-black/45 px-3 py-1.5 text-[10px] font-black tracking-[0.2em] text-zinc-200">AOV · 現貨帳號即時展示</p>
                <h2 className="text-4xl font-black text-white drop-shadow-2xl sm:text-6xl">Zhuの小舖</h2>
                <p className="mt-2 text-xl font-black text-zinc-100 sm:text-3xl">傳說對決帳號專門店</p>
                <div className="mt-7 rounded bg-white px-5 py-3 text-sm font-black text-black">瀏覽帳號</div>
              </div>
            </div>
            <div className="flex items-start gap-4 border-t border-zinc-800 px-5 py-4">
              <span className="font-mono text-sm text-zinc-500">{option.number}</span>
              <div><h3 className="font-black text-white">{option.name}</h3><p className="mt-1 text-sm text-zinc-400">{option.note}</p></div>
            </div>
          </section>
        ))}
      </div>
    </main>
  )
}

function ContactPage({ settings }) {
  const methods = getContactMethods(settings)
  return (
    <main className="mx-auto min-h-[calc(100svh-4rem)] max-w-6xl px-4 py-12 sm:px-8 sm:py-20">
      <div className="motion-reveal"><p className="text-xs font-black tracking-[0.22em] text-zinc-500">CONTACT</p>
      <h1 className="mt-3 text-4xl font-black text-white sm:text-6xl">聯繫我們</h1>
      <p className="mt-5 max-w-2xl text-base leading-7 text-zinc-400">詢問帳號時請附上商品編號，我們會透過你選擇的社群平台回覆。網站僅提供帳號展示，聯絡後再確認商品現況與細節。</p></div>
      <section aria-label="工作時間" className="motion-reveal mt-8 flex flex-col justify-between gap-2 border-y border-zinc-800 py-5 sm:flex-row sm:items-center" style={{ '--reveal-delay': '100ms' }}>
        <div><p className="text-xs font-black tracking-[0.18em] text-zinc-500">WORKING HOURS</p><h2 className="mt-1 text-lg font-black text-white">工作時間</h2></div>
        <p className="text-2xl font-black tabular-nums text-zinc-100 sm:text-3xl">{WORKING_HOURS}</p>
      </section>
      <section className="mt-10 border-y border-zinc-700 sm:mt-14">
        {methods.map((method, index) => {
          const brand = contactBrand(method)
          return (
            <div key={method.id} className="contact-row motion-reveal flex min-h-24 items-center justify-between gap-4 border-b border-zinc-800 py-5 last:border-b-0" style={{ '--reveal-delay': `${160 + index * 70}ms` }}>
              <div className="flex items-center gap-4">
                <span className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-zinc-700 bg-zinc-950 text-white"><BrandIcon icon={brand.icon} /></span>
                <div><h2 className="text-lg font-black text-white">{brand.label}</h2><p className="mt-1 text-xs text-zinc-500">使用 {brand.label} 私訊詢問</p></div>
              </div>
              {method.url ? <a href={method.url} target="_blank" rel="noreferrer" className="interactive-button inline-flex h-10 shrink-0 items-center gap-2 rounded bg-white px-4 text-sm font-black text-black">前往聯絡<ExternalLink size={15} /></a> : <span className="text-sm font-bold text-zinc-600">尚未設定</span>}
            </div>
          )
        })}
      </section>
      <FloatingContacts settings={settings} />
    </main>
  )
}

function CatalogPage({ products, settings }) {
  const initialState = useRef(readHomeState())
  const restoredScroll = useRef(false)
  const filtersInitialized = useRef(false)
  const catalogTop = useRef(null)
  const [query, setQuery] = useState(initialState.current.query)
  const [minPrice, setMinPrice] = useState(initialState.current.minPrice)
  const [maxPrice, setMaxPrice] = useState(initialState.current.maxPrice)
  const [sort, setSort] = useState(initialState.current.sort)
  const [page, setPage] = useState(initialState.current.page)

  useEffect(() => {
    saveHomeState({ query, minPrice, maxPrice, sort, page })
  }, [query, minPrice, maxPrice, sort, page])

  useEffect(() => {
    if (!filtersInitialized.current) {
      filtersInitialized.current = true
      return
    }
    setPage(1)
  }, [query, minPrice, maxPrice, sort])

  useEffect(() => {
    if (restoredScroll.current || !products.length) return
    restoredScroll.current = true
    requestAnimationFrame(() => window.scrollTo({ top: initialState.current.scrollY, behavior: 'auto' }))
  }, [products.length])

  const rememberCatalogPosition = (productId) => saveHomeState({ query, minPrice, maxPrice, sort, page, scrollY: window.scrollY, lastProductId: productId })

  const visibleProducts = useMemo(() => {
    const search = query.trim().toLowerCase()
    const filtered = products
      .filter((product) => PUBLIC_STATUSES.includes(product.status))
      .filter((product) => {
        const target = [product.code, product.title, product.description].join(' ').toLowerCase()
        const price = Number(product.price)
        const hasPriceFilter = Boolean(minPrice || maxPrice)
        const matchesPrice = (!hasPriceFilter || price > 0) && (!minPrice || price >= Number(minPrice)) && (!maxPrice || price <= Number(maxPrice))
        return (!search || target.includes(search)) && matchesPrice
      })

    return filtered.sort((a, b) => {
      if (sort === 'priceAsc') return (Number(a.price) || Number.MAX_SAFE_INTEGER) - (Number(b.price) || Number.MAX_SAFE_INTEGER)
      if (sort === 'priceDesc') return Number(b.price || 0) - Number(a.price || 0)
      if (sort === 'newest') return new Date(b.createdAt) - new Date(a.createdAt)
      return Number(a.sortOrder || 0) - Number(b.sortOrder || 0) || a.code.localeCompare(b.code)
    })
  }, [products, query, minPrice, maxPrice, sort])

  const publicProducts = products.filter((product) => PUBLIC_STATUSES.includes(product.status))
  const publicProductCount = publicProducts.length
  const pageCount = Math.max(1, Math.ceil(visibleProducts.length / CATALOG_PAGE_SIZE))
  const currentPage = Math.min(Math.max(1, page), pageCount)
  const pageProducts = visibleProducts.slice((currentPage - 1) * CATALOG_PAGE_SIZE, currentPage * CATALOG_PAGE_SIZE)
  const hasFilters = Boolean(query || minPrice || maxPrice || sort !== 'default')

  useEffect(() => {
    if (page !== currentPage) setPage(currentPage)
  }, [currentPage, page])

  const resetFilters = () => {
    setQuery('')
    setMinPrice('')
    setMaxPrice('')
    setSort('default')
    setPage(1)
  }

  const goToPage = (nextPage) => {
    const safePage = Math.min(Math.max(1, nextPage), pageCount)
    setPage(safePage)
    saveHomeState({ page: safePage, scrollY: 0 })
    requestAnimationFrame(() => window.scrollTo({ top: Math.max(0, (catalogTop.current?.offsetTop || 0) - 72), behavior: 'smooth' }))
  }

  return (
    <main id="catalog" className="mx-auto max-w-[1400px] scroll-mt-20 px-4 pb-5 sm:px-6">
      <header className="motion-reveal border-b border-zinc-800 py-7 sm:py-10">
        <p className="text-xs font-black tracking-[0.2em] text-zinc-500">ACCOUNT LIST</p>
        <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-black text-white sm:text-4xl">傳說對決帳號</h1>
            <p className="mt-2 text-base text-zinc-500">所有帳號資訊以展示圖片為準</p>
          </div>
          <p className="text-base font-bold tabular-nums text-zinc-400"><span className="text-3xl text-white">{publicProductCount}</span> 件現貨</p>
        </div>
      </header>

      <AccountCarousel products={publicProducts} ImageComponent={StoredImage} formatPrice={formatPrice} onOpen={rememberCatalogPosition} />

      <section ref={catalogTop} className="motion-reveal mb-6 border-b border-zinc-800 py-4 sm:py-5" style={{ '--reveal-delay': '80ms' }}>
        <div className="grid gap-3 lg:grid-cols-[minmax(20rem,1fr)_minmax(20rem,auto)_12rem_auto]">
          <label className="relative block">
            <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" size={17} />
            <input className="h-12 w-full rounded border border-zinc-700 bg-zinc-950 pl-10 pr-3 text-base text-white placeholder:text-zinc-500" placeholder="搜尋帳號編號" value={query} onChange={(event) => setQuery(event.target.value)} />
          </label>
          <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2">
            <label className="relative block">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs font-bold text-zinc-500">NT$</span>
              <input aria-label="最低價格" inputMode="numeric" className="h-12 w-full rounded border border-zinc-700 bg-zinc-950 pl-10 pr-2 text-base" placeholder="最低" value={minPrice} onChange={(event) => setMinPrice(event.target.value.replace(/[^\d]/g, ''))} />
            </label>
            <span className="text-zinc-600">—</span>
            <label className="relative block">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs font-bold text-zinc-500">NT$</span>
              <input aria-label="最高價格" inputMode="numeric" className="h-12 w-full rounded border border-zinc-700 bg-zinc-950 pl-10 pr-2 text-base" placeholder="最高" value={maxPrice} onChange={(event) => setMaxPrice(event.target.value.replace(/[^\d]/g, ''))} />
            </label>
          </div>
          <label className="relative block">
            <ArrowUpDown className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" size={15} />
            <select aria-label="商品排序" className="h-12 w-full appearance-none rounded border border-zinc-700 bg-zinc-950 pl-9 pr-8 text-base" value={sort} onChange={(event) => setSort(event.target.value)}>
            <option value="default">預設排序</option>
            <option value="priceAsc">價格低到高</option>
            <option value="priceDesc">價格高到低</option>
            <option value="newest">最新上架</option>
            </select>
            <ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500" size={15} />
          </label>
          <button type="button" onClick={resetFilters} disabled={!hasFilters} className="inline-flex h-12 items-center justify-center gap-2 rounded border border-zinc-700 px-4 text-base font-bold text-zinc-300 transition hover:border-zinc-400 hover:text-white disabled:cursor-default disabled:opacity-35">
            <RotateCcw size={15} />重設
          </button>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs font-medium text-zinc-500">
          <p>找到 <span className="font-black text-zinc-200">{visibleProducts.length}</span> 件商品</p>
          {visibleProducts.length > 0 && <p>第 {currentPage} / {pageCount} 頁</p>}
        </div>
      </section>

      {visibleProducts.length ? (
        <>
          <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4">
            {pageProducts.map((product, index) => <ProductCard key={product.id} product={product} settings={settings} onOpen={rememberCatalogPosition} index={index} />)}
          </section>
          {pageCount > 1 && <CatalogPagination page={currentPage} pageCount={pageCount} onChange={goToPage} />}
        </>
      ) : (
        <EmptyState title="目前沒有符合條件的商品" text="可以調整商品編號或價格範圍後再看看。" />
      )}
      <StoreFooter settings={settings} />
      <FloatingContacts settings={settings} />
    </main>
  )
}

function CatalogPagination({ page, pageCount, onChange }) {
  const candidates = [1, page - 1, page, page + 1, pageCount]
  const pages = [...new Set(candidates.filter((value) => value >= 1 && value <= pageCount))].sort((a, b) => a - b)
  return (
    <nav aria-label="商品分頁" className="motion-reveal mt-7 flex items-center justify-center gap-1.5 sm:mt-9">
      <IconButton label="上一頁" onClick={() => onChange(page - 1)} disabled={page === 1} className="border border-zinc-800 text-zinc-300"><ChevronLeft size={17} /></IconButton>
      {pages.map((value, index) => (
        <span key={value} className="contents">
          {index > 0 && value - pages[index - 1] > 1 && <span className="grid h-9 w-6 place-items-center text-zinc-600">…</span>}
          <button type="button" aria-current={value === page ? 'page' : undefined} onClick={() => onChange(value)} className={`h-9 min-w-9 rounded border px-2 text-sm font-black tabular-nums ${value === page ? 'border-zinc-100 bg-zinc-100 text-zinc-950' : 'border-zinc-800 text-zinc-400 hover:border-zinc-500 hover:text-white'}`}>{value}</button>
        </span>
      ))}
      <IconButton label="下一頁" onClick={() => onChange(page + 1)} disabled={page === pageCount} className="border border-zinc-800 text-zinc-300"><ChevronRight size={17} /></IconButton>
    </nav>
  )
}

function StoreFooter({ settings }) {
  const methods = getContactMethods(settings)
  return (
    <footer id="contact" className="mt-10 border-t border-zinc-800 py-8 sm:mt-14 sm:py-10">
      <div className="flex flex-col items-center justify-between gap-6 sm:flex-row">
        <div className="flex items-center gap-4">
          <span className="inline-flex h-20 w-20 shrink-0 items-center justify-center rounded border border-zinc-700 bg-zinc-950 p-4 sm:h-24 sm:w-24" aria-hidden="true"><img src="/zhu-logo.svg" alt="" className="h-full w-full object-contain" /></span>
          <div><p className="font-black text-white">Zhuの小舖</p><p className="mt-1 text-xs text-zinc-500">傳說對決帳號展示</p></div>
        </div>
        <div className="text-center sm:text-right">
          <p className="mb-2 text-xs font-black tracking-[0.15em] text-zinc-500">CONTACT</p>
          <div className="flex items-center gap-2">
          {methods.map((method) => {
            const brand = contactBrand(method)
            return method.url ? (
              <a key={method.id} href={method.url} target="_blank" rel="noreferrer" title={brand.label} aria-label={brand.label} className="inline-flex h-12 w-12 items-center justify-center rounded border border-zinc-700 text-zinc-200 transition hover:border-zinc-300 hover:bg-zinc-100 hover:text-zinc-950">
                <BrandIcon icon={brand.icon} />
              </a>
            ) : (
              <span key={method.id} title={`${brand.label} 尚未設定`} aria-label={`${brand.label} 尚未設定`} className="inline-flex h-12 w-12 items-center justify-center rounded border border-zinc-800 text-zinc-700">
                <BrandIcon icon={brand.icon} />
              </span>
            )
          })}
          </div>
        </div>
      </div>
    </footer>
  )
}

function FloatingContacts({ settings }) {
  const methods = getContactMethods(settings).filter((method) => method.url)
  if (!methods.length) return null
  return (
    <aside aria-label="快速聯絡" className="floating-contacts fixed bottom-4 right-3 z-30 flex flex-col gap-2 sm:bottom-6 sm:right-5">
      {methods.map((method) => {
        const brand = contactBrand(method)
        return (
          <a key={method.id} href={method.url} target="_blank" rel="noreferrer" title={brand.label} aria-label={`使用 ${brand.label} 聯絡`} className="group inline-flex h-12 w-12 items-center justify-center rounded-full border border-zinc-300 bg-zinc-100 text-zinc-950 shadow-[0_5px_20px_rgba(0,0,0,0.45)] transition hover:-translate-y-0.5 hover:bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white">
            <BrandIcon icon={brand.icon} />
            <span className="pointer-events-none absolute right-14 hidden whitespace-nowrap border border-zinc-700 bg-black px-2 py-1 text-xs font-bold text-white shadow-lg group-hover:block sm:block sm:opacity-0 sm:transition sm:group-hover:opacity-100">{brand.label}</span>
          </a>
        )
      })}
    </aside>
  )
}

function BrandIcon({ icon }) {
  return <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5 fill-current"><path d={icon.path} /></svg>
}

function contactBrand(method) {
  const name = `${method.id || ''} ${method.label || ''}`.toLowerCase()
  if (name.includes('instagram') || /(^|\s)ig($|\s)/.test(name)) return { label: 'Instagram', icon: siInstagram }
  if (name.includes('facebook') || /(^|\s)fb($|\s)/.test(name)) return { label: 'Facebook', icon: siFacebook }
  return { label: 'LINE', icon: siLine }
}

function ProductCard({ product, settings, onOpen, index = 0 }) {
  return (
    <SpotlightCard as="article" className="product-card motion-reveal overflow-hidden rounded border border-zinc-800 bg-zinc-950 shadow-[0_3px_9px_rgba(0,0,0,0.16)]" style={{ '--reveal-delay': `${Math.min(index, 8) * 45}ms` }}>
      <a href={`#/product/${product.id}`} onClick={() => onOpen(product.id)} className="relative block aspect-square bg-black p-1.5">
        <StoredImage imageKey={product.imageKey} imageUrl={product.imageUrl} alt={product.code} className="product-card-image h-full w-full object-contain" />
      </a>
      <div className="space-y-2 p-2.5">
        <div className="flex items-center justify-between gap-2">
          <a href={`#/product/${product.id}`} onClick={() => onOpen(product.id)} className="truncate text-xs font-black text-zinc-100">{product.code}</a>
          <StatusChip status={product.status} />
        </div>
        {product.title && <p className="line-clamp-1 text-xs text-zinc-500">{product.title}</p>}
        {formatPrice(product.price) && <p className="text-base font-black tabular-nums text-zinc-100">{formatPrice(product.price)}</p>}
        <ContactButton product={product} settings={settings} compact />
      </div>
    </SpotlightCard>
  )
}

function DetailPage({ products, settings, productId }) {
  const [previewOpen, setPreviewOpen] = useState(false)
  const product = products.find((item) => item.id === productId)
  const returnToCatalog = () => {
    if (readHomeState().lastProductId === productId) window.history.back()
    else window.location.hash = '#/catalog'
  }

  if (!product || !PUBLIC_STATUSES.includes(product.status)) {
    return (
      <main className="mx-auto max-w-4xl px-3 py-6 sm:px-5">
        <EmptyState title="找不到公開商品" text="這筆商品可能還是草稿、已隱藏，或已被刪除。" />
        <button type="button" onClick={returnToCatalog} className="mt-4 inline-flex items-center gap-2 rounded bg-zinc-100 px-4 py-2 font-bold text-zinc-950"><ArrowLeft size={16} />返回商品列表</button>
      </main>
    )
  }

  return (
    <main className="mx-auto max-w-[1400px] px-3 py-4 sm:px-5">
      <button type="button" onClick={returnToCatalog} className="mb-4 inline-flex items-center gap-2 rounded border border-zinc-700 px-3 py-2 text-sm text-zinc-300 transition hover:border-zinc-400 hover:text-white"><ArrowLeft size={16} />商品列表</button>
      <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <button type="button" onClick={() => setPreviewOpen(true)} className="min-h-[56vh] overflow-hidden rounded border border-zinc-800 bg-black p-2" title="查看完整圖片" aria-label={`查看 ${product.code} 的完整圖片`}>
          <StoredImage imageKey={product.imageKey} imageUrl={product.imageUrl} alt={product.code} className="h-full max-h-[78vh] w-full object-contain" />
        </button>
        <aside className="space-y-5 border-y border-zinc-800 py-4 lg:border lg:p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm text-zinc-400">商品編號</p>
              <h1 className="text-2xl font-black">{product.code}</h1>
            </div>
            <StatusChip status={product.status} />
          </div>
          {product.title && <p className="text-lg font-bold text-zinc-200">{product.title}</p>}
          {formatPrice(product.price) && <p className="text-3xl font-black tabular-nums text-zinc-100">{formatPrice(product.price)}</p>}
          {product.description && (
            <div>
              <h2 className="mb-2 text-sm font-bold text-zinc-300">備註</h2>
              <p className="whitespace-pre-wrap border-l-2 border-zinc-700 bg-zinc-900 px-3 py-2 text-sm leading-6 text-zinc-300">{product.description}</p>
            </div>
          )}
          <ContactButton product={product} settings={settings} />
        </aside>
      </section>
      {previewOpen && <ImagePreview imageKey={product.imageKey} imageUrl={product.imageUrl} alt={product.code} onClose={() => setPreviewOpen(false)} />}
    </main>
  )
}

function AdminPage({ products, settings, setProducts, adminToken, syncError }) {
  const [message, setMessage] = useState('')
  const [previewProduct, setPreviewProduct] = useState(null)
  const [uploads, setUploads] = useState([])
  const [activeUploadBatch, setActiveUploadBatch] = useState('')
  const [isClearing, setIsClearing] = useState(false)
  const [isRecognizing, setIsRecognizing] = useState(false)
  const [recognizingProductId, setRecognizingProductId] = useState('')
  const [selectedIds, setSelectedIds] = useState(() => new Set())
  const [isDeletingSelected, setIsDeletingSelected] = useState(false)
  const [suppliers, setSuppliers] = useState([])
  const [uploadSupplierId, setUploadSupplierId] = useState('')
  const [deleteImageMatches, setDeleteImageMatches] = useState([])
  const [isMatchingDeleteImages, setIsMatchingDeleteImages] = useState(false)
  const [isDeletingImageMatches, setIsDeletingImageMatches] = useState(false)
  const queues = useRef(new Map())
  const versions = useRef(new Map())
  const uploadControllers = useRef(new Map())
  const cancelledUploadBatches = useRef(new Set())

  products.forEach((product) => versions.current.set(product.id, product.version || 1))

  useEffect(() => {
    listSuppliers(adminToken)
      .then((result) => {
        setSuppliers(result.suppliers || [])
      })
      .catch((error) => setMessage(error.message || '無法載入供應商清單。'))
  }, [adminToken])

  const queueProductOperation = (id, operation, patch = {}) => {
    const previousProduct = products.find((product) => product.id === id)
    if (Object.keys(patch).length) {
      const now = new Date().toISOString()
      setProducts((current) => current.map((product) => (product.id === id ? { ...product, ...patch, updatedAt: now } : product)))
    }
    const previous = queues.current.get(id) || Promise.resolve()
    const task = previous.catch(() => {}).then(async () => {
      const version = versions.current.get(id) || 1
      const result = await operation(version)
      if (result.product) {
        versions.current.set(id, result.product.version)
        setProducts((current) => current.map((product) => (product.id === id ? { ...product, version: result.product.version, updatedAt: result.product.updatedAt } : product)))
      }
      return result
    }).catch((error) => {
      if (previousProduct && Object.keys(patch).length) {
        setProducts((current) => current.map((product) => product.id === id ? previousProduct : product))
      }
      setMessage(error.message || '雲端更新失敗，請重新整理後再處理版本衝突。')
      return null
    })
    queues.current.set(id, task)
    return task
  }

  const patchUpload = (clientItemId, patch) => {
    setUploads((current) => current.map((upload) => (
      upload.clientItemId === clientItemId ? { ...upload, ...patch } : upload
    )))
  }

  const runUploadWorkers = async (batchId, jobs) => {
    let nextIndex = 0
    const worker = async () => {
      while (nextIndex < jobs.length) {
        const job = jobs[nextIndex]
        nextIndex += 1
        if (cancelledUploadBatches.current.has(batchId)) {
          patchUpload(job.clientItemId, { status: 'cancelled' })
          continue
        }
        const controller = new AbortController()
        uploadControllers.current.set(job.clientItemId, controller)
        patchUpload(job.clientItemId, { status: 'uploading', error: '' })
        try {
          await putImage(job.imageKey, job.file, adminToken, {
            batchId,
            signal: controller.signal,
            onProgress: (loaded, total) => patchUpload(job.clientItemId, { loaded, total }),
          })
          await linkSyncItem({ productId: job.product.id, supplierId: job.supplierId, origin: 'mobile', contentHash: job.contentHash, fileName: job.file.name }, adminToken)
          patchUpload(job.clientItemId, { status: 'recognizing', loaded: job.file.size, total: job.file.size })
          try {
            const recognition = await recognizeImagePrice(job.imageKey, adminToken)
            if (recognition.product) {
              versions.current.set(recognition.product.id, recognition.product.version || 1)
              setProducts((current) => current.map((product) => (product.id === recognition.product.id ? recognition.product : product)))
            }
            patchUpload(job.clientItemId, {
              status: 'ready',
              recognizedPrice: recognition.price,
              error: recognition.recognized ? '' : '未辨識到數字價格，請手動確認。',
            })
          } catch (recognitionError) {
            patchUpload(job.clientItemId, { status: 'ready', error: recognitionError.message || '價格辨識失敗，請手動確認。' })
          }
        } catch (caught) {
          const cancelled = caught?.name === 'AbortError' || cancelledUploadBatches.current.has(batchId)
          patchUpload(job.clientItemId, {
            status: cancelled ? 'cancelled' : 'failed',
            error: cancelled ? '' : (caught.message || '圖片上傳失敗。'),
          })
        } finally {
          uploadControllers.current.delete(job.clientItemId)
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(UPLOAD_CONCURRENCY, jobs.length) }, worker))
    if (!cancelledUploadBatches.current.has(batchId)) setMessage('批次上傳完成，請確認失敗檔案後再上架。')
    setActiveUploadBatch((current) => (current === batchId ? '' : current))
  }

  const handleBatchUpload = async (event) => {
    const input = event.target
    const files = Array.from(input.files || []).filter((file) => file.type.startsWith('image/'))
    input.value = ''
    if (!files.length || activeUploadBatch || !uploadSupplierId) return
    const batchId = crypto.randomUUID()
    const jobs = await Promise.all(files.map(async (file, index) => {
      const clientItemId = crypto.randomUUID()
      return {
        batchId,
        clientItemId,
        imageKey: `img-${batchId}-${clientItemId}`,
        file,
        supplierId: uploadSupplierId,
        contentHash: await hashImageFile(file),
        name: file.name,
        total: file.size,
        loaded: 0,
        sortOrder: products.length + index + 1,
        status: 'registering',
        registered: false,
        error: '',
      }
    }))
    setUploads(jobs)
    setActiveUploadBatch(batchId)
    cancelledUploadBatches.current.delete(batchId)
    try {
      await createUploadBatch(adminToken, batchId)
    } catch (caught) {
      setUploads((current) => current.map((upload) => ({ ...upload, status: 'failed', error: caught.message || '無法建立上傳批次。' })))
      setActiveUploadBatch('')
      return
    }

    const registered = []
    for (let start = 0; start < jobs.length; start += UPLOAD_ITEM_CHUNK_SIZE) {
      if (cancelledUploadBatches.current.has(batchId)) break
      const chunk = jobs.slice(start, start + UPLOAD_ITEM_CHUNK_SIZE)
      try {
        const result = await registerUploadItems(batchId, chunk.map((job) => ({
          clientItemId: job.clientItemId,
          imageKey: job.imageKey,
          contentType: job.file.type || 'application/octet-stream',
          size: job.file.size,
          sortOrder: job.sortOrder,
        })), adminToken)
        const registeredItems = result.items || []
        const saved = registeredItems.map((item) => item.product).filter(Boolean)
        saved.forEach((product) => versions.current.set(product.id, product.version || 1))
        setProducts((current) => {
          const known = new Set(current.map((product) => product.id))
          return [...current, ...saved.filter((product) => !known.has(product.id))]
        })
        registeredItems.forEach((item) => patchUpload(item.clientItemId, {
          status: item.imageStatus === 'ready' ? 'ready' : 'queued',
          registered: true,
          product: item.product,
          error: item.error || '',
        }))
        registered.push(...registeredItems.filter((item) => item.imageStatus !== 'ready').map((item) => ({ ...chunk.find((job) => job.clientItemId === item.clientItemId), product: item.product })))
      } catch (caught) {
        chunk.forEach((job) => patchUpload(job.clientItemId, { status: 'failed', registered: false, error: caught.message || '無法建立這張圖片的商品草稿。' }))
      }
    }
    if (registered.length) await runUploadWorkers(batchId, registered)
    else setActiveUploadBatch('')
  }

  const retryFailedUploads = async () => {
    if (activeUploadBatch) return
    const failedJobs = uploads.filter((upload) => upload.status === 'failed')
    const batchId = uploads[0]?.batchId
    if (!failedJobs.length || !batchId) return
    setActiveUploadBatch(batchId)
    cancelledUploadBatches.current.delete(batchId)
    const uploadJobs = failedJobs.filter((job) => job.registered)
    uploadJobs.forEach((job) => patchUpload(job.clientItemId, { status: 'queued', error: '', loaded: 0 }))

    const registrationJobs = failedJobs.filter((job) => !job.registered)
    try {
      await createUploadBatch(adminToken, batchId)
    } catch (caught) {
      registrationJobs.forEach((job) => patchUpload(job.clientItemId, { status: 'failed', error: caught.message || '無法續傳此上傳批次。' }))
      setActiveUploadBatch('')
      return
    }

    for (let start = 0; start < registrationJobs.length; start += UPLOAD_ITEM_CHUNK_SIZE) {
      const chunk = registrationJobs.slice(start, start + UPLOAD_ITEM_CHUNK_SIZE)
      try {
        const result = await registerUploadItems(batchId, chunk.map((job) => ({
          clientItemId: job.clientItemId,
          imageKey: job.imageKey,
          contentType: job.file.type || 'application/octet-stream',
          size: job.file.size,
          sortOrder: job.sortOrder,
        })), adminToken)
        const registeredItems = result.items || []
        const itemById = new Map(registeredItems.map((item) => [item.clientItemId, item]))
        const saved = registeredItems.map((item) => item.product).filter(Boolean)
        saved.forEach((product) => versions.current.set(product.id, product.version || 1))
        setProducts((current) => {
          const known = new Set(current.map((product) => product.id))
          return [...current, ...saved.filter((product) => !known.has(product.id))]
        })
        chunk.forEach((job) => {
          const item = itemById.get(job.clientItemId)
          if (!item) {
            patchUpload(job.clientItemId, { status: 'failed', registered: false, error: '伺服器未建立此圖片的商品草稿。' })
            return
          }
          const ready = item.imageStatus === 'ready'
          patchUpload(job.clientItemId, { status: ready ? 'ready' : 'queued', registered: true, error: item.error || '', loaded: ready ? job.file.size : 0 })
          if (!ready) uploadJobs.push({ ...job, registered: true, product: item.product })
        })
      } catch (caught) {
        chunk.forEach((job) => patchUpload(job.clientItemId, { status: 'failed', registered: false, error: caught.message || '無法建立這張圖片的商品草稿。' }))
      }
    }

    if (uploadJobs.length) await runUploadWorkers(batchId, uploadJobs)
    else setActiveUploadBatch('')
  }

  const cancelUploads = async () => {
    if (!activeUploadBatch) return
    const batchId = activeUploadBatch
    cancelledUploadBatches.current.add(batchId)
    uploadControllers.current.forEach((controller) => controller.abort())
    setUploads((current) => current.map((upload) => (
      ['registering', 'queued', 'uploading'].includes(upload.status) ? { ...upload, status: 'cancelled' } : upload
    )))
    try {
      await cancelUploadBatch(batchId, adminToken)
      setMessage('已取消批次上傳；已完成的圖片仍保留為草稿。')
    } catch (caught) {
      setMessage(caught.message || '無法取消上傳批次。')
    }
  }

  const updateProduct = (id, patch) => {
    const operation = patch.status && Object.keys(patch).length === 1
      ? (version) => updateProductStatus(id, patch.status, version, adminToken)
      : (version) => updateProductApi(id, patch, version, adminToken)
    return queueProductOperation(id, operation, patch)
  }

  const applyRecognizedProducts = (recognizedProducts) => {
    const byId = new Map((recognizedProducts || []).map((product) => [product.id, product]))
    recognizedProducts?.forEach((product) => versions.current.set(product.id, product.version || 1))
    setProducts((current) => current.map((product) => byId.get(product.id) || product))
  }

  const recognizeAllUnpublished = async () => {
    if (isRecognizing) return
    setIsRecognizing(true)
    setMessage('正在重新識別未上架商品的價格…')
    try {
      const result = await recognizeUnpublishedPrices(adminToken)
      applyRecognizedProducts(result.products)
      setMessage(`重新識別完成：掃描 ${result.scanned} 筆，成功 ${result.recognized} 筆，更新 ${result.changed || 0} 筆，${result.unknown} 筆待確認。`)
    } catch (caught) {
      setMessage(caught.message || '重新識別價格失敗，請稍後再試。')
    } finally {
      setIsRecognizing(false)
    }
  }

  const recognizeOneProduct = async (product) => {
    if (recognizingProductId || isRecognizing) return
    setRecognizingProductId(product.id)
    setMessage(`正在重新識別 ${product.code}…`)
    try {
      const result = await recognizeImagePrice(product.imageKey, adminToken)
      if (result.product) applyRecognizedProducts([result.product])
      setMessage(result.recognized ? `${product.code} 已識別為 ${formatPrice(result.price)}。` : `${product.code} 尚無可信價格，請手動確認。`)
    } catch (caught) {
      setMessage(caught.message || `${product.code} 重新識別失敗。`)
    } finally {
      setRecognizingProductId('')
    }
  }

  const publishDrafts = async () => {
    const drafts = products.filter((product) => product.status === 'draft')
    if (!drafts.length) {
      setMessage('目前沒有草稿商品需要上架。')
      return
    }
    if (!confirm(`確定將 ${drafts.length} 筆草稿商品一鍵上架為出售中？`)) return

    const results = await Promise.allSettled(drafts.map(async (product) => {
      const result = await updateProductStatus(product.id, 'available', versions.current.get(product.id) || product.version || 1, adminToken)
      versions.current.set(product.id, result.product.version)
      return result.product
    }))
    const published = results.filter((result) => result.status === 'fulfilled').map((result) => result.value)
    const publishedById = new Map(published.map((product) => [product.id, product]))
    setProducts((current) => current.map((product) => publishedById.get(product.id) || product))
    const failed = results.length - published.length
    setMessage(failed ? `已上架 ${published.length} 筆，${failed} 筆因圖片尚未完成而保留草稿。` : `已上架 ${published.length} 筆商品。`)
  }

  const removeProduct = async (product) => {
    if (!confirm(`確定刪除 ${product.code}？網站會立即移除；若商品已建立同步關聯，本機對應圖片會在下次同步時刪除。`)) return
    try {
      await softDeleteProduct(product.id, versions.current.get(product.id) || product.version || 1, adminToken)
      await deleteImage(product.imageKey, adminToken)
    } catch (caught) {
      setMessage(caught.message || '雲端商品刪除失敗，請重新整理後再試。')
      return
    }
    setProducts((current) => current.filter((item) => item.id !== product.id))
    setMessage(`已刪除 ${product.code}；已建立同步關聯的本機圖片會於下次同步時刪除。`)
  }

  const clearAll = async () => {
    if (isClearing) return
    if (!products.length) {
      setMessage('目前沒有商品需要清空。')
      return
    }
    if (!confirm(`確定清空全部 ${products.length} 筆現貨？網站會立即清空；已建立同步關聯的本機圖片會在下次同步時刪除。舊商品的本機圖片需手動清理。此操作無法復原。`)) return
    setIsClearing(true)
    setMessage(`正在刪除 ${products.length} 筆商品，請勿關閉或重複操作…`)
    try {
      const result = await clearAllProducts(adminToken)
      setProducts([])
      setUploads([])
      setMessage(`已刪除 ${result.deleted ?? products.length} 筆商品；已建立同步關聯的本機圖片會於下次同步時刪除。`)
    } catch (caught) {
      setMessage(caught.message || '清空失敗，請重新整理確認剩餘商品。')
    } finally {
      setIsClearing(false)
    }
  }

  const deleteSelected = async () => {
    const ids = [...selectedIds]
    if (!ids.length || isDeletingSelected) return
    if (!confirm(`確定刪除已選取的 ${ids.length} 筆商品？網站會立即移除；已建立同步關聯的本機圖片會在下次同步時刪除。`)) return
    setIsDeletingSelected(true)
    setMessage(`正在刪除 ${ids.length} 筆已選商品…`)
    try {
      const result = await deleteProductsBatch(ids, adminToken)
      const deleted = new Set(ids)
      setProducts((current) => current.filter((product) => !deleted.has(product.id)))
      setSelectedIds(new Set())
      setMessage(`已批量刪除 ${result.deleted} 筆商品；已建立同步關聯的本機圖片會於下次同步時刪除。`)
    } catch (caught) {
      setMessage(caught.message || '批量刪除失敗，請重新整理後再試。')
    } finally {
      setIsDeletingSelected(false)
    }
  }

  const matchDeleteImages = async (event) => {
    const input = event.target
    const files = Array.from(input.files || []).filter((file) => file.type.startsWith('image/')).slice(0, 50)
    input.value = ''
    if (!files.length || isMatchingDeleteImages || isDeletingImageMatches) return
    deleteImageMatches.forEach((item) => URL.revokeObjectURL(item.previewUrl))
    setIsMatchingDeleteImages(true)
    setMessage(`正在比對 ${files.length} 張圖片…`)
    try {
      const candidates = await Promise.all(files.map(async (file) => {
        const [hash, visualHash] = await Promise.all([hashImageFile(file), createVisualHash(file)])
        return { id: crypto.randomUUID(), fileName: file.name, hash, visualHash, previewUrl: URL.createObjectURL(file) }
      }))
      const exactResult = await matchProductsByImageHashes(candidates.map((item) => item.hash), adminToken)
      const exactHashes = new Set((exactResult.matches || []).map((match) => match.hash))
      let result = exactResult
      if (candidates.some((candidate) => !exactHashes.has(candidate.hash))) {
        await ensureVisualHashCoverage(products, adminToken, (completed, total) => {
          setMessage(`正在建立安全的相似圖片比對資料 ${completed}/${total}…`)
        })
        const visualResult = await matchProductsByImages(candidates.filter((candidate) => !exactHashes.has(candidate.hash)).map(({ hash, visualHash }) => ({ hash, visualHash })), adminToken)
        result = {
          matches: [...(exactResult.matches || []), ...(visualResult.matches || [])],
          ambiguous: visualResult.ambiguous || [],
          unmatched: visualResult.unmatched || [],
        }
      }
      const productsByHash = new Map()
      for (const match of result.matches || []) {
        if (!productsByHash.has(match.hash)) productsByHash.set(match.hash, [])
        productsByHash.get(match.hash).push({ ...match.product, imageMatchType: match.matchType || 'exact', imageMatchSimilarity: match.similarity || 100 })
      }
      const ambiguousHashes = new Set(result.ambiguous || [])
      const matches = candidates.map((candidate) => ({ ...candidate, products: productsByHash.get(candidate.hash) || [], ambiguous: ambiguousHashes.has(candidate.hash) }))
      setDeleteImageMatches(matches)
      const matched = matches.filter((item) => item.products.length).length
      setMessage(matched === files.length
        ? `已找到 ${matched} 筆對應商品，確認後即可一次刪除。`
        : `安全配對 ${matched} 筆；其餘 ${files.length - matched} 張無法唯一確認，不會刪除任何資料。`)
    } catch (caught) {
      setMessage(caught.message || '圖片配對失敗，請稍後再試。')
    } finally {
      setIsMatchingDeleteImages(false)
    }
  }

  const clearDeleteImageMatches = () => {
    deleteImageMatches.forEach((item) => URL.revokeObjectURL(item.previewUrl))
    setDeleteImageMatches([])
  }

  const deleteMatchedImages = async () => {
    const matched = deleteImageMatches.filter((item) => item.products.length)
    const ids = [...new Set(matched.flatMap((item) => item.products.map((product) => product.id)))]
    if (!ids.length || isDeletingImageMatches) return
    if (!confirm(`確定刪除配對成功的 ${ids.length} 筆商品？網站會立即下架，本機圖片將於電腦下次同步時刪除。`)) return
    setIsDeletingImageMatches(true)
    setMessage(`正在刪除 ${ids.length} 筆配對商品…`)
    try {
      const result = await deleteProductsBatch(ids, adminToken)
      const deleted = new Set(ids)
      setProducts((current) => current.filter((product) => !deleted.has(product.id)))
      clearDeleteImageMatches()
      setMessage(`已從網站刪除 ${result.deleted} 筆商品；本機刪除工作已排入同步佇列。`)
    } catch (caught) {
      setMessage(caught.message || '以圖刪除失敗，請重新整理後再試。')
    } finally {
      setIsDeletingImageMatches(false)
    }
  }

  const toggleSelected = (id) => setSelectedIds((current) => {
    const next = new Set(current)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })

  const toggleAll = () => setSelectedIds((current) => current.size === products.length ? new Set() : new Set(products.map((product) => product.id)))

  return (
    <main className="mx-auto max-w-[1600px] px-3 py-4 sm:px-5">
      <section className="sticky top-[57px] z-20 -mx-3 mb-5 border-y border-zinc-800 bg-black/95 px-3 py-3 sm:-mx-5 sm:px-5">
        <div className="flex flex-col justify-between gap-3 lg:flex-row lg:items-center">
          <div>
            <div className="flex items-center gap-2"><Settings2 size={17} className="text-zinc-400" /><h1 className="text-lg font-black">管理後台</h1></div>
            <p className="mt-1 text-xs text-zinc-500">{products.length} 筆商品 · 批量上傳會先建立草稿</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
          <label className="relative block">
            <select aria-label="選擇上傳供應商" className="h-9 min-w-40 appearance-none rounded border border-zinc-700 bg-zinc-950 pl-3 pr-8 text-sm font-bold text-zinc-200" value={uploadSupplierId} onChange={(event) => setUploadSupplierId(event.target.value)}>
              <option value="">選擇供應商</option>
              {suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}
            </select>
            <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-500" size={14} />
          </label>
          <label className="inline-flex h-9 cursor-pointer items-center gap-2 rounded bg-zinc-100 px-3 text-sm font-black text-zinc-950 transition hover:bg-white">
            <ImagePlus size={16} />批量上傳
            <input className="hidden" type="file" accept="image/*" multiple disabled={Boolean(activeUploadBatch) || !uploadSupplierId} onChange={handleBatchUpload} />
          </label>
          <label className="inline-flex h-9 cursor-pointer items-center gap-2 rounded border border-zinc-500 px-3 text-sm font-bold text-zinc-100 transition hover:border-zinc-200">
            {isMatchingDeleteImages ? <LoaderCircle size={16} className="animate-spin" /> : <Trash2 size={16} />}以圖刪除
            <input className="hidden" type="file" accept="image/*" multiple disabled={isMatchingDeleteImages || isDeletingImageMatches} onChange={matchDeleteImages} />
          </label>
          <button type="button" onClick={publishDrafts} className="inline-flex h-9 items-center gap-2 rounded border border-zinc-600 px-3 text-sm font-bold text-zinc-100 transition hover:border-zinc-300">
            <Upload size={16} />一鍵上架
          </button>
          <button type="button" onClick={recognizeAllUnpublished} disabled={isRecognizing || Boolean(recognizingProductId)} className="inline-flex h-9 items-center gap-2 rounded border border-zinc-600 px-3 text-sm font-bold text-zinc-100 transition hover:border-zinc-300 disabled:opacity-40">
            {isRecognizing ? <LoaderCircle size={16} className="animate-spin" /> : <RotateCcw size={16} />}重新識別未上架價格
          </button>
          <a href="#/settings" className="inline-flex h-9 items-center gap-2 rounded border border-zinc-700 px-3 text-sm font-bold text-zinc-200"><Settings2 size={16} />設定</a>
          <button type="button" onClick={deleteSelected} disabled={!selectedIds.size || isDeletingSelected} className="inline-flex h-9 items-center gap-2 rounded border border-zinc-700 px-3 text-sm font-bold text-zinc-200 disabled:opacity-40">
            {isDeletingSelected ? <LoaderCircle size={16} className="animate-spin" /> : <Trash2 size={16} />}刪除已選{selectedIds.size ? ` (${selectedIds.size})` : ''}
          </button>
          <IconButton label={isClearing ? '正在清空全部現貨' : '清空全部現貨'} onClick={clearAll} disabled={isClearing} className="border border-zinc-700 text-zinc-400 hover:border-zinc-400 hover:text-white">
            {isClearing ? <LoaderCircle size={16} className="animate-spin" /> : <Trash2 size={16} />}
          </IconButton>
          </div>
        </div>
      </section>

      {message && <p className="mb-3 border-l-2 border-zinc-300 bg-zinc-900 px-3 py-2 text-sm text-zinc-200">{message}</p>}
      {syncError && <p className="mb-3 border-l-2 border-zinc-500 bg-zinc-900 px-3 py-2 text-sm text-zinc-300">同步失敗：{syncError}</p>}
      {!hasContactMethods(settings) && <p className="mb-3 border-l-2 border-zinc-600 px-3 py-2 text-sm text-zinc-400">尚未設定聯絡方式，請到設定頁填入 LINE、Facebook 或 Instagram 連結。</p>}

      {deleteImageMatches.length > 0 && (
        <section className="mb-5 border-y border-zinc-700 py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-black">以圖刪除確認</h2>
              <p className="mt-1 text-xs text-zinc-500">支援壓縮、縮放與畫質差異；只有唯一且可信的配對才可刪除。</p>
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={clearDeleteImageMatches} disabled={isDeletingImageMatches} className="h-9 rounded border border-zinc-700 px-3 text-sm font-bold text-zinc-300 disabled:opacity-40">取消</button>
              <button type="button" onClick={deleteMatchedImages} disabled={isDeletingImageMatches || !deleteImageMatches.some((item) => item.products.length)} className="inline-flex h-9 items-center gap-2 rounded bg-zinc-100 px-3 text-sm font-black text-zinc-950 disabled:opacity-40">
                {isDeletingImageMatches ? <LoaderCircle size={16} className="animate-spin" /> : <Trash2 size={16} />}確認刪除 {new Set(deleteImageMatches.flatMap((item) => item.products.map((product) => product.id))).size} 筆
              </button>
            </div>
          </div>
          <ul className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            {deleteImageMatches.map((item) => (
              <li key={item.id} className={`overflow-hidden rounded border ${item.products.length ? 'border-zinc-500 bg-zinc-950' : 'border-zinc-800 bg-black'}`}>
                <div className="aspect-[4/5] bg-black p-1.5"><img src={item.previewUrl} alt={item.fileName} className="h-full w-full object-contain" /></div>
                <div className="border-t border-zinc-800 p-2">
                  <p className="truncate text-xs text-zinc-500" title={item.fileName}>{item.fileName}</p>
                  <p className={`mt-1 truncate text-sm font-black ${item.products.length ? 'text-white' : 'text-zinc-600'}`}>{item.products.length ? item.products.map((product) => product.code).join('、') : item.ambiguous ? '有相似圖，無法安全確認' : '找不到商品'}</p>
                  {item.products.length > 0 && <p className="mt-1 text-[11px] font-bold text-zinc-500">{item.products[0].imageMatchType === 'visual' ? `相似圖片 ${item.products[0].imageMatchSimilarity}%` : '完全相同'}</p>}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {uploads.length > 0 && (
        <section className="mb-5 border-y border-zinc-800 py-3">
          <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
            <strong className="font-black">上傳進度 <span className="tabular-nums text-zinc-400">{uploads.filter((upload) => upload.status === 'ready').length}/{uploads.length}</span></strong>
            <div className="flex gap-2">
              <button type="button" className="inline-flex h-8 items-center gap-1.5 rounded border border-zinc-700 px-2.5 text-xs font-bold disabled:opacity-40" disabled={Boolean(activeUploadBatch) || !uploads.some((upload) => upload.status === 'failed')} onClick={retryFailedUploads}><RotateCcw size={14} />重試失敗項目</button>
              <button type="button" className="inline-flex h-8 items-center gap-1.5 rounded border border-zinc-700 px-2.5 text-xs font-bold text-zinc-300 disabled:opacity-40" disabled={!activeUploadBatch} onClick={cancelUploads}><X size={14} />取消上傳</button>
            </div>
          </div>
          <progress className="mt-3 h-1.5 w-full accent-zinc-100" value={uploads.reduce((sum, upload) => sum + Math.min(upload.loaded || 0, upload.total || 0), 0)} max={uploads.reduce((sum, upload) => sum + (upload.total || 0), 0) || 1} />
          <ul className="mt-3 max-h-48 divide-y divide-zinc-900 overflow-y-auto text-xs">
            {uploads.map((upload) => <li key={upload.clientItemId} className="grid grid-cols-[5.5rem_minmax(0,1fr)_auto] gap-2 py-2"><span className="font-bold text-zinc-500">{uploadStatusLabel(upload.status)}</span><span className="min-w-0 truncate text-zinc-300">{upload.name}</span>{upload.error ? <span className="max-w-56 truncate text-zinc-500" title={upload.error}>{upload.error}</span> : upload.recognizedPrice ? <span className="font-bold tabular-nums text-zinc-200">{formatPrice(upload.recognizedPrice)}</span> : <span className="tabular-nums text-zinc-600">{upload.total ? `${Math.round(((upload.loaded || 0) / upload.total) * 100)}%` : ''}</span>}</li>)}
          </ul>
        </section>
      )}

      {products.length ? (
        <section className="overflow-x-auto border-y border-zinc-800">
          <table className="w-full min-w-[980px] text-left text-sm">
            <thead className="bg-zinc-900 text-xs uppercase text-zinc-400">
              <tr>
                <th className="w-16 px-2 py-2">
                  <label className="inline-flex h-11 w-11 cursor-pointer items-center justify-center rounded border border-transparent transition hover:border-zinc-700 hover:bg-zinc-800" title="選取全部商品">
                    <input type="checkbox" aria-label="選取全部商品" className="h-7 w-7 cursor-pointer accent-zinc-100" checked={products.length > 0 && selectedIds.size === products.length} onChange={toggleAll} />
                  </label>
                </th>
                <th className="px-3 py-3">圖片</th>
                <th className="px-3 py-3">編號</th>
                <th className="px-3 py-3">標題</th>
                <th className="px-3 py-3">價格</th>
                <th className="px-3 py-3">狀態</th>
                <th className="px-3 py-3">備註</th>
                <th className="px-3 py-3">排序</th>
                <th className="px-3 py-3">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {products.slice().sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0)).map((product) => (
                <AdminRow key={product.id} product={product} selected={selectedIds.has(product.id)} toggleSelected={toggleSelected} updateProduct={updateProduct} removeProduct={removeProduct} openPreview={setPreviewProduct} recognizePrice={recognizeOneProduct} recognizing={recognizingProductId === product.id} recognitionDisabled={isRecognizing || Boolean(recognizingProductId)} />
              ))}
            </tbody>
          </table>
        </section>
      ) : (
        <EmptyState title="尚未建立商品" text="點擊批量上傳圖片後，每張圖片會自動變成一筆草稿商品。" />
      )}
      {previewProduct && (
        <ImagePreview
          imageKey={previewProduct.imageKey}
          imageUrl={previewProduct.imageUrl}
          alt={previewProduct.code}
          onClose={() => setPreviewProduct(null)}
        />
      )}
    </main>
  )
}

function AdminRow({ product, selected, toggleSelected, updateProduct, removeProduct, openPreview, recognizePrice, recognizing, recognitionDisabled }) {
  return (
    <tr className="align-top">
      <td className="px-2 py-3">
        <label className="inline-flex h-11 w-11 cursor-pointer items-center justify-center rounded border border-transparent transition hover:border-zinc-700 hover:bg-zinc-900" title={`選取 ${product.code}`}>
          <input type="checkbox" aria-label={`選取 ${product.code}`} className="h-7 w-7 cursor-pointer accent-zinc-100" checked={selected} onChange={() => toggleSelected(product.id)} />
        </label>
      </td>
      <td className="px-3 py-3">
        <button
          type="button"
          className="h-20 w-20 overflow-hidden rounded bg-black ring-1 ring-zinc-800 transition hover:ring-zinc-300"
          onClick={() => openPreview(product)}
          aria-label={`放大查看 ${product.code} 圖片`}
          title="點擊放大查看"
        >
          <StoredImage imageKey={product.imageKey} imageUrl={product.imageUrl} alt={product.code} className="h-full w-full object-contain" />
        </button>
      </td>
      <td className="px-3 py-3 font-bold text-zinc-100">{product.code}</td>
      <td className="px-3 py-3"><input className="w-36 rounded-md border border-zinc-700 bg-zinc-900 px-2 py-2" value={product.title} onChange={(event) => updateProduct(product.id, { title: event.target.value })} /></td>
      <td className="px-3 py-3"><input className="w-28 rounded-md border border-zinc-700 bg-zinc-900 px-2 py-2" inputMode="numeric" value={product.price} onChange={(event) => updateProduct(product.id, { price: event.target.value.replace(/[^\d]/g, '') })} /></td>
      <td className="px-3 py-3">
        <select className="w-28 rounded-md border border-zinc-700 bg-zinc-900 px-2 py-2" value={product.status} onChange={(event) => event.target.value === 'delete' ? removeProduct(product) : updateProduct(product.id, { status: event.target.value })}>
          {Object.entries(STATUSES).map(([value, meta]) => <option key={value} value={value}>{meta.label}</option>)}
          <option value="delete">刪除</option>
        </select>
      </td>
      <td className="px-3 py-3"><textarea className="h-24 w-52 resize-none rounded-md border border-zinc-700 bg-zinc-900 px-2 py-2" value={product.note} onChange={(event) => updateProduct(product.id, { note: event.target.value })} /></td>
      <td className="px-3 py-3"><input className="w-20 rounded-md border border-zinc-700 bg-zinc-900 px-2 py-2" inputMode="numeric" value={product.sortOrder} onChange={(event) => updateProduct(product.id, { sortOrder: event.target.value.replace(/[^\d]/g, '') })} /></td>
      <td className="space-y-2 px-3 py-3">
        <div className="flex flex-wrap gap-1">
          {['available', 'hidden'].map((status) => <QuickStatus key={status} product={product} updateProduct={updateProduct} status={status} />)}
        </div>
        <div className="flex items-center gap-1">
          {product.status !== 'available' && <IconButton label={`重新識別 ${product.code} 價格`} onClick={() => recognizePrice(product)} disabled={recognitionDisabled} className="h-7 w-7 border border-zinc-700 text-zinc-400 hover:border-zinc-400 hover:text-white">{recognizing ? <LoaderCircle size={14} className="animate-spin" /> : <RotateCcw size={14} />}</IconButton>}
          {PUBLIC_STATUSES.includes(product.status) && <a className="inline-flex h-7 w-7 items-center justify-center rounded border border-zinc-700 text-zinc-300" href={`#/product/${product.id}`} title="查看商品" aria-label={`查看 ${product.code}`}><ExternalLink size={14} /></a>}
          <IconButton label={`刪除 ${product.code}`} onClick={() => removeProduct(product)} className="h-7 w-7 border border-zinc-700 text-zinc-400 hover:border-zinc-400 hover:text-white"><Trash2 size={14} /></IconButton>
        </div>
      </td>
    </tr>
  )
}

function QuickStatus({ product, updateProduct, status }) {
  return <button type="button" title={`標示為${STATUSES[status].label}`} onClick={() => updateProduct(product.id, { status })} className={`rounded border px-2 py-1 text-xs ${product.status === status ? 'border-zinc-200 bg-zinc-100 text-zinc-950' : 'border-zinc-800 bg-zinc-900 text-zinc-400 hover:border-zinc-600'}`}>{STATUSES[status].label}</button>
}

function SettingsPage({ settings, setSettings, adminToken }) {
  const [draft, setDraft] = useState(settings)
  const [adminUsersDraft, setAdminUsersDraft] = useState(() =>
    getAdminUsers(settings).map((user) => ({ ...user, passwordDraft: '', isNew: false })),
  )
  const [saved, setSaved] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')

  useEffect(() => {
    setDraft(settings)
    setAdminUsersDraft(getAdminUsers(settings).map((user) => ({ ...user, passwordDraft: '', isNew: false })))
  }, [settings])

  const updateContactMethod = (index, patch) => {
    setDraft((current) => ({
      ...current,
      contactMethods: current.contactMethods.map((method, methodIndex) =>
        methodIndex === index ? { ...method, ...patch } : method,
      ),
    }))
  }

  const submit = async (event) => {
    event.preventDefault()
    const adminUsers = adminUsersDraft.map((user) => ({
      id: user.id,
      username: user.username.trim(),
      ...(user.passwordDraft ? { password: user.passwordDraft } : {}),
    }))

    if (!adminUsers.length || adminUsers.some((user) => !user.username)) {
      alert('至少需要保留一位有帳號名稱的管理員。')
      return
    }
    if (adminUsersDraft.some((user) => user.isNew && user.passwordDraft.length < 12)) {
      alert('新管理員密碼至少需要 12 個字元。')
      return
    }

    setSaving(true)
    setSaveError('')
    try {
      await saveAdminSettings(draft, adminUsers, adminToken)
      setSettings({ ...draft, adminUsers })
      setSaved(true)
      setTimeout(() => setSaved(false), 1800)
    } catch (caught) {
      setSaveError(caught.message || '設定儲存失敗。')
    } finally {
      setSaving(false)
    }
  }

  const addAdminUser = () => {
    setAdminUsersDraft((current) => [
      ...current,
      { id: crypto.randomUUID(), username: '', passwordDraft: '', isNew: true },
    ])
  }

  const updateAdminUser = (id, patch) => {
    setAdminUsersDraft((current) => current.map((user) => (user.id === id ? { ...user, ...patch } : user)))
  }

  const removeAdminUser = (id) => {
    setAdminUsersDraft((current) => {
      if (current.length <= 1) {
        alert('至少需要保留一位管理員。')
        return current
      }
      return current.filter((user) => user.id !== id)
    })
  }

  return (
    <main className="mx-auto max-w-4xl px-3 py-4 sm:px-5">
      <form onSubmit={submit} className="space-y-5 border-y border-zinc-800 py-4">
        <div>
          <div className="flex items-center gap-2"><Settings2 size={17} className="text-zinc-400" /><h1 className="text-xl font-black">設定</h1></div>
          <p className="mt-1 text-sm text-zinc-400">這裡設定三個聯絡方式。買家點擊聯絡購買後，會先選擇想用哪個平台聯絡。</p>
        </div>
        <label className="block">
          <span className="mb-1 block text-sm font-bold text-zinc-300">網站名稱</span>
          <input className="h-11 w-full rounded-md border border-zinc-700 bg-zinc-900 px-3" value={draft.siteName} onChange={(event) => setDraft({ ...draft, siteName: event.target.value })} />
        </label>
        <div className="space-y-3">
          <h2 className="text-sm font-bold text-zinc-300">聯絡方式</h2>
          {draft.contactMethods.map((method, index) => (
            <div key={method.id} className="grid gap-2 border-t border-zinc-800 pt-3 sm:grid-cols-[9rem_1fr]">
              <label className="block">
                <span className="mb-1 block text-xs font-bold text-zinc-400">名稱</span>
                <input
                  className="h-10 w-full rounded-md border border-zinc-700 bg-zinc-950 px-3"
                  value={method.label}
                  onChange={(event) => updateContactMethod(index, { label: event.target.value })}
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-bold text-zinc-400">網址</span>
                <input
                  className="h-10 w-full rounded-md border border-zinc-700 bg-zinc-950 px-3"
                  value={method.url}
                  onChange={(event) => updateContactMethod(index, { url: event.target.value })}
                  placeholder="https://line.me/... 或 https://facebook.com/..."
                />
              </label>
            </div>
          ))}
        </div>
        <div className="space-y-3 border-t border-zinc-800 pt-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-bold text-zinc-300">管理員帳號</h2>
            <button type="button" onClick={addAdminUser} className="inline-flex h-9 items-center gap-2 rounded bg-zinc-100 px-3 text-sm font-black text-zinc-950">
              <Plus size={16} />新增管理員
            </button>
          </div>
          <div className="space-y-3">
            {adminUsersDraft.map((user, index) => (
              <div key={user.id} className="grid gap-2 border-t border-zinc-800 pt-3 sm:grid-cols-[1fr_1fr_auto]">
                <label className="block">
                  <span className="mb-1 block text-xs font-bold text-zinc-400">帳號</span>
                  <input
                    className="h-10 w-full rounded-md border border-zinc-700 bg-zinc-900 px-3"
                    value={user.username}
                    onChange={(event) => updateAdminUser(user.id, { username: event.target.value })}
                    autoComplete={index === 0 ? 'username' : 'off'}
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-bold text-zinc-400">新密碼</span>
                  <input
                    className="h-10 w-full rounded-md border border-zinc-700 bg-zinc-900 px-3"
                    type="password"
                    value={user.passwordDraft}
                    onChange={(event) => updateAdminUser(user.id, { passwordDraft: event.target.value })}
                    placeholder={user.isNew ? '至少 12 個字元' : '留空代表不變更'}
                    autoComplete="new-password"
                  />
                </label>
                <IconButton label={`刪除管理員 ${user.username || index + 1}`} onClick={() => removeAdminUser(user.id)} className="self-end border border-zinc-700 text-zinc-400 hover:border-zinc-400 hover:text-white"><Trash2 size={16} /></IconButton>
              </div>
            ))}
          </div>
        </div>
        <button type="submit" disabled={saving} className="inline-flex h-10 items-center gap-2 rounded bg-zinc-100 px-4 font-black text-zinc-950 disabled:opacity-60">
          <Check size={16} />{saving ? '儲存中' : '儲存設定'}
        </button>
        {saved && <p className="text-sm text-zinc-300">已儲存設定。</p>}
        {saveError && <p className="text-sm text-zinc-400">{saveError}</p>}
      </form>
    </main>
  )
}

function StoredImage({ imageKey, imageUrl, alt, className, style }) {
  const [src, setSrc] = useState('')

  useEffect(() => {
    if (imageUrl) {
      setSrc(imageUrl)
      return
    }
    setSrc(imageKey ? `./api/images/${encodeURIComponent(imageKey)}` : '')
  }, [imageKey, imageUrl])

  if (!src) return <div className={`${className} grid place-items-center text-xs text-zinc-600`} style={style}>無圖片</div>
  return <img src={src} alt={alt} className={className} style={style} loading="lazy" />
}

function ImagePreview({ imageKey, imageUrl, alt, onClose }) {
  const [zoom, setZoom] = useState('fit')

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 bg-black/95">
      <div className="fixed left-0 right-0 top-0 z-10 flex items-center justify-end gap-2 border-b border-zinc-800 bg-black/95 p-3">
        {[
          ['fit', '完整'],
          [100, '100%'],
          [150, '150%'],
          [200, '200%'],
        ].map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setZoom(value)}
            className={`rounded px-3 py-2 text-sm font-bold ${
              zoom === value ? 'bg-zinc-100 text-zinc-950' : 'bg-zinc-800 text-zinc-100'
            }`}
          >
            {label}
          </button>
        ))}
        <IconButton label="關閉預覽" onClick={onClose} className="bg-zinc-100 text-zinc-950 hover:bg-white"><X size={17} /></IconButton>
      </div>
      <div className="h-dvh overflow-auto px-3 pb-8 pt-20">
        <div className="mx-auto flex min-h-[calc(100dvh-7rem)] min-w-full items-center justify-center">
          <StoredImage
            imageKey={imageKey}
            imageUrl={imageUrl}
            alt={alt}
            className="block rounded-sm object-contain"
            style={
              zoom === 'fit'
                ? {
                    maxWidth: 'calc(100vw - 1.5rem)',
                    maxHeight: 'calc(100dvh - 7rem)',
                    width: 'auto',
                    height: 'auto',
                  }
                : {
                    width: `calc(${zoom}vw - 2rem)`,
                    maxWidth: 'none',
                    height: 'auto',
                  }
            }
          />
        </div>
      </div>
    </div>
  )
}

function StatusChip({ status }) {
  const meta = STATUSES[status] || STATUSES.draft
  return <span className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-black ${meta.chip}`}>{meta.label}</span>
}

function ContactButton({ product, settings, compact = false }) {
  const [open, setOpen] = useState(false)
  const methods = getContactMethods(settings)
  const disabled = !methods.some((method) => method.url)
  const label = '聯絡購買'

  if (disabled) return <button type="button" disabled className={`${compact ? 'h-8 text-xs' : 'h-10 text-sm'} w-full rounded border border-zinc-800 bg-zinc-900 font-black text-zinc-600`}>{label}</button>
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`${compact ? 'h-8 text-xs' : 'h-10 text-sm'} flex w-full items-center justify-center gap-2 rounded bg-zinc-100 font-black text-zinc-950 transition hover:bg-white`}
      >
        <ExternalLink size={compact ? 13 : 16} />{label}
      </button>
      {open && <ContactModal product={product} methods={methods} onClose={() => setOpen(false)} />}
    </>
  )
}

function ContactModal({ product, methods, onClose }) {
  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/80 p-4" role="presentation" onMouseDown={onClose}>
      <div className="w-full max-w-sm border border-zinc-700 bg-zinc-950 p-4 shadow-[0_18px_50px_rgba(0,0,0,0.42)]" role="dialog" aria-modal="true" aria-labelledby="contact-modal-title" onMouseDown={(event) => event.stopPropagation()}>
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-bold text-zinc-500">聯絡購買</p>
            <h2 id="contact-modal-title" className="mt-1 text-xl font-black text-zinc-100">{product.code}</h2>
          </div>
          <IconButton label="關閉聯絡視窗" onClick={onClose}><X size={17} /></IconButton>
        </div>
        <div className="space-y-2">
          {methods.map((method) =>
            method.url ? (
              <a
                key={method.id}
                href={buildContactUrl(method.url, product.code)}
                target="_blank"
                rel="noreferrer"
                className="flex h-12 items-center justify-between rounded border border-zinc-700 bg-zinc-900 px-3 font-black text-zinc-100 transition hover:border-zinc-300 hover:bg-zinc-800"
              >
                <span>{method.label || '聯絡方式'}</span>
                <ExternalLink size={16} className="text-zinc-500" />
              </a>
            ) : (
              <button
                key={method.id}
                type="button"
                disabled
                className="flex h-12 w-full items-center justify-between rounded border border-zinc-800 bg-zinc-900/50 px-3 font-black text-zinc-600"
              >
                <span>{method.label || '聯絡方式'}</span>
                <span className="text-sm">未設定</span>
              </button>
            ),
          )}
        </div>
      </div>
    </div>
  )
}

function IconButton({ label, onClick, children, className = '', disabled = false }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-busy={disabled}
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex h-9 w-9 items-center justify-center rounded transition hover:bg-zinc-800 disabled:opacity-40 ${className}`}
    >
      {children}
    </button>
  )
}

function uploadStatusLabel(status) {
  return {
    registering: '建立草稿中',
    queued: '等待上傳',
    uploading: '上傳中',
    recognizing: '辨識價格',
    ready: '已完成',
    failed: '上傳失敗',
    cancelled: '已取消',
  }[status] || '處理中'
}

async function ensureVisualHashCoverage(products, token, onProgress) {
  const catalog = await listVisualHashes(token)
  const hashesByKey = new Map((catalog.images || []).map((image) => [image.imageKey, image.visualHash]))
  const missing = products.filter((product) => product.imageKey && !hashesByKey.get(product.imageKey))
  if (!missing.length) return

  let completed = 0
  const generated = await mapWithConcurrency(missing, 4, async (product) => {
    const response = await fetch(product.imageUrl || `/api/images/${encodeURIComponent(product.imageKey)}`, { cache: 'force-cache' })
    if (!response.ok) throw new Error(`無法讀取 ${product.code} 的圖片。`)
    const visualHash = await createVisualHash(await response.blob())
    completed += 1
    onProgress?.(completed, missing.length)
    return { imageKey: product.imageKey, visualHash }
  })
  for (let index = 0; index < generated.length; index += 100) {
    await saveVisualHashes(generated.slice(index, index + 100), token)
  }
}

async function mapWithConcurrency(items, concurrency, task) {
  const results = new Array(items.length)
  let cursor = 0
  async function worker() {
    while (cursor < items.length) {
      const index = cursor
      cursor += 1
      results[index] = await task(items[index], index)
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()))
  return results
}

function getContactMethods(settings) {
  if (Array.isArray(settings.contactMethods)) {
    return settings.contactMethods
  }

  return defaultSettings.contactMethods.map((method, index) => ({
    ...method,
    url: index === 0 ? settings.defaultContactUrl || '' : '',
  }))
}

function hasContactMethods(settings) {
  return getContactMethods(settings).some((method) => method.url)
}

function getAdminUsers(settings) {
  if (Array.isArray(settings.adminUsers) && settings.adminUsers.length) {
    return settings.adminUsers
  }

  if (settings.adminUsername && settings.adminPassword) {
    return [{ id: 'admin-1', username: settings.adminUsername, password: settings.adminPassword }]
  }

  return []
}

function buildContactUrl(url, code) {
  if (!url) return ''
  try {
    const parsed = new URL(url)
    parsed.searchParams.set('text', `你好，我想詢問商品 ${code}`)
    return parsed.toString()
  } catch {
    return url
  }
}

function formatPrice(price) {
  const value = Number(price || 0)
  return value > 0 ? `NT$${currency.format(value)}` : ''
}

function readHomeState() {
  const fallback = { query: '', minPrice: '', maxPrice: '', sort: 'default', page: 1, scrollY: 0, lastProductId: '' }
  try {
    return { ...fallback, ...JSON.parse(sessionStorage.getItem(HOME_STATE_KEY) || '{}') }
  } catch {
    return fallback
  }
}

function saveHomeState(patch) {
  sessionStorage.setItem(HOME_STATE_KEY, JSON.stringify({ ...readHomeState(), ...patch }))
}

function EmptyState({ title, text }) {
  return (
    <section className="border border-dashed border-zinc-700 bg-zinc-950 p-8 text-center">
      <h2 className="text-xl font-black text-zinc-100">{title}</h2>
      <p className="mt-2 text-sm text-zinc-400">{text}</p>
    </section>
  )
}
