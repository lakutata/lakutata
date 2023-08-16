import {defineConfig} from 'tsup'

export default defineConfig((options) => {
    console.log(options)
    return {
        entry: [
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
        noExternal: [/./],
        external: [/@types/, 'tslib'],
        // minify: 'terser',
        minify: false,
        terserOptions: {
            mangle: false,
            compress: true
        },
        banner: {
            js: 'const require = await import(\'module\').then($=>$.createRequire(import.meta.url))'
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

