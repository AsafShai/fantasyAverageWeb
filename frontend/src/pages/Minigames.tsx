import { Link } from 'react-router'

const GAMES = [
  {
    slug: 'hangman',
    title: 'Hangman',
    emoji: '🔤',
    description: 'Guess the name — build a streak',
  },
  {
    slug: 'who-he-play-for',
    title: 'Who He Play For?',
    emoji: '🏟️',
    description: 'Pick the team for each player — 30s per round',
  },
  {
    slug: 'who-am-i',
    title: 'Who Am I?',
    emoji: '🕵️',
    description: 'Poeltl-style clues + optional photo hint',
  },
  {
    slug: 'now-you-see-me',
    title: 'Now You See Me',
    emoji: '👁️',
    description: 'Name the player from their photo — 60s per round',
  },
] as const

const Minigames = () => {
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
        {GAMES.map((g) => (
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
