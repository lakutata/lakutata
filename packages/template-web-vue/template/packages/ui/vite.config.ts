import {defineConfig} from 'vite'
import vue from '@vitejs/plugin-vue'

//In development, the API is the one of the service started by "npm run dev"
export default defineConfig({
    plugins: [vue()],
    server: {
        proxy: {
            '/api': `http://127.0.0.1:${process.env.PORT ?? 8080}`
        }
    }
})
