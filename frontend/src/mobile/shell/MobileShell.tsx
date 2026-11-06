import { useEffect, type Dispatch, type SetStateAction } from 'react'
import { Link, Outlet, useLocation, useNavigate } from 'react-router'
import CommandPalette from '../../components/CommandPalette'
import { SocialLinks } from '../../components/Footer'
import { getNavGroups, prefetchRoute, type NavGroupDef } from '../../components/navConfig'
import { useMyTeam } from '../../context/MyTeamContext'
import { ensureMobileFonts } from '../fonts'
import { BottomSheet, useSheetHistory } from '../ui'
import { TABS } from './tabs'

/*
 * Phone shell of the redesign (step 2): logo header, page, site footer, the
 * bottom tab bar and the ☰ menu sheet. Pages that are not converted yet render
 * unchanged inside it. The menu and the search overlay live in browser history,
 * so the phone's back button closes them before it leaves the page.
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

  useEffect(() => ensureMobileFonts(), [])

  return (
    <div className="mr-shell">
      <MobileHeader
        darkMode={darkMode}
        onToggleDark={() => setDarkMode((d) => !d)}
        onSearch={search.show}
        onMenu={menu.show}
        menuOpen={menu.open}
      />

      <main className="mr-shell-main">
        <Outlet />
      </main>

      <MobileFooter />
      <MobileTabBar />

      <MenuSheet open={menu.open} onClose={menu.hide} />
      <CommandPalette
        isOpen={search.open}
        onClose={search.hide}
        // Replace the search entry, so back from the result returns to the page
        // the search was opened on (not to the search again).
        onNavigate={(path) => navigate(path, { replace: true })}
      />
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
      <button type="button" className="mr-hdr-btn" onClick={onMenu} aria-label="Menu" aria-haspopup="dialog" aria-expanded={menuOpen}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
          <path d="M4 7h16M4 12h16M4 17h16" />
        </svg>
      </button>
    </header>
  )
}

// ── bottom tab bar ──────────────────────────────────────────────────────

function MobileTabBar() {
  const { pathname } = useLocation()
  return (
    <nav className="mr-root mr-tabbar" aria-label="Main">
      {TABS.map((tab) => {
        const on = tab.match(pathname)
        return (
          <Link
            key={tab.path}
            to={tab.path}
            className="mr-tab"
            aria-current={on ? 'page' : undefined}
            onTouchStart={() => prefetchRoute(tab.path)}
          >
            <span className="mr-tab-pill" aria-hidden="true">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d={tab.icon} />
              </svg>
            </span>
            <span className="mr-tab-label">{tab.label}</span>
          </Link>
        )
      })}
    </nav>
  )
}

// ── ☰ menu sheet ────────────────────────────────────────────────────────

/** Phone menu only: NBA comes before Minigames (desktop keeps its order). */
function menuOrder(groups: NavGroupDef[]): NavGroupDef[] {
  const rank = (key: string) => (key === 'nba' ? 0 : key === 'minigames' ? 1 : -1)
  const tail = groups.filter((g) => rank(g.key) >= 0).sort((a, b) => rank(a.key) - rank(b.key))
  return [...groups.filter((g) => rank(g.key) < 0), ...tail]
}

function MenuSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { pathname } = useLocation()
  const groups: NavGroupDef[] = menuOrder(getNavGroups())
  return (
    <BottomSheet open={open} onClose={onClose} title="Menu" hideTitle sunken>
      <MyTeamPicker />
      {groups.map((group) => (
        <section key={group.key} className="mr-menu-group" aria-labelledby={`mr-menu-${group.key}`}>
          <h2 id={`mr-menu-${group.key}`} className="mr-menu-title">
            <span aria-hidden="true">{group.icon}</span> {group.label.toUpperCase()}
          </h2>
          <div className="mr-menu-grid">
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
        </section>
      ))}
    </BottomSheet>
  )
}

/**
 * "Select my team", as in today's phone menu: a native select (the phone's own
 * picker) dressed as the design's select button, plus a link to the team page.
 */
function MyTeamPicker() {
  const { teams, myTeam, myTeamId, setMyTeamId } = useMyTeam()
  return (
    <div className="mr-menu-team">
      <label className="mr-select mr-wide mr-native-select">
        <span className="mr-select-label">{myTeam ? `My team: ${myTeam.team_name}` : 'Select my team'}</span>
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
      {myTeam && (
        <Link to={`/team/${myTeam.team_id}`} replace className="mr-link">
          Open my team ›
        </Link>
      )}
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
