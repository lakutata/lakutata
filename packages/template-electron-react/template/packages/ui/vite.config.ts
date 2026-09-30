import {defineConfig} from 'vite'
import react from '@vitejs/plugin-react'

//The pages are loaded from the files of the packaged application: their paths are relative
export default defineConfig({
    base: './',
    plugins: [react()]
})
