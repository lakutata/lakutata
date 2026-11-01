import {defineConfig} from 'vite'
import vue from '@vitejs/plugin-vue'

/**
 * The web views the pages run in: the WKWebView of iOS 15, the WebView of Android 7 (Chromium, updated by the system)
 */
const target: string[] = ['chrome87', 'safari15']

//The pages are loaded from the files of the application (Capacitor): their paths are relative
export default defineConfig({
    base: './',
    build: {target: target, cssTarget: target},
    plugins: [vue()]
})
