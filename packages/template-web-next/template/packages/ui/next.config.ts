import type {NextConfig} from 'next'

//The standalone build is the one the application packed serves (server/standalone.ts, lakutata.resources of the app package)
const nextConfig: NextConfig = {output: 'standalone'}

export default nextConfig
