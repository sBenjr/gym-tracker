import { useEffect, useState } from 'react'

const currentPath = () => window.location.hash.replace(/^#/, '') || '/'

/** Hash routes, so a GitHub Pages reload never hits a missing page. */
export function useRoute(): string[] {
  const [path, setPath] = useState(currentPath)
  useEffect(() => {
    const onChange = () => {
      setPath(currentPath())
      window.scrollTo(0, 0)
    }
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  return path.split('/').filter(Boolean)
}

export const navigate = (path: string) => {
  window.location.hash = path
}
