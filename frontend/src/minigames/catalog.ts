import type { GameSlug } from './types'

export const MINIGAMES = [
  {
    slug: 'hangman' as const,
    title: 'Hangman',
    emoji: '🔤',
    description: 'Guess the name — build a streak',
  },
  {
    slug: 'who-he-play-for' as const,
    title: 'Who He Play For?',
    emoji: '🏟️',
    description: 'Pick the team for each player — 30s per round',
  },
  {
    slug: 'who-am-i' as const,
    title: 'Who Am I?',
    emoji: '🕵️',
    description: 'Poeltl-style clues + optional photo hint',
  },
  {
    slug: 'now-you-see-me' as const,
    title: 'Now You See Me',
    emoji: '👁️',
    description: 'Name the player from their photo — 60s per round',
  },
] as const

export function minigameEmoji(slug: GameSlug): string {
  return MINIGAMES.find((g) => g.slug === slug)?.emoji ?? '🎮'
}
