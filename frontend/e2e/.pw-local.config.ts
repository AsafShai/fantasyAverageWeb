import base from './playwright.config'
export default { ...base, workers: 4, use: { ...base.use, launchOptions: { executablePath: '/opt/pw-browsers/chromium' } } }
