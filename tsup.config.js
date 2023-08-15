import {defineConfig} from 'tsup'

export default defineConfig((options) => {
    return {
        target: 'node16',
        entry: [
            'src/**/*'
        ],
        // cjsInterop: true,
        legacyOutput: false,
        skipNodeModulesBundle: false,
        platform: 'node',
        sourcemap: 'inline',
        clean: true,
        splitting: true,
        dts: {
            resolve: true
        },
        format: [
            'esm',
            'cjs'
        ],
        shims: true,
        treeshake: true,
        outDir: './build',
        keepNames: true,
        noExternal: [/.*/],
        external: [],
        minify: false,
        terserOptions: {
            mangle: false,
            compress: true
        }
    }
})
