import { Outlet, Link, useLocation } from 'react-router'
import { useState, useEffect, useRef, Fragment } from 'react'
import Footer from './Footer'
import CommandPalette from './CommandPalette'
import { FF_PLAYER_RANKINGS, FF_FEATURE_STORE, FF_PROJECTIONS, FF_NAV_REORG, FF_DRAFT_REPORT, FF_DRAFT_PAGES, FF_TRENDS, FF_MINIGAMES, FF_GLOBAL_SEARCH, FF_SCHEDULE } from '../config/featureFlags'

const prefetchMap: Record<string, () => Promise<unknown>> = {
  '/trends': () => import('../pages/Trends'),
  '/projections': () => import('../pages/Projections'),
  '/feature-store': () => import('../pages/FeatureStore'),
  '/analytics': () => import('../pages/Analytics'),
  '/players': () => import('../pages/Players'),
  '/estimator': () => import('../pages/Estimator'),
  '/draft/consensus': () => import('../pages/draft/AdpPage'),
  '/draft/board': () => import('../pages/draft/DraftBoardPage'),
  '/draft/rankings': () => import('../pages/draft/PreDraftRankingsPage'),
  '/draft/mock': () => import('../pages/draft/MockDraftPage'),
}

const prefetchRoute = (path: string) => {
  prefetchMap[path]?.()
}

function useGlobalSearchShortcut(setSearchOpen: (open: boolean) => void) {
  useEffect(() => {
    if (!FF_GLOBAL_SEARCH) return
    function handleKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null
      const isTyping =
        !!target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k' && !isTyping) {
        e.preventDefault()
        setSearchOpen(true)
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [setSearchOpen])
}

const SearchIcon = () => (
  <svg width="14" height="14" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" className="shrink-0">
    <circle cx="9" cy="9" r="6.5" stroke="currentColor" strokeWidth="1.6" />
    <path d="M14 14L18 18" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
  </svg>
)

const SearchButton = ({ onClick }: { onClick: () => void }) => {
  if (!FF_GLOBAL_SEARCH) return null
  return (
    <button
      type="button"
      onClick={onClick}
      title="Search (Ctrl K)"
      className="hidden md:flex items-center gap-2 w-40 lg:w-56 rounded-full border border-gray-200 dark:border-gray-700 bg-gray-100 dark:bg-gray-800 px-3.5 py-1.5 text-gray-400 dark:text-gray-500 shrink-0 transition-colors hover:border-blue-300 hover:bg-white hover:text-gray-500 dark:hover:border-blue-500 dark:hover:bg-gray-700 dark:hover:text-gray-300"
    >
      <SearchIcon />
      <span className="flex-1 text-left text-sm truncate">Search…</span>
      <kbd className="hidden lg:inline rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-1.5 py-0.5 text-[10px] font-medium text-gray-400 dark:text-gray-500">
        Ctrl K
      </kbd>
    </button>
  )
}

const MobileSearchIconButton = ({ onClick }: { onClick: () => void }) => {
  if (!FF_GLOBAL_SEARCH) return null
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Search"
      className="p-2 rounded-md text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
    >
      <svg width="18" height="18" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="9" cy="9" r="6.5" stroke="currentColor" strokeWidth="1.6" />
        <path d="M14 14L18 18" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    </button>
  )
}

