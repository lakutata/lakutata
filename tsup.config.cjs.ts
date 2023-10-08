import {defineConfig} from 'tsup'

export default defineConfig(() => {
    return {
        entry: {
            'ReflectMetadata': 'src/ReflectMetadata.ts',
            'Lakutata': 'src/Lakutata.ts',
            'ORM': 'src/ORM.ts',
            'Crypto': 'src/Crypto.ts',
            'Hash': 'src/Hash.ts',
            'Helper': 'src/Helper.ts',
            'CLI': 'src/CLI.ts',
            'ProcessContainer': 'src/ProcessContainer.ts',
            'ThreadContainer': 'src/ThreadContainer.js',
            'worker': 'node_modules/piscina/dist/src/worker.js'
        },
        // cjsInterop: true,
        target: 'es2020',
        bundle: true,
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
        outDir: './build',
        keepNames: true,
        noExternal: [/./],
        external: ['tslib', 'ts-node', 'typescript', 'shx', 'release-it'],
        //此处不可使用minify，否则在框架层报错时会将整个框架源码在控制台输出
        minify: false,
        silent: true
    }
})
