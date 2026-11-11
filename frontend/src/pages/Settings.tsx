import { Navigate } from 'react-router'
import SettingsPage from '../mobile/settings/SettingsPage'
import { useMobileRedesign } from '../mobile/flag'

/** Phone settings (the ⚙ in the mobile header). Desktop and old-nav phones have no such page. */
export default function Settings() {
  const mobileRedesign = useMobileRedesign()
  return mobileRedesign ? <SettingsPage /> : <Navigate to="/" replace />
}
