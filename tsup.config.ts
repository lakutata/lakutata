import {defineConfig} from 'tsup'

export default defineConfig((options) => {
    console.log(options)
    return {
        // target: 'node16',
        entry: [
            // 'src/**/*'
            'src/Lakutata.ts'
        ],
        cjsInterop: true,
        legacyOutput: false,
        skipNodeModulesBundle: true,
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
        // bundle:false,
        // noExternal: [/.*/, 'pino-pretty'],
        noExternal: [
            /\@hapi/,
            'browserify-cipher',
            'camel-case',
            'convert-units',
            'crypto-api-v1',
            'crypto-js',
            'eslint',
            'extra-promise',
            'fast-glob',
            'is-glob',
            'joi',
            'moment-timezone',
            'object-hash',
            'patrun',
            'pino',
            'pino-pretty',
            'pupa',
            'randomstring',
            'sm-crypto-v2',
            'sort-array',
            'sort-keys'],
        // external: ['@types/node'],
        // minify: 'terser',
        minify: false,
        terserOptions: {
            mangle: false,
            compress: true
        }
        //     banner: {
        //         js: `
        // import path from 'path';
        // import { fileURLToPath } from 'url';
        // import { createRequire as topLevelCreateRequire } from 'module';
        // const require = topLevelCreateRequire(import.meta.url);
        // const __filename = fileURLToPath(import.meta.url);
        // const __dirname = path.dirname(__filename);
        // `
        //     }
    }
})

