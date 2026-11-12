import audio from './audio'
import about from './about'
import { general, library } from './general'
import home from './home'
import plugins from './plugins'
import profile from './accounts/profile'
import accounts from './accounts'
import pairing from './accounts/pairing'

// Everyone's panes first, then what only an admin sees. Audio sat below the
// whole admin Library before, though every user has it. It goes AFTER the
// account panes: those have no heading of their own, and placed below the
// "Audio" heading they read as part of it.
export default [general, home, profile, pairing, accounts, audio, library, plugins, about]
