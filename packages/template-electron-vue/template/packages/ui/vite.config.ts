import {defineConfig} from 'vite'
import vue from '@vitejs/plugin-vue'

//The pages are loaded from the files of the packaged application: their paths are relative
export default defineConfig({
    base: './',
    plugins: [vue()]
})
