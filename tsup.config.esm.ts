import {defineConfig} from 'tsup'

export default defineConfig(() => {
    return {
        entry: [
            'src/Lakutata.ts'
        ],
        legacyOutput: false,
        skipNodeModulesBundle: true,
        platform: 'node',
        sourcemap: false,
        clean: true,
        splitting: true,
        dts: {
            resolve: true
        },
        format: 'esm',
        shims: false,
        outDir: './build/esm',
        keepNames: true,
        noExternal: [/./],
        external: [/@types/, 'tslib'],
        // minify: false,
        minify: 'terser',
        terserOptions: {
            keep_classnames: true,
            mangle: false,
            compress: true
        },
        banner: {
            js: 'const require = await import(\'module\').then($=>$.createRequire(import.meta.url))'
        }
    }
})
