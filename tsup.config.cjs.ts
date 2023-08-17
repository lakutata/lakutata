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
        format: 'cjs',
        shims: false,
        outDir: './build/cjs',
        keepNames: true,
        noExternal: [/./],
        external: [/@types/, 'tslib'],
        minify: 'terser',
        terserOptions: {
            keep_classnames: true,
            mangle: false,
            compress: true
        }
    }
})
