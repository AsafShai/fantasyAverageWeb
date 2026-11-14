import { useEffect, useState } from 'react';

const isDark = () => typeof document !== 'undefined' && document.documentElement.classList.contains('dark');

/** Follows the app's light/dark switch (the `dark` class on <html>). */
export function useIsDarkTheme(): boolean {
  const [dark, setDark] = useState(isDark);
  useEffect(() => {
    const obs = new MutationObserver(() => setDark(isDark()));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => obs.disconnect();
  }, []);
  return dark;
}
