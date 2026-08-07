export const BASELINE_LABEL: Record<number, string> = { 0: 'this season only', 1: 'last season', 2: 'prior 2 seasons' }

// Mirrors LOW_SAMPLE_GP in backend/app/services/trend_service.py — below this
// many games in the window, a delta is more noise than signal.
export const LOW_SAMPLE_GP = 3
