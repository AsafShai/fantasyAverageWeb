import { Link } from 'react-router'
import { MINIGAMES } from '../minigames/catalog'
import { useMobileRedesign } from '../mobile/flag'
import MobileMinigames from '../mobile/minigames/MobileMinigames'

const Minigames = () => {
  const mobile = useMobileRedesign()
  if (mobile) return <MobileMinigames games={MINIGAMES} />
  return (
    <div className="max-w-5xl mx-auto px-4 pb-12">
      <div className="mb-8">
        <h1 className="text-3xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent mb-2">
          Minigames
        </h1>
        <p className="text-gray-600 dark:text-gray-400">
          Play NBA guessing games and climb each game&apos;s top-5 streak leaderboard
        </p>
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        {MINIGAMES.map((g) => (
          <Link
            key={g.slug}
            to={`/minigames/${g.slug}`}
            className="block rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-6 shadow-sm hover:border-blue-400 dark:hover:border-blue-500 hover:shadow-md transition-all"
          >
            <div className="text-3xl mb-3">{g.emoji}</div>
            <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-1">
              {g.title}
            </h2>
            <p className="text-sm text-gray-600 dark:text-gray-400">{g.description}</p>
          </Link>
        ))}
      </div>
    </div>
  )
}

export default Minigames
