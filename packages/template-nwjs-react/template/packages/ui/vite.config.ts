import {defineConfig} from 'vite'
import react from '@vitejs/plugin-react'
import nwjs from '../app/nwjs.json' with {type: 'json'}

/**
 * The Chromium of the NW.js of the application (packages/app/nwjs.json, written by lakutata nwjs use): the pages are
 * built for it
 */
const target: string = `chrome${nwjs.chromium.split('.')[0]}`

//The pages are loaded from the files of the application: their paths are relative
export default defineConfig({
    base: './',
    build: {target: target, cssTarget: target},
    plugins: [react()]
})
