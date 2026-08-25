import { useState } from 'react'
import PlayerNameLink from '../PlayerNameLink'
import PositionPills from './PositionPills'

export default function PlayerIdentityCell({
  name,
  playerId,
  photoUrl,
  teamAbbr,
  positions,
  wrapName = false,
  rowSelectOnMobile = false,
  splitMetaOnMobile = false,
}: {
  name: string
  playerId?: number | string | null
  photoUrl?: string | null
  teamAbbr?: string | null
  positions: string[]
  wrapName?: boolean
  rowSelectOnMobile?: boolean
  splitMetaOnMobile?: boolean
}) {
  const [broke, setBroke] = useState(false)
  return (
    <div className="flex items-center gap-2 min-w-0 w-full">
      <div className="shrink-0 w-8 h-8 rounded-full overflow-hidden bg-gray-200 dark:bg-gray-700 border border-gray-200 dark:border-gray-600">
        {photoUrl && !broke ? (
          <img
            src={photoUrl}
            alt=""
            className="w-full h-full object-cover object-top"
            onError={() => setBroke(true)}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-sm">🏀</div>
        )}
      </div>
      <div
        className={
          splitMetaOnMobile
            ? 'min-w-0 flex-1 flex items-center justify-between gap-2 lg:block'
            : 'min-w-0'
        }
      >
        <div className={wrapName ? 'whitespace-normal break-words leading-tight' : 'truncate'}>
          <PlayerNameLink
            name={name}
            playerId={playerId}
            className={
              rowSelectOnMobile
                ? 'text-blue-700 dark:text-blue-300 hover:underline font-medium pointer-events-none lg:pointer-events-auto'
                : undefined
            }
          />
        </div>
        <div
          className={`flex items-center gap-1.5 ${
            splitMetaOnMobile ? 'shrink-0 justify-end lg:justify-start lg:mt-0.5' : 'mt-0.5'
          }`}
        >
          {teamAbbr ? (
            <span className="text-[11px] font-semibold text-gray-500 dark:text-gray-400">{teamAbbr}</span>
          ) : null}
          <PositionPills positions={positions} />
        </div>
      </div>
    </div>
  )
}
