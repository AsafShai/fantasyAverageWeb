export {}

declare global {
  const chrome: {
    storage: {
      local: {
        get: (
          keys: string | string[] | Record<string, unknown> | null,
        ) => Promise<Record<string, unknown>>
        set: (items: Record<string, unknown>) => Promise<void>
      }
      onChanged: {
        addListener: (
          cb: (changes: Record<string, { newValue?: unknown; oldValue?: unknown }>, area: string) => void,
        ) => void
      }
    }
  }
}
