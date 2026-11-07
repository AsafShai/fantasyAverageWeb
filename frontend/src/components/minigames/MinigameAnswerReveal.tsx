import type { MinigamePlayer } from '../../minigames/types'

/** Photo + name shown after a run ends (give up, timeout, max wrong guesses). */
export default function MinigameAnswerReveal({
  player,
  label = 'Answer',
  detail,
}: {
  player: MinigamePlayer
  label?: string
  detail?: string
}) {
  return (
    <div className="mb-4 flex flex-col items-center gap-2 text-center">
      {player.photoUrl ? (
        <img
          src={player.photoUrl}
          alt=""
          className="w-24 h-24 rounded-full object-cover object-top border-2 border-gray-200 dark:border-gray-600"
        />
      ) : null}
      <p className="text-sm text-gray-600 dark:text-gray-300">
        {label}: <strong className="text-gray-900 dark:text-gray-100">{player.displayName}</strong>
      </p>
      {detail ? <p className="text-xs text-gray-500 dark:text-gray-400">{detail}</p> : null}
    </div>
  )
}
