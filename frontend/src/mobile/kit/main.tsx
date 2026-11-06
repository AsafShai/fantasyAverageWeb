import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import '../../index.css'
import MobileKit from './MobileKit'

if (new URLSearchParams(window.location.search).get('dark') === '1') {
  document.documentElement.classList.add('dark')
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <MobileKit />
    </BrowserRouter>
  </StrictMode>,
)
