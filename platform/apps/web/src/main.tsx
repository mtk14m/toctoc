import '@fontsource-variable/bricolage-grotesque'
import '@fontsource-variable/figtree'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ApiProvider } from './api/ApiProvider'
import { createApiClient } from './api/client'
import { App } from './App'
import { apiBaseUrl } from './config'
import './styles/tokens.css'
import './styles/base.css'

const root = document.getElementById('root')
if (!root) throw new Error('#root introuvable dans index.html')

createRoot(root).render(
  <StrictMode>
    <ApiProvider client={createApiClient({ baseUrl: apiBaseUrl })}>
      <App />
    </ApiProvider>
  </StrictMode>,
)
