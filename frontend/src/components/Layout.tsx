import { Outlet, Link, useLocation } from 'react-router'
import { useState, useEffect, useRef } from 'react'
import Footer from './Footer'
import { FF_PLAYER_RANKINGS, FF_FEATURE_STORE, FF_PROJECTIONS, FF_NAV_REORG, FF_DRAFT_REPORT, FF_TRENDS, FF_MINIGAMES } from '../config/featureFlags'

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
    ...(FF_MINIGAMES ? [{ path: '/minigames', label: 'Minigames', icon: '🎮' }] : []),
    ...(FF_FEATURE_STORE ? [{ path: '/feature-store', label: 'Feature Store', icon: '🗄️' }] : []),
    ...(FF_PLAYER_RANKINGS ? [{ path: '/player-rankings', label: 'Player Rankings', icon: '📋' }] : []),
    ...(FF_PROJECTIONS ? [{ path: '/projections', label: 'Projections', icon: '🔭' }] : []),
    ...(FF_DRAFT_REPORT ? [{ path: '/draft-report', label: 'Draft Report', icon: '📝' }] : []),
    ...(FF_TRENDS ? [{ path: '/trends', label: 'Trends', icon: '📈' }] : []),
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

interface NavGroupDef {
  key: string
  label: string
  icon: string
  items: NavLeaf[]
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

interface DesktopNavGroupProps {
  group: NavGroupDef
  openKey: string | null
  setOpenKey: (key: string | null) => void
  isActive: boolean
}

const DesktopNavGroup = ({ group, openKey, setOpenKey, isActive }: DesktopNavGroupProps) => {
  const location = useLocation()
  const groupRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [menuPos, setMenuPos] = useState<{ top: number; right: number } | null>(null)
  const isOpen = openKey === group.key

  useEffect(() => {
    if (!isOpen) return
    const handleClickOutside = (e: MouseEvent) => {
      if (
        groupRef.current &&
        !groupRef.current.contains(e.target as Node) &&
        !menuRef.current?.contains(e.target as Node)
      ) {
        setOpenKey(null)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isOpen, setOpenKey])

  useEffect(() => {
    if (!isOpen) return
    const updatePos = () => {
      const rect = buttonRef.current?.getBoundingClientRect()
      if (rect) {
        setMenuPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right })
      }
    }
    updatePos()
    window.addEventListener('resize', updatePos)
    window.addEventListener('scroll', updatePos, true)
    return () => {
      window.removeEventListener('resize', updatePos)
      window.removeEventListener('scroll', updatePos, true)
    }
  }, [isOpen])

  const handleButtonKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === 'Escape') {
      setOpenKey(null)
      buttonRef.current?.focus()
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setOpenKey(group.key)
      requestAnimationFrame(() => {
        const firstLink = menuRef.current?.querySelector('a')
        ;(firstLink as HTMLAnchorElement | null)?.focus()
      })
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      setOpenKey(isOpen ? null : group.key)
    }
  }

  const handleMenuKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      setOpenKey(null)
      buttonRef.current?.focus()
    }
  }

  return (
    <div
      ref={groupRef}
      className="relative"
      onMouseEnter={() => setOpenKey(group.key)}
      onMouseLeave={() => setOpenKey(null)}
    >
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        onClick={() => setOpenKey(isOpen ? null : group.key)}
        onKeyDown={handleButtonKeyDown}
        className={desktopItemClass(isActive)}
        title={group.label}
      >
        <span className="text-sm">{group.icon}</span>
        <span>{group.label}</span>
        <span className="text-[10px]">▾</span>
      </button>
      {isOpen && menuPos && (
        <div
          ref={menuRef}
          role="menu"
          onKeyDown={handleMenuKeyDown}
          onMouseEnter={() => setOpenKey(group.key)}
          onMouseLeave={() => setOpenKey(null)}
          style={{ position: 'fixed', top: menuPos.top, right: menuPos.right }}
          className="min-w-[11rem] bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-md shadow-lg py-1 z-50"
        >
          {group.items.map((item) => (
            <Link
              key={item.path}
              role="menuitem"
              to={item.path}
              onClick={() => setOpenKey(null)}
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
  )
}

interface MobileNavGroupProps {
  group: NavGroupDef
  openKey: string | null
  setOpenKey: (key: string | null) => void
  isActive: boolean
  onNavigate: () => void
}

const MobileNavGroup = ({ group, openKey, setOpenKey, isActive, onNavigate }: MobileNavGroupProps) => {
  const location = useLocation()
  const isOpen = openKey === group.key

  return (
    <>
      <button
        type="button"
        onClick={() => setOpenKey(isOpen ? null : group.key)}
        aria-expanded={isOpen}
        className={mobileItemClass(isActive) + ' justify-between w-full'}
      >
        <span className="flex items-center">
          <span className="mr-3 text-xl">{group.icon}</span>
          {group.label}
        </span>
        <span className={`text-sm transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}>▾</span>
      </button>
      {isOpen && (
        <div className="flex flex-col space-y-1 pl-6">
          {group.items.map((item) => (
            <Link
              key={item.path}
              to={item.path}
              onClick={onNavigate}
              className={mobileItemClass(location.pathname === item.path)}
            >
              <span className="mr-3 text-xl">{item.icon}</span>
              {item.label}
            </Link>
          ))}
        </div>
      )}
    </>
  )
}

const ReorgLayout = ({ darkMode, setDarkMode }: ReorgLayoutProps) => {
  const location = useLocation()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [openGroup, setOpenGroup] = useState<string | null>(null)
  const [mobileOpenGroup, setMobileOpenGroup] = useState<string | null>(null)

  const navGroups: NavGroupDef[] = [
    {
      key: 'league',
      label: 'League',
      icon: '👥',
      items: [
        { path: '/rankings', label: 'League Rankings', icon: '🏆' },
        { path: '/teams', label: 'Teams', icon: '👥' },
        ...(FF_DRAFT_REPORT ? [{ path: '/draft-report', label: 'Draft Report', icon: '📝' }] : []),
      ],
    },
    {
      key: 'players',
      label: 'Players',
      icon: '⛹️',
      items: [
        { path: '/players', label: 'Players', icon: '⛹️' },
        ...(FF_PLAYER_RANKINGS ? [{ path: '/player-rankings', label: 'Player Rankings', icon: '📋' }] : []),
      ],
    },
    {
      key: 'insights',
      label: 'Insights',
      icon: '📈',
      items: [
        { path: '/analytics', label: 'League Analytics', icon: '📈' },
        ...(FF_TRENDS ? [{ path: '/trends', label: 'Player Trends', icon: '📉' }] : []),
        ...(FF_PROJECTIONS ? [{ path: '/projections', label: 'Projections', icon: '🔭' }] : []),
        { path: '/estimator', label: 'Standings Estimator', icon: '🔮' },
        ...(FF_FEATURE_STORE ? [{ path: '/feature-store', label: 'Feature Store', icon: '🗄️' }] : []),
      ],
    },
    {
      key: 'tools',
      label: 'Tools',
      icon: '🛠️',
      items: [
        { path: '/trade', label: 'Trade Analyzer', icon: '🔄' },
      ],
    },
    ...(FF_MINIGAMES
      ? [
          {
            key: 'minigames',
            label: 'Minigames',
            icon: '🎮',
            items: [
              { path: '/minigames', label: 'All Games', icon: '🎮' },
              { path: '/minigames/hangman', label: 'Hangman', icon: '🔤' },
              { path: '/minigames/who-he-play-for', label: 'Who He Play For?', icon: '🏟️' },
              { path: '/minigames/who-am-i', label: 'Who Am I?', icon: '🕵️' },
              { path: '/minigames/now-you-see-me', label: 'Now You See Me', icon: '👁️' },
            ],
          },
        ]
      : []),
    {
      key: 'nba',
      label: 'NBA',
      icon: '🏀',
      items: [
        { path: '/nba-teams', label: 'NBA Depth Charts', icon: '🏀' },
        { path: '/injuries', label: 'Injuries', icon: '🩺' },
      ],
    },
  ]

  const closeMobileMenu = () => {
    setMobileMenuOpen(false)
    setMobileOpenGroup(null)
  }

  const isGroupActive = (group: NavGroupDef) => group.items.some((item) => item.path === location.pathname)

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
              {navGroups.map((group) => (
                <DesktopNavGroup
                  key={group.key}
                  group={group}
                  openKey={openGroup}
                  setOpenKey={setOpenGroup}
                  isActive={isGroupActive(group)}
                />
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
                {navGroups.map((group) => (
                  <MobileNavGroup
                    key={group.key}
                    group={group}
                    openKey={mobileOpenGroup}
                    setOpenKey={setMobileOpenGroup}
                    isActive={isGroupActive(group)}
                    onNavigate={closeMobileMenu}
                  />
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

export default Layout
