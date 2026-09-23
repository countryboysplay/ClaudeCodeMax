/// <reference types="vite/client" />
import type { Api } from '../../preload'

declare global {
  interface Window {
    api: Api
  }
  namespace JSX {
    interface IntrinsicElements {
      webview: React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & { src?: string }
    }
  }
}

export {}
