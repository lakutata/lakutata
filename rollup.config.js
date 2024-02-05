import resolve from '@rollup/plugin-node-resolve'
import typescript from '@rollup/plugin-typescript'
import commonjs from '@rollup/plugin-commonjs'
import swc from '@rollup/plugin-swc'
import path from 'node:path'

const normalizeString = (str) => Buffer.from(str).filter((v, i) => i ? true : v !== 0).toString()
const currentWorkingDir = normalizeString(process.cwd())
const thirdPartyPackageRootDirname = 'modules'

export default {
    input: ['src/Lakutata.ts'],
    output: {
        format: 'esm',
        dir: 'build',
        // preserveModules: true,
        sourcemap: true,
        manualChunks: (id) => {
            const basename = path.basename(id)
            const dirname = normalizeString(path.dirname(id))
            let relativeId
            if (path.isAbsolute(dirname)) {
                let relativeDir = path.relative(currentWorkingDir, dirname)
                if (relativeDir.startsWith('node_modules')) {
                    relativeDir = relativeDir.replace('node_modules', thirdPartyPackageRootDirname)
                }
                relativeId = path.join(relativeDir, basename)
            } else {
                relativeId = path.join(thirdPartyPackageRootDirname, basename)
            }
            return relativeId
        },
        entryFileNames: (chunkInfo) => {
            const facadeModuleId = normalizeString(chunkInfo.facadeModuleId)
            const relativeDir = path.relative(currentWorkingDir, path.dirname(facadeModuleId))
            return path.join(relativeDir, `${chunkInfo.name}.js`)
        },
        chunkFileNames: '[name].js'
    },
    plugins: [
        resolve(),
        commonjs({ignoreDynamicRequires: false}),
        typescript({
            outDir: 'build/src',
            declaration: true,
            emitDecoratorMetadata: true,
            declarationMap: true
        }),
        swc()
    ]
}
