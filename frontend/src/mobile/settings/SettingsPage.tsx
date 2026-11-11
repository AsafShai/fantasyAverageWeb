import { useMemo } from 'react'
import { Card, Chip, ChipRow } from '../ui'
import { useMyTeam } from '../../context/MyTeamContext'
import { useTabPrefs } from '../shell/tabPrefs'
import { CATALOG, GROUP_ORDER, MAX_TABS, MIN_TABS, PRESETS, getTab, type TabDef } from '../shell/tabs'
import './settings.css'

/*
 * Phone settings (the ⚙ in the header). Today: my team and the tab bar. The bar
 * under this page is the live preview, so there is no Save: every change is
 * already in it and in this browser's storage.
 */

function TabIcon({ tab }: { tab: TabDef }) {
  return (
    <span className="mr-set-ico" aria-hidden="true">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d={tab.icon} />
      </svg>
    </span>
  )
}

function Arrow({ up }: { up: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={up ? 'M6 15l6-6 6 6' : 'M6 9l6 6 6-6'} />
    </svg>
  )
}

export default function SettingsPage() {
  const { teams, myTeam, myTeamId, setMyTeamId } = useMyTeam()
  const { tabs: ids, labels, setTabs, setLabels, reset } = useTabPrefs()

  const inBar = useMemo(() => ids.map(getTab).filter((t): t is TabDef => t !== undefined), [ids])
  const full = inBar.length >= MAX_TABS
  const atMin = inBar.length <= MIN_TABS
  const samePreset = (tabs: string[]) => tabs.length === ids.length && tabs.every((id, i) => id === ids[i])

  const move = (index: number, by: -1 | 1) => {
    const next = ids.slice()
    ;[next[index], next[index + by]] = [next[index + by], next[index]]
    setTabs(next)
  }

  const groups = GROUP_ORDER.map((group) => ({
    group,
    items: CATALOG.filter((t) => t.group === group && !ids.includes(t.id)),
  })).filter((g) => g.items.length > 0)

  return (
    <div className="mr-set">
      <h1 className="mr-h1 mr-set-title">Settings</h1>

      <Card title="My team" id="my-team">
        <p className="mr-meta mr-set-lede">Used by the My Team shortcut and highlighted across the site.</p>
        <label className="mr-select mr-native-select mr-wide">
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
      </Card>

      <Card
        title="Tab bar"
        action={
          <button type="button" className="mr-link" onClick={reset}>
            Reset
          </button>
        }
      >
        <p className="mr-meta mr-set-lede">
          Pick {MIN_TABS} to {MAX_TABS} tabs. Changes show in the bar below right away, and every page stays in the ☰ menu.
        </p>

        <ChipRow label="Presets" wrap>
          {PRESETS.map((p) => (
            <Chip key={p.id} selected={samePreset(p.tabs)} onClick={() => setTabs(p.tabs)}>
              {p.label}
            </Chip>
          ))}
        </ChipRow>

        <div className="mr-set-count">
          <h3 className="mr-set-h3">In your tab bar</h3>
          <span className="mr-num mr-meta">{inBar.length} of {MAX_TABS}</span>
        </div>
        <ol className="mr-set-list" aria-label="Tabs in your bar">
          {inBar.map((tab, i) => (
            <li key={tab.id} className="mr-set-row">
              <span className="mr-num mr-set-pos">{i + 1}</span>
              <TabIcon tab={tab} />
              <span className="mr-set-name">
                {tab.label}
                {tab.group === 'Shortcuts' && (
                  <span className="mr-set-sub">
                    {tab.needsTeam && !myTeam ? 'Choose my team above first' : tab.description}
                  </span>
                )}
              </span>
              <button type="button" className="mr-set-btn" aria-label={`Move ${tab.label} earlier`} disabled={i === 0} onClick={() => move(i, -1)}>
                <Arrow up />
              </button>
              <button type="button" className="mr-set-btn" aria-label={`Move ${tab.label} later`} disabled={i === inBar.length - 1} onClick={() => move(i, 1)}>
                <Arrow up={false} />
              </button>
              <button
                type="button"
                className="mr-set-btn mr-set-remove"
                aria-label={`Remove ${tab.label}`}
                disabled={atMin}
                onClick={() => setTabs(ids.filter((id) => id !== tab.id))}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                  <path d="M6 12h12" />
                </svg>
              </button>
            </li>
          ))}
        </ol>
        {atMin && <p className="mr-meta">Keep at least {MIN_TABS} tabs.</p>}

        <h3 className="mr-set-h3">Add to the bar</h3>
        {full && <p className="mr-set-full" role="status">The bar is full. Remove a tab to add another.</p>}
        {groups.map(({ group, items }) => (
          <section key={group} className="mr-set-group" aria-label={group}>
            <h4 className="mr-set-h4">
              {group}
              {group === 'Shortcuts' && <span className="mr-set-h4-note"> · jump to your team, recent pages or search</span>}
            </h4>
            <ul className="mr-set-list">
              {items.map((tab) => (
                <li key={tab.id} className="mr-set-row">
                  <button
                    type="button"
                    className="mr-set-add"
                    disabled={full}
                    aria-label={`Add ${tab.label}`}
                    onClick={() => setTabs([...ids, tab.id])}
                  >
                    <TabIcon tab={tab} />
                    <span className="mr-set-name">
                      {tab.label}
                      {tab.description && <span className="mr-set-sub">{tab.description}</span>}
                    </span>
                    <span className="mr-set-addtag" aria-hidden="true">+ Add</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </Card>

      <Card title="Display">
        <label className="mr-set-switchrow">
          <span>Show tab labels</span>
          <input
            type="checkbox"
            role="switch"
            className="mr-set-switch"
            checked={labels}
            onChange={(e) => setLabels(e.target.checked)}
          />
        </label>
      </Card>

      <p className="mr-meta mr-set-foot">Saved on this device only.</p>
    </div>
  )
}
