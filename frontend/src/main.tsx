import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Provider } from 'react-redux'
import { BrowserRouter } from 'react-router'
import './index.css'
import App from './App.tsx'
import { store } from './store/store'
import { applyFeatureFlagQuery } from './mobile/flag'

// ?ff=mobile / ?ff=off: per-browser switch for the mobile redesign.
applyFeatureFlagQuery()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Provider store={store}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </Provider>
  </StrictMode>,
)
