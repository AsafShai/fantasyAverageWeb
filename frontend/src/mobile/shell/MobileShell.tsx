import { useEffect, useState, type CSSProperties, type Dispatch, type SetStateAction } from 'react'
import { Link, Outlet, useLocation, useNavigate } from 'react-router'
import CommandPalette from '../../components/CommandPalette'
import { SocialLinks } from '../../components/Footer'
import { getNavGroups, prefetchRoute } from '../../components/navConfig'
import { useMyTeam } from '../../context/MyTeamContext'
import { ensureMobileFonts } from '../fonts'
import PlayerSheet from '../player/PlayerSheet'
import { playerIdFromPath } from '../player/playerParam'
import { usePlayerSheet } from '../player/usePlayerSheet'
import { useSheetHistory } from '../ui'
import { useTabPrefs } from './tabPrefs'
import { useBarTabs } from './useTabContext'
import { menuGroups } from './menuGroups'

/*
 * Phone shell of the redesign (step 2): logo header, page, site footer, the
 * bottom tab bar (the user's own tabs, chosen in Settings) and the ☰ menu dropdown. Pages that are not converted yet render
 * unchanged inside it. The menu and the search overlay live in browser history,
 * so the phone's back button closes them before it leaves the page. The player
 * sheet (step 3) opens over any page from a player name: `?player=<id>`.
 */

interface MobileShellProps {
  darkMode: boolean
  setDarkMode: Dispatch<SetStateAction<boolean>>
}

export const MENU_SHEET_ID = 'menu'
export const SEARCH_SHEET_ID = 'search'

const MobileShell = ({ darkMode, setDarkMode }: MobileShellProps) => {
  const navigate = useNavigate()
  const menu = useSheetHistory(MENU_SHEET_ID)
  const search = useSheetHistory(SEARCH_SHEET_ID)
  const playerSheet = usePlayerSheet()
  const { labels } = useTabPrefs()

  useEffect(() => ensureMobileFonts(), [])

  return (
    // Without labels the bar is shorter; the page's bottom padding follows it.
    <div className="mr-shell" style={labels ? undefined : ({ '--mr-tabbar-h': '60px' } as CSSProperties)}>
      <div className="mr-hdr-wrap">
        <MobileHeader
          darkMode={darkMode}
          onToggleDark={() => setDarkMode((d) => !d)}
          onSearch={search.show}
          onMenu={menu.open ? menu.hide : menu.show}
          menuOpen={menu.open}
        />
        <MenuDropdown open={menu.open} onClose={menu.hide} />
      </div>

      <main className="mr-shell-main">
        <Outlet />
      </main>

      <MobileFooter />
      <MobileTabBar onSearch={search.show} onMenu={menu.show} />

      <CommandPalette
        isOpen={search.open}
        onClose={search.hide}
        // Replace the search entry, so back from the result returns to the page
        // the search was opened on (not to the search again). A player result
        // opens the player sheet over that page, like any player name.
        onNavigate={(path) => {
          const playerId = playerIdFromPath(path)
          if (playerId) playerSheet.open(playerId, { replace: true })
          else navigate(path, { replace: true })
        }}
      />
      <PlayerSheet />
    </div>
  )
}

// ── header ──────────────────────────────────────────────────────────────

interface MobileHeaderProps {
  darkMode: boolean
  onToggleDark: () => void
  onSearch: () => void
  onMenu: () => void
  menuOpen: boolean
}

function MobileHeader({ darkMode, onToggleDark, onSearch, onMenu, menuOpen }: MobileHeaderProps) {
  const { pathname } = useLocation()
  return (
    <header className="mr-root mr-hdr">
      <Link to="/" className="mr-hdr-logo">
        <span className="mr-hdr-dot" aria-hidden="true" />
        <span className="mr-brand">Fantasy League</span>
      </Link>
      <button type="button" className="mr-hdr-btn" onClick={onSearch} aria-label="Search">
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
          <circle cx="9" cy="9" r="6" />
          <path d="M14 14l4 4" />
        </svg>
      </button>
      <button
        type="button"
        className="mr-hdr-btn"
        onClick={onToggleDark}
        aria-label="Toggle dark mode"
        title={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
      >
        <span className="mr-hdr-emoji" aria-hidden="true">{darkMode ? '☀️' : '🌙'}</span>
      </button>
      <Link
        to="/settings"
        className="mr-hdr-btn"
        aria-label="Settings"
        aria-current={pathname === '/settings' ? 'page' : undefined}
      >
        <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      </Link>
      <button type="button" className="mr-hdr-btn" onClick={onMenu} aria-label="Menu" aria-haspopup="dialog" aria-expanded={menuOpen}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
          <path d={menuOpen ? 'M6 6l12 12M18 6L6 18' : 'M4 7h16M4 12h16M4 17h16'} />
        </svg>
      </button>
    </header>
  )
}

// ── bottom tab bar ──────────────────────────────────────────────────────

interface MobileTabBarProps {
  onSearch: () => void
  onMenu: () => void
}

function MobileTabBar({ onSearch, onMenu }: MobileTabBarProps) {
  const { tabs: ids, labels } = useTabPrefs()
  const { tabs, ctx, current } = useBarTabs(ids)
  return (
    <nav
      className={`mr-root mr-tabbar${labels ? '' : ' mr-tabbar-bare'}`}
      aria-label="Main"
      style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}
    >
      {tabs.map((tab, i) => {
        // A team shortcut with no team chosen sends you to Settings, where My team is first.
        const needsSetup = tab.needsTeam === true && ctx.myTeamId == null
        const to = needsSetup ? '/settings' : tab.to(ctx)
        const body = (
          <>
            <span className="mr-tab-pill" aria-hidden="true">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d={tab.icon} />
              </svg>
              {needsSetup && <span className="mr-tab-dot" />}
            </span>
            {labels && <span className="mr-tab-label">{tab.label}</span>}
          </>
        )
        const label = labels ? undefined : tab.label
        if (to === null) {
          // Search, or Recent before anything was opened (it points at the ☰ menu then).
          return (
            <button
              key={tab.id}
              type="button"
              className="mr-tab"
              aria-label={label}
              onClick={tab.action === 'search' ? onSearch : onMenu}
            >
              {body}
            </button>
          )
        }
        return (
          <Link
            key={tab.id}
            to={to}
            className="mr-tab"
            aria-label={label}
            aria-current={i === current ? 'page' : undefined}
            onTouchStart={() => prefetchRoute(to)}
          >
            {body}
          </Link>
        )
      })}
    </nav>
  )
}

