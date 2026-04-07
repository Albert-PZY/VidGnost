import '@testing-library/jest-dom/vitest'
import { vi } from 'vitest'
import '../i18n'

if (!window.HTMLElement.prototype.scrollIntoView) {
  Object.defineProperty(window.HTMLElement.prototype, 'scrollIntoView', {
    value: vi.fn(),
    writable: true,
  })
}