const Layout = () => {
  const location = useLocation()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [openGroup, setOpenGroup] = useState<string | null>(null)
  const [mobileOpenGroup, setMobileOpenGroup] = useState<string | null>(null)
  const [darkMode, setDarkMode] = useState(() => {
    return localStorage.getItem('theme') === 'dark'
  })

  useGlobalSearchShortcut(setSearchOpen)

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
    { path: '/rankings', label: 'Standings & Rankings', icon: '🏆' },
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

  const closeMobileMenu = () => {
    setMobileMenuOpen(false)
    setMobileOpenGroup(null)
  }

  if (FF_NAV_REORG) {
    return (
      <>
        {FF_GLOBAL_SEARCH && <CommandPalette isOpen={searchOpen} onClose={() => setSearchOpen(false)} />}
        <ReorgLayout darkMode={darkMode} setDarkMode={setDarkMode} setSearchOpen={setSearchOpen} />
      </>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-blue-50 dark:from-gray-900 dark:to-gray-800 flex flex-col">
      {FF_GLOBAL_SEARCH && <CommandPalette isOpen={searchOpen} onClose={() => setSearchOpen(false)} />}
      <nav className="sticky top-0 z-40 bg-white dark:bg-gray-900 shadow-lg border-b border-gray-200 dark:border-gray-700">
        <div className="w-full px-3">
          <div className="flex items-center justify-between h-14 gap-2">
            <h1 className="text-sm font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent whitespace-nowrap shrink-0">
              🏀 Fantasy League
            </h1>

            {/* Desktop Navigation */}
            <div className="hidden md:flex items-center gap-0.5 overflow-x-auto">
              {navItems.map((item) => (
                <Fragment key={item.path}>
                  <Link
                    to={item.path}
                    onMouseEnter={() => prefetchRoute(item.path)}
                    onTouchStart={() => prefetchRoute(item.path)}
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
                  {item.path === '/players' && FF_DRAFT_PAGES && (
                    <DesktopNavGroup
                      group={DRAFT_NAV_GROUP}
                      openKey={openGroup}
                      setOpenKey={setOpenGroup}
                      isActive={DRAFT_NAV_GROUP.items.some((d) => d.path === location.pathname)}
                    />
                  )}
                </Fragment>
              ))}
              <div className="mx-3 h-6 w-0.5 bg-gray-300 dark:bg-gray-500 shrink-0 rounded-full" />
              <SearchButton onClick={() => setSearchOpen(true)} />
              <button
                onClick={() => setDarkMode(d => !d)}
                className="p-1.5 rounded-md text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors shrink-0"
                aria-label="Toggle dark mode"
                title={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
              >
                <span className="text-sm">{darkMode ? '☀️' : '🌙'}</span>
              </button>
            </div>

            {/* Mobile: search + dark toggle + hamburger */}
            <div className="md:hidden flex items-center gap-1">
              <MobileSearchIconButton onClick={() => setSearchOpen(true)} />
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
                  <Fragment key={item.path}>
                    <Link
                      to={item.path}
                      onClick={closeMobileMenu}
                      onTouchStart={() => prefetchRoute(item.path)}
                      className={`inline-flex items-center px-4 py-3 rounded-md text-base font-medium transition-all duration-200 ${
                        location.pathname === item.path
                          ? 'bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 shadow-sm'
                          : 'text-gray-600 dark:text-gray-300 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-blue-50 dark:hover:bg-gray-800'
                      }`}
                    >
                      <span className="mr-3 text-xl">{item.icon}</span>
                      {item.label}
                    </Link>
                    {item.path === '/players' && FF_DRAFT_PAGES && (
                      <MobileNavGroup
                        group={DRAFT_NAV_GROUP}
                        openKey={mobileOpenGroup}
                        setOpenKey={setMobileOpenGroup}
                        isActive={DRAFT_NAV_GROUP.items.some((d) => d.path === location.pathname)}
                        onNavigate={closeMobileMenu}
                      />
                    )}
                  </Fragment>
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
  setSearchOpen: React.Dispatch<React.SetStateAction<boolean>>
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

const DRAFT_NAV_GROUP: NavGroupDef = {
  key: 'draft',
  label: 'Draft',
  icon: '📝',
  items: [
    { path: '/draft/consensus', label: 'Consensus', icon: '📊' },
    { path: '/draft/board', label: 'Draft Board', icon: '🗂️' },
    { path: '/draft/rankings', label: 'Pre-Draft Rankings', icon: '📋' },
    { path: '/draft/mock', label: 'Mock Draft', icon: '🏟️' },
  ],
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
  setOpenKey: React.Dispatch<React.SetStateAction<string | null>>
  isActive: boolean
}

const DesktopNavGroup = ({ group, openKey, setOpenKey, isActive }: DesktopNavGroupProps) => {
  const location = useLocation()
  const groupRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const closeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [menuPos, setMenuPos] = useState<{ top: number; right: number } | null>(null)
  const isOpen = openKey === group.key

  const clearCloseTimeout = () => {
    if (closeTimeoutRef.current !== null) {
      clearTimeout(closeTimeoutRef.current)
      closeTimeoutRef.current = null
    }
  }

  const openMenu = () => {
    clearCloseTimeout()
    setOpenKey(group.key)
  }

  // Delay close so the pointer can cross the gap between the nav and the fixed menu.
  // Only close if this group is still open — otherwise a pending close from group A
  // would flash-close group B right after switching.
  const scheduleCloseMenu = () => {
    clearCloseTimeout()
    closeTimeoutRef.current = setTimeout(() => {
      setOpenKey((current) => (current === group.key ? null : current))
      closeTimeoutRef.current = null
    }, 150)
  }

  useEffect(() => () => clearCloseTimeout(), [])

  useEffect(() => {
    if (!isOpen) return
    const handleClickOutside = (e: MouseEvent) => {
      if (
        groupRef.current &&
        !groupRef.current.contains(e.target as Node) &&
        !menuRef.current?.contains(e.target as Node)
      ) {
        clearCloseTimeout()
        setOpenKey(null)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isOpen, setOpenKey])

  useEffect(() => {
    if (!isOpen) return
    const updatePos = () => {
      // Anchor to the full group hit area (nav-height), not the shorter button.
      const rect = groupRef.current?.getBoundingClientRect()
      if (rect) {
        setMenuPos({ top: rect.bottom, right: window.innerWidth - rect.right })
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
      clearCloseTimeout()
      setOpenKey(null)
      buttonRef.current?.focus()
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      openMenu()
      requestAnimationFrame(() => {
        const firstLink = menuRef.current?.querySelector('a')
        ;(firstLink as HTMLAnchorElement | null)?.focus()
      })
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      clearCloseTimeout()
      setOpenKey(isOpen ? null : group.key)
    }
  }

  const handleMenuKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      clearCloseTimeout()
      setOpenKey(null)
      buttonRef.current?.focus()
    }
  }

  return (
    <div
      ref={groupRef}
      className="relative h-14 flex items-center"
      onMouseEnter={openMenu}
      onMouseLeave={scheduleCloseMenu}
    >
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        onClick={() => {
          clearCloseTimeout()
          setOpenKey(isOpen ? null : group.key)
        }}
        onKeyDown={handleButtonKeyDown}
        className={desktopItemClass(isActive)}
        title={group.label}
      >
        <span className="text-sm">{group.icon}</span>
        <span>{group.label}</span>
        <span className="text-[10px]">▾</span>
      </button>
      {isOpen && menuPos && (
        // Outer shell includes a top padding bridge so hover stays active while
        // moving from the group into the visually offset menu panel.
        <div
          ref={menuRef}
          onMouseEnter={openMenu}
          onMouseLeave={scheduleCloseMenu}
          style={{ position: 'fixed', top: menuPos.top, right: menuPos.right }}
          className="pt-1 z-50"
        >
          <div
            role="menu"
            onKeyDown={handleMenuKeyDown}
            className="min-w-[11rem] bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-md shadow-lg py-1"
          >
            {group.items.map((item) => (
              <Link
                key={item.path}
                role="menuitem"
                to={item.path}
                onMouseEnter={() => prefetchRoute(item.path)}
                onTouchStart={() => prefetchRoute(item.path)}
                onClick={() => {
                  clearCloseTimeout()
                  setOpenKey(null)
                }}
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
              onTouchStart={() => prefetchRoute(item.path)}
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

const ReorgLayout = ({ darkMode, setDarkMode, setSearchOpen }: ReorgLayoutProps) => {
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
        { path: '/rankings', label: 'Standings & Rankings', icon: '🏆' },
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
    ...(FF_DRAFT_PAGES ? [DRAFT_NAV_GROUP] : []),
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
        { path: '/nba-teams', label: 'NBA Teams', icon: '🏀' },
        ...(FF_SCHEDULE ? [{ path: '/schedule', label: 'Season Schedule', icon: '🗓️' }] : []),
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
              <SearchButton onClick={() => setSearchOpen(true)} />
              <button
                onClick={() => setDarkMode(d => !d)}
                className="p-1.5 rounded-md text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors shrink-0"
                aria-label="Toggle dark mode"
                title={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
              >
                <span className="text-sm">{darkMode ? '☀️' : '🌙'}</span>
              </button>
            </div>

            {/* Mobile: search + dark toggle + hamburger */}
            <div className="md:hidden flex items-center gap-1">
              <MobileSearchIconButton onClick={() => setSearchOpen(true)} />
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
