import { createRoot } from 'react-dom/client'
import { App } from '@/app'
import { desktopName } from '../app-name'
import './styles.css'

const rootElement = document.getElementById('root')
if (!rootElement) {
  throw new Error('找不到应用根节点')
}
const root = rootElement

function showRendererError(error: unknown) {
  if (!root.querySelector('#boot-status')) return
  const message = error instanceof Error ? error.message : String(error)
  const fallback = document.createElement('div')
  fallback.className = 'grid h-svh place-items-center p-6 text-center'
  const details = document.createElement('div')
  details.className = 'grid max-w-lg justify-items-center gap-3 text-sm'
  const title = document.createElement('strong')
  title.textContent = `${desktopName}启动失败`
  const reason = document.createElement('span')
  reason.className = 'text-muted-foreground'
  reason.textContent = message
  const reload = document.createElement('button')
  reload.type = 'button'
  reload.className = 'rounded-lg border px-4 py-2'
  reload.textContent = '重新加载'
  reload.addEventListener('click', () => location.reload())
  details.append(title, reason, reload)
  fallback.append(details)
  root.replaceChildren(fallback)
}

window.addEventListener('error', (event) => showRendererError(event.error || event.message))
window.addEventListener('unhandledrejection', (event) => showRendererError(event.reason))

try {
  localStorage.removeItem('travel-sidebar-width')
  localStorage.removeItem('travel-work-panel-width')
} catch {
  // Legacy storage may be unavailable in a fresh renderer profile.
}

try {
  createRoot(root).render(<App />)
} catch (error) {
  showRendererError(error)
}
