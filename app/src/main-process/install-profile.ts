import { app } from 'electron'
import {
  DesktopProfileEnvironmentKey,
  getDesktopProfileFromArgs,
  getUserDataPathForProfile,
} from '../lib/desktop-profile'

// This must run before anything reads the user data path (logging, the
// single instance lock, local storage), so it's imported first in main.ts.
const profile = getDesktopProfileFromArgs(process.argv, process.env)
if (profile !== null) {
  app.setPath(
    'userData',
    getUserDataPathForProfile(app.getPath('userData'), profile)
  )
  // Renderer processes inherit the environment and read the profile from it.
  process.env[DesktopProfileEnvironmentKey] = profile
} else {
  delete process.env[DesktopProfileEnvironmentKey]
}
