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
        },
        banner: {
            js: `
    import path from 'path';
    import { fileURLToPath } from 'url';
    import { createRequire as topLevelCreateRequire } from 'module';
    const require = topLevelCreateRequire(import.meta.url);
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    `
        }
    }
})