// ── ☰ menu dropdown ─────────────────────────────────────────────────────

/**
 * Floats over the page right under the header (not a sheet, does not push the
 * page): the team row, then one collapsed accordion row per group; the group of
 * the current page is highlighted. One group is open at a time.
 */
function MenuDropdown({ open, onClose }: { open: boolean; onClose: () => void }) {
  // Mounted only while open, so every group starts collapsed.
  return open ? <MenuDropdownBody onClose={onClose} /> : null
}

function MenuDropdownBody({ onClose }: { onClose: () => void }) {
  const { pathname } = useLocation()
  const groups = menuGroups(getNavGroups())
  const [openKey, setOpenKey] = useState<string | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <>
    <button type="button" className="mr-root mr-menu-scrim" aria-label="Close menu" onClick={onClose} />
    <div className="mr-root mr-menu-drop" role="dialog" aria-label="Menu">
      <MyTeamPicker />
      {groups.map((group) => {
        const isOpen = openKey === group.key
        const hasCurrent = group.items.some((i) => i.path === pathname)
        return (
          <section key={group.key} className="mr-acc">
            <h2 className="mr-acc-h">
              <button
                type="button"
                className={`mr-acc-btn${hasCurrent ? ' mr-acc-current' : ''}`}
                aria-expanded={isOpen}
                aria-controls={`mr-acc-${group.key}`}
                onClick={() => setOpenKey(isOpen ? null : group.key)}
              >
                <span className="mr-acc-icon" aria-hidden="true">{group.icon}</span>
                <span className="mr-acc-label">{group.label}</span>
                <span className="mr-acc-caret" aria-hidden="true">▾</span>
              </button>
            </h2>
            {isOpen && (
              <div id={`mr-acc-${group.key}`} className="mr-acc-list">
                {group.items.map((item) => (
                  <Link
                    key={item.path}
                    to={item.path}
                    // Replace the menu's history entry: back from the new page goes
                    // to the page the menu was opened on, not to the open menu.
                    replace
                    className="mr-menu-item"
                    aria-current={pathname === item.path ? 'page' : undefined}
                    onTouchStart={() => prefetchRoute(item.path)}
                  >
                    <span className="mr-menu-icon" aria-hidden="true">{item.icon}</span>
                    <span>{item.label}</span>
                  </Link>
                ))}
              </div>
            )}
          </section>
        )
      })}
    </div>
    </>
  )
}

/**
 * My team row, as on master: the team name (a link to the team page) and a
 * native select (the phone's own picker) to change it.
 */
function MyTeamPicker() {
  const { teams, myTeam, myTeamId, setMyTeamId } = useMyTeam()
  return (
    <div className="mr-menu-team">
      {myTeam && (
        <Link to={`/team/${myTeam.team_id}`} replace className="mr-menu-myteam">
          Go to my team ›
        </Link>
      )}
      <label className="mr-select mr-native-select mr-menu-select">
        <span className="mr-select-label">{myTeam ? myTeam.team_name : 'Select my team'}</span>
        <span className="mr-caret" aria-hidden="true">▾</span>
        <select
          aria-label="My team"
          value={myTeamId ?? ''}
          onChange={(e) => setMyTeamId(e.target.value === '' ? null : Number(e.target.value))}
        >
          <option value="">{myTeam ? 'Clear' : 'Select my team'}</option>
          {teams.map((team) => (
            <option key={team.team_id} value={team.team_id}>
              {team.team_name}
            </option>
          ))}
        </select>
      </label>
    </div>
  )
}

// ── footer ──────────────────────────────────────────────────────────────

function MobileFooter() {
  return (
    <footer className="mr-root mr-foot">
      <span>
        © {new Date().getFullYear()} <b>Asaf Shai</b>. All rights reserved.
      </span>
      <span className="mr-foot-links">
        <SocialLinks linkClassName="mr-foot-link" />
      </span>
    </footer>
  )
}

export default MobileShell
