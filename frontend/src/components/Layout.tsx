import { Outlet, Link, useLocation } from 'react-router'
import { useState, useEffect, useRef } from 'react'
import Footer from './Footer'
import { FF_PLAYER_RANKINGS, FF_FEATURE_STORE, FF_PROJECTIONS, FF_NAV_REORG } from '../config/featureFlags'

const Layout = () => {
  const location = useLocation()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [darkMode, setDarkMode] = useState(() => {
    return localStorage.getItem('theme') === 'dark'
  })

  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add('dark')
      localStorage.setItem('theme', 'dark')
    } else {
      document.documentElement.classList.remove('dark')
      localStorage.setItem('theme', 'light')
    }
  }, [darkMode])

  const navItems = [
    { path: '/', label: 'Dashboard', icon: '📊' },
    { path: '/teams', label: 'Teams', icon: '👥' },
    { path: '/rankings', label: 'Rankings', icon: '🏆' },
    { path: '/shots', label: 'Shots', icon: '🎯' },
    { path: '/analytics', label: 'Analytics', icon: '📈' },
    { path: '/estimator', label: 'Estimator', icon: '🔮' },
    { path: '/players', label: 'Players', icon: '⛹️' },
    { path: '/injuries', label: 'Injuries', icon: '🩺' },
    { path: '/trade', label: 'Trade', icon: '🔄' },
    { path: '/nba-teams', label: 'NBA', icon: '🏀' },
    ...(FF_FEATURE_STORE ? [{ path: '/feature-store', label: 'Feature Store', icon: '🗄️' }] : []),
    ...(FF_PLAYER_RANKINGS ? [{ path: '/player-rankings', label: 'Player Rankings', icon: '📋' }] : []),
    ...(FF_PROJECTIONS ? [{ path: '/projections', label: 'Projections', icon: '🔭' }] : []),
  ]

  const closeMobileMenu = () => setMobileMenuOpen(false)

  if (FF_NAV_REORG) {
    return <ReorgLayout darkMode={darkMode} setDarkMode={setDarkMode} />
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-blue-50 dark:from-gray-900 dark:to-gray-800 flex flex-col">
      <nav className="sticky top-0 z-40 bg-white dark:bg-gray-900 shadow-lg border-b border-gray-200 dark:border-gray-700">
        <div className="w-full px-3">
          <div className="flex items-center justify-between h-14 gap-2">
            <h1 className="text-sm font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent whitespace-nowrap shrink-0">
              🏀 Fantasy League
            </h1>

            {/* Desktop Navigation */}
            <div className="hidden md:flex items-center gap-0.5 overflow-x-auto">
              {navItems.map((item) => (
                <Link
                  key={item.path}
                  to={item.path}
                  className={`inline-flex items-center gap-1 px-2 py-1.5 rounded-md text-xs font-medium whitespace-nowrap transition-all duration-200 ${
                    location.pathname === item.path
                      ? 'bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 shadow-sm'
                      : 'text-gray-600 dark:text-gray-300 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-blue-50 dark:hover:bg-gray-800'
                  }`}
                  title={item.label}
                >
                  <span className="text-xl xl:text-sm">{item.icon}</span>
                  <span className="hidden xl:inline">{item.label}</span>
                </Link>
              ))}
              <div className="mx-3 h-6 w-0.5 bg-gray-300 dark:bg-gray-500 shrink-0 rounded-full" />
              <button
                onClick={() => setDarkMode(d => !d)}
                className="p-1.5 rounded-md text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors shrink-0"
                aria-label="Toggle dark mode"
                title={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
              >
                <span className="text-sm">{darkMode ? '☀️' : '🌙'}</span>
              </button>
            </div>

            {/* Mobile: dark toggle + hamburger */}
            <div className="md:hidden flex items-center gap-1">
              <button
                onClick={() => setDarkMode(d => !d)}
                className="p-2 rounded-md text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                aria-label="Toggle dark mode"
              >
                <span className="text-base">{darkMode ? '☀️' : '🌙'}</span>
              </button>
              <button
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                className="inline-flex items-center justify-center p-2 rounded-md text-gray-600 dark:text-gray-300 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-blue-500 transition-all"
                aria-expanded={mobileMenuOpen}
                aria-label="Toggle navigation menu"
              >
                <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
                  {mobileMenuOpen ? (
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  ) : (
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
                  )}
                </svg>
              </button>
            </div>
          </div>

          {/* Mobile Navigation Menu */}
          {mobileMenuOpen && (
            <div className="md:hidden pb-4">
              <div className="flex flex-col space-y-1">
                {navItems.map((item) => (
                  <Link
                    key={item.path}
                    to={item.path}
                    onClick={closeMobileMenu}
                    className={`inline-flex items-center px-4 py-3 rounded-md text-base font-medium transition-all duration-200 ${
                      location.pathname === item.path
                        ? 'bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 shadow-sm'
                        : 'text-gray-600 dark:text-gray-300 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-blue-50 dark:hover:bg-gray-800'
                    }`}
                  >
                    <span className="mr-3 text-xl">{item.icon}</span>
                    {item.label}
                  </Link>
                ))}
              </div>
            </div>
          )}
        </div>
      </nav>

      <main className="py-8 flex-1">
        <Outlet />
      </main>

      <Footer />
    </div>
  )
}

