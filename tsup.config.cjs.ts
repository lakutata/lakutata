import {defineConfig} from 'tsup'

export default defineConfig(() => {
    return {
        entry: [
            'src/ReflectMetadata.ts',
            'src/Lakutata.ts',
            'src/ORM.ts',
            'src/Crypto.ts',
            'src/Hash.ts',
            'src/Helper.ts'
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
        outDir: './build',
        keepNames: true,
        noExternal: [/./],
        external: [/@types/, 'tslib', 'ts-node', 'typescript', 'shx', 'release-it'],
        //此处不可使用minify，否则在框架层报错时会将整个框架源码在控制台输出
        minify: false
    }
})
