import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import App from './App'
import { initAppearance } from '@/stores/appearance-store'
import '@/app/globals.css'

// 首屏脚本已经写好主题 class，这里同步 store 状态并接管系统主题变化。
initAppearance()

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
