import { useEffect, useState } from 'react'

const DESKTOP_QUERY = '(min-width: 1024px)'

export function useDesktopViewport(): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(DESKTOP_QUERY).matches)

  useEffect(() => {
    const query = window.matchMedia(DESKTOP_QUERY)
    const listener = (event: MediaQueryListEvent) => setMatches(event.matches)
    query.addEventListener('change', listener)
    return () => query.removeEventListener('change', listener)
  }, [])

  return matches
}
