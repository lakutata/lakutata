//The service serves the build of Nitro as a request listener (renderUI); in development, nuxt dev gives /api to the service
export default defineNuxtConfig({
    compatibilityDate: '2026-09-01',
    nitro: {
        preset: 'node-listener',
        devProxy: {
            '/api': {target: `http://127.0.0.1:${process.env.PORT ?? 8080}/api`, changeOrigin: true}
        }
    }
})