interface ReorgLayoutProps {
  darkMode: boolean
  setDarkMode: React.Dispatch<React.SetStateAction<boolean>>
}

interface NavLeaf {
  path: string
  label: string
  icon: string
}

const ReorgLayout = ({ darkMode, setDarkMode }: ReorgLayoutProps) => {
  const location = useLocation()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [mobileToolsOpen, setMobileToolsOpen] = useState(false)
  const [toolsOpen, setToolsOpen] = useState(false)
  const toolsRef = useRef<HTMLDivElement>(null)
  const toolsButtonRef = useRef<HTMLButtonElement>(null)
  const toolsMenuRef = useRef<HTMLDivElement>(null)
  const [toolsMenuPos, setToolsMenuPos] = useState<{ top: number; right: number } | null>(null)

  const toolsItems: NavLeaf[] = [
    ...(FF_PROJECTIONS ? [{ path: '/projections', label: 'Projections', icon: '🔭' }] : []),
    { path: '/estimator', label: 'Estimator', icon: '🔮' },
    { path: '/trade', label: 'Trade', icon: '🔄' },
    ...(FF_FEATURE_STORE ? [{ path: '/feature-store', label: 'Feature Store', icon: '🗄️' }] : []),
  ]

  const isToolsActive = toolsItems.some((item) => item.path === location.pathname)

  const closeMobileMenu = () => {
    setMobileMenuOpen(false)
    setMobileToolsOpen(false)
  }

  useEffect(() => {
    if (!toolsOpen) return
    const handleClickOutside = (e: MouseEvent) => {
      if (
        toolsRef.current &&
        !toolsRef.current.contains(e.target as Node) &&
        !toolsMenuRef.current?.contains(e.target as Node)
      ) {
        setToolsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [toolsOpen])

  useEffect(() => {
    if (!toolsOpen) return
    const updatePos = () => {
      const rect = toolsButtonRef.current?.getBoundingClientRect()
      if (rect) {
        setToolsMenuPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right })
      }
    }
    updatePos()
    window.addEventListener('resize', updatePos)
    window.addEventListener('scroll', updatePos, true)
    return () => {
      window.removeEventListener('resize', updatePos)
      window.removeEventListener('scroll', updatePos, true)
    }
  }, [toolsOpen])

  const handleToolsKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === 'Escape') {
      setToolsOpen(false)
      toolsButtonRef.current?.focus()
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setToolsOpen(true)
      requestAnimationFrame(() => {
        const firstLink = toolsMenuRef.current?.querySelector('a')
        ;(firstLink as HTMLAnchorElement | null)?.focus()
      })
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      setToolsOpen((o) => !o)
    }
  }

  const handleToolsMenuKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      setToolsOpen(false)
      toolsButtonRef.current?.focus()
    }
  }

  const desktopItemClass = (active: boolean) =>
    `inline-flex items-center gap-1 px-2 py-1.5 rounded-md text-xs font-medium whitespace-nowrap transition-all duration-200 ${
      active
        ? 'bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 shadow-sm'
        : 'text-gray-600 dark:text-gray-300 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-blue-50 dark:hover:bg-gray-800'
    }`

  const mobileItemClass = (active: boolean) =>
    `inline-flex items-center px-4 py-3 rounded-md text-base font-medium transition-all duration-200 ${
      active
        ? 'bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 shadow-sm'
        : 'text-gray-600 dark:text-gray-300 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-blue-50 dark:hover:bg-gray-800'
    }`

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-blue-50 dark:from-gray-900 dark:to-gray-800 flex flex-col">
      <nav className="sticky top-0 z-40 bg-white dark:bg-gray-900 shadow-lg border-b border-gray-200 dark:border-gray-700">
        <div className="w-full px-3">
          <div className="flex items-center justify-between h-14 gap-2">
            <Link
              to="/"
              className="text-sm font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent whitespace-nowrap shrink-0"
            >
              🏀 Fantasy League
            </Link>

            {/* Desktop Navigation */}
            <div className="hidden md:flex items-center gap-0.5 overflow-x-auto">
              <Link to="/teams" className={desktopItemClass(location.pathname === '/teams')} title="Teams">
                <span className="text-xl xl:text-sm">👥</span>
                <span className="hidden xl:inline">Teams</span>
              </Link>
              <Link to="/rankings" className={desktopItemClass(location.pathname === '/rankings')} title="League Rankings">
                <span className="text-xl xl:text-sm">🏆</span>
                <span className="hidden xl:inline">League Rankings</span>
              </Link>
              {FF_PLAYER_RANKINGS && (
                <Link
                  to="/player-rankings"
                  className={desktopItemClass(location.pathname === '/player-rankings')}
                  title="Player Rankings"
                >
                  <span className="text-xl xl:text-sm">📋</span>
                  <span className="hidden xl:inline">Player Rankings</span>
                </Link>
              )}
              <Link to="/analytics" className={desktopItemClass(location.pathname === '/analytics')} title="Analytics">
                <span className="text-xl xl:text-sm">📈</span>
                <span className="hidden xl:inline">Analytics</span>
              </Link>
              <Link to="/players" className={desktopItemClass(location.pathname === '/players')} title="Players">
                <span className="text-xl xl:text-sm">⛹️</span>
                <span className="hidden xl:inline">Players</span>
              </Link>

              <div
                ref={toolsRef}
                className="relative"
                onMouseEnter={() => setToolsOpen(true)}
                onMouseLeave={() => setToolsOpen(false)}
              >
                <button
                  ref={toolsButtonRef}
                  type="button"
                  aria-haspopup="menu"
                  aria-expanded={toolsOpen}
                  onClick={() => setToolsOpen((o) => !o)}
                  onKeyDown={handleToolsKeyDown}
                  className={desktopItemClass(isToolsActive)}
                  title="Tools"
                >
                  <span className="text-xl xl:text-sm">🛠️</span>
                  <span className="hidden xl:inline">Tools</span>
                  <span className="hidden xl:inline text-[10px]">▾</span>
                </button>
                {toolsOpen && toolsMenuPos && (
                  <div
                    ref={toolsMenuRef}
                    role="menu"
                    onKeyDown={handleToolsMenuKeyDown}
                    onMouseEnter={() => setToolsOpen(true)}
                    onMouseLeave={() => setToolsOpen(false)}
                    style={{ position: 'fixed', top: toolsMenuPos.top, right: toolsMenuPos.right }}
                    className="min-w-[10rem] bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-md shadow-lg py-1 z-50"
                  >
                    {toolsItems.map((item) => (
                      <Link
                        key={item.path}
                        role="menuitem"
                        to={item.path}
                        onClick={() => setToolsOpen(false)}
                        className={`flex items-center gap-2 px-3 py-2 text-xs font-medium whitespace-nowrap transition-colors duration-200 ${
                          location.pathname === item.path
                            ? 'bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300'
                            : 'text-gray-600 dark:text-gray-300 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-blue-50 dark:hover:bg-gray-800'
                        }`}
                      >
                        <span className="text-sm">{item.icon}</span>
                        <span>{item.label}</span>
                      </Link>
                    ))}
                  </div>
                )}
              </div>

              <Link to="/injuries" className={desktopItemClass(location.pathname === '/injuries')} title="Injuries">
                <span className="text-xl xl:text-sm">🩺</span>
                <span className="hidden xl:inline">Injuries</span>
              </Link>
              <Link to="/nba-teams" className={desktopItemClass(location.pathname === '/nba-teams')} title="NBA">
                <span className="text-xl xl:text-sm">🏀</span>
                <span className="hidden xl:inline">NBA</span>
              </Link>

              <div className="mx-3 h-6 w-0.5 bg-gray-300 dark:bg-gray-500 shrink-0 rounded-full" />
              <button
                onClick={() => setDarkMode(d => !d)}
                className="p-1.5 rounded-md text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors shrink-0"
                aria-label="Toggle dark mode"
                title={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
              >
                <span className="text-sm">{darkMode ? '☀️' : '🌙'}</span>
              </button>
            </div>

            {/* Mobile: dark toggle + hamburger */}
            <div className="md:hidden flex items-center gap-1">
              <button
                onClick={() => setDarkMode(d => !d)}
                className="p-2 rounded-md text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                aria-label="Toggle dark mode"
              >
                <span className="text-base">{darkMode ? '☀️' : '🌙'}</span>
              </button>
              <button
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                className="inline-flex items-center justify-center p-2 rounded-md text-gray-600 dark:text-gray-300 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-blue-500 transition-all"
                aria-expanded={mobileMenuOpen}
                aria-label="Toggle navigation menu"
              >
                <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
                  {mobileMenuOpen ? (
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  ) : (
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
                  )}
                </svg>
              </button>
            </div>
          </div>

          {/* Mobile Navigation Menu */}
          {mobileMenuOpen && (
            <div className="md:hidden pb-4">
              <div className="flex flex-col space-y-1">
                <Link to="/teams" onClick={closeMobileMenu} className={mobileItemClass(location.pathname === '/teams')}>
                  <span className="mr-3 text-xl">👥</span>
                  Teams
                </Link>
                <Link to="/rankings" onClick={closeMobileMenu} className={mobileItemClass(location.pathname === '/rankings')}>
                  <span className="mr-3 text-xl">🏆</span>
                  League Rankings
                </Link>
                {FF_PLAYER_RANKINGS && (
                  <Link
                    to="/player-rankings"
                    onClick={closeMobileMenu}
                    className={mobileItemClass(location.pathname === '/player-rankings')}
                  >
                    <span className="mr-3 text-xl">📋</span>
                    Player Rankings
                  </Link>
                )}
                <Link to="/analytics" onClick={closeMobileMenu} className={mobileItemClass(location.pathname === '/analytics')}>
                  <span className="mr-3 text-xl">📈</span>
                  Analytics
                </Link>
                <Link to="/players" onClick={closeMobileMenu} className={mobileItemClass(location.pathname === '/players')}>
                  <span className="mr-3 text-xl">⛹️</span>
                  Players
                </Link>

                <button
                  type="button"
                  onClick={() => setMobileToolsOpen((o) => !o)}
                  aria-expanded={mobileToolsOpen}
                  className={mobileItemClass(isToolsActive) + ' justify-between w-full'}
                >
                  <span className="flex items-center">
                    <span className="mr-3 text-xl">🛠️</span>
                    Tools
                  </span>
                  <span className={`text-sm transition-transform duration-200 ${mobileToolsOpen ? 'rotate-180' : ''}`}>▾</span>
                </button>
                {mobileToolsOpen && (
                  <div className="flex flex-col space-y-1 pl-6">
                    {toolsItems.map((item) => (
                      <Link
                        key={item.path}
                        to={item.path}
                        onClick={closeMobileMenu}
                        className={mobileItemClass(location.pathname === item.path)}
                      >
                        <span className="mr-3 text-xl">{item.icon}</span>
                        {item.label}
                      </Link>
                    ))}
                  </div>
                )}

                <Link to="/injuries" onClick={closeMobileMenu} className={mobileItemClass(location.pathname === '/injuries')}>
                  <span className="mr-3 text-xl">🩺</span>
                  Injuries
                </Link>
                <Link to="/nba-teams" onClick={closeMobileMenu} className={mobileItemClass(location.pathname === '/nba-teams')}>
                  <span className="mr-3 text-xl">🏀</span>
                  NBA
                </Link>
              </div>
            </div>
          )}
        </div>
      </nav>

      <main className="py-8 flex-1">
        <Outlet />
      </main>

      <Footer />
    </div>
  )
}

export default Layout
