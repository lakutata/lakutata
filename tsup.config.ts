import {defineConfig} from 'tsup'
import fixCjsExports from 'tsup-fix-cjs-exports'

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
        skipNodeModulesBundle: false,
        platform: 'node',
        sourcemap: false,
        clean: true,
        splitting: true,
        // @ts-ignore
        plugins: [fixCjsExports()],
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
        noExternal: [/.*/, 'pino-pretty'],
        // external: [],
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
