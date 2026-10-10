// Stand-in for ESPN's Edit Draft Strategy rankings page (kona bundle 1.513):
// same React 16 class lifecycle, MobX 4 strict mode, store fields, and table markup.
import React from 'react'
import ReactDOM from 'react-dom'
import { configure, observable, runInAction } from 'mobx'
import { observer } from 'mobx-react'

configure({ enforceActions: true })

const params = new URLSearchParams(location.search)
const COUNT = Number(params.get('n') || 400)
const VARIANT = params.get('variant') || 'espn'
const PAGE_SIZE = 50
const TEAMS = { 1: { abbrev: 'ATL' }, 2: { abbrev: 'BOS' }, 3: { abbrev: 'LAL' } }

const players = Array.from({ length: COUNT }, (_, i) => ({
  id: 3000 + i,
  fullName: `Mock Player ${i}`,
  proTeamId: (i % 3) + 1,
}))

const sameMap = (a, b) => JSON.stringify(a) === JSON.stringify(b)

const Table = observer(
  class Table extends React.Component {
    constructor(props) {
      super(props)
      this.local = observable({ pages: 1 })
    }

    rowIndex(e) {
      return Number(e.currentTarget.getAttribute('data-idx'))
    }

    onDragStart = (e) => {
      if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
      const idx = this.rowIndex(e)
      runInAction(() => {
        this.props.store.draggerIndex = idx
      })
    }

    onDragOver = (e) => {
      e.preventDefault()
      const idx = this.rowIndex(e)
      runInAction(() => {
        this.props.store.indexOver = idx
      })
    }

    onDragEnd = () => {
      runInAction(() => {
        this.props.store.indexOver = null
      })
    }

    onDrop = () => {
      const store = this.props.store
      const r = store.draggerIndex
      const u = store.indexOver
      this.onDragEnd()
      if (r == null || u == null || r === u) return
      const g = store.players
      const m = store.playerRankMap
      const moved = g[r]
      runInAction(() => {
        if (r > u) for (let k = 0; k < r - u; k++) m[g[u + k].id]++
        else for (let k = 1; k <= u - r; k++) m[g[r + k].id]--
        m[moved.id] = u
        g.splice(r, 1)
        g.splice(u, 0, moved)
        store.draggerIndex = null
      })
    }

    showMore = () => {
      runInAction(() => {
        this.local.pages++
      })
    }

    render() {
      const store = this.props.store
      const shown = store.players.slice(0, this.local.pages * PAGE_SIZE)
      const canShowMore = shown.length < store.players.length
      return (
        <div>
          <table className="players-table">
            <tbody className="Table__TBODY">
              {shown.map((p, i) => (
                <tr
                  key={p.id}
                  className="Table__TR"
                  data-player-row="true"
                  data-idx={i}
                  draggable="true"
                  onDragStart={this.onDragStart}
                  onDragOver={this.onDragOver}
                  onDrop={this.onDrop}
                  onDragEnd={this.onDragEnd}
                >
                  <td className="grabber">≡</td>
                  <td className="ranking-column">{i + 1}</td>
                  <td className="player-column">
                    <div className="player-column__athlete">
                      <span className="playerinfo__playername">
                        <a className="AnchorLink link">{p.fullName}</a>
                      </span>
                    </div>
                    <span className="playerinfo__playerteam">{TEAMS[p.proTeamId].abbrev}</span>
                  </td>
                  <td className="exclude-wrapper">
                    <input type="checkbox" className="form__control--checkbox" data-idx={p.id} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {canShowMore && (
            <button className="show-more" type="button" onClick={this.showMore}>
              Show more
            </button>
          )}
        </div>
      )
    }
  },
)

const Rankings = observer(
  class Rankings extends React.Component {
    constructor(props) {
      super(props)
      this.playerRankMapClone = this.updateRankings(props.players)
      const clone = this.playerRankMapClone
      this.store = observable({
        draggerIndex: null,
        indexOver: null,
        excluded: observable.map(),
        excludedPlayers: props.excludedPlayers || [],
        players: props.players || [],
        playerRankMap: Object.assign({}, clone),
        isSavingChanges: false,
        get hasDraftChanged() {
          return this.isSavingChanges || !sameMap(clone, this.playerRankMap)
        },
      })
      this.resetToDefault = observable({ isActive: false, isSaved: false })
      if (VARIANT === 'nocomponent') this.componentWillReceiveProps = undefined
      window.__mockStore = this.store
    }

    updateRankings(list) {
      const map = {}
      list.forEach((p, i) => {
        map[p.id] = i
      })
      return map
    }

    componentWillReceiveProps(e) {
      runInAction(() => {
        this.store.players.replace(e.players)
        this.store.excludedPlayers.replace(e.excludedPlayers)
        this.store.playerRankMap = this.updateRankings(this.store.players)
        this.store.excludedPlayers.forEach((p) => {
          p && this.store.excluded.set(p.id, p.rank)
        })
        if (this.resetToDefault.isSaved) {
          this.playerRankMapClone = Object.assign({}, this.store.playerRankMap)
        }
      })
    }

    render() {
      return (
        <div>
          <button className="save-rankings-btn" type="button" disabled={!this.store.hasDraftChanged}>
            Save Rankings
          </button>
          <Table store={this.store} />
        </div>
      )
    }
  },
)

ReactDOM.render(
  <Rankings players={players} excludedPlayers={[]} config={{ constants: { proTeamsMap: TEAMS } }} />,
  document.getElementById('root'),
)
