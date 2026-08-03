import { useGetMinigamePlayersQuery } from '../store/api/fantasyApi'

/** Load the shared NBA roster bundle once (RTK cache). */
export function useMinigamePlayers() {
  const { data, error, isLoading } = useGetMinigamePlayersQuery()
  return {
    bundle: data,
    players: data?.players ?? [],
    isLoading,
    error,
  }
}
