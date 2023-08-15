import {defineConfig} from 'tsup'

export default defineConfig((options) => {
    return {
        // target: 'node16',
        entry: [
            'src/**/*'
        ],
        // cjsInterop: true,
        legacyOutput: false,
        skipNodeModulesBundle: false,
        platform: 'node',
        sourcemap: false,
        clean: true,
        splitting: true,
        dts: {
            resolve: true
        },
        format: [
            'esm',
            'cjs'
        ],
        shims: false,
        outDir: './build',
        keepNames: true,
        noExternal: [/.*/],
        external: [],
        minify: true,
        terserOptions: {
            mangle: false,
            compress: true
        }
    }
})
