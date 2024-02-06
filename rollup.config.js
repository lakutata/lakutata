import resolve from '@rollup/plugin-node-resolve'
import typescript from '@rollup/plugin-typescript'
import commonjs from '@rollup/plugin-commonjs'
import swc from '@rollup/plugin-swc'
import path from 'node:path'
import {sync as globFiles} from 'glob'

const normalizeString = (str) => Buffer.from(str).filter((v, i) => i ? true : v !== 0).toString()
const currentWorkingDir = normalizeString(process.cwd())
const thirdPartyPackageRootDirname = 'modules'

export default {
    input: globFiles('src/**/*.ts'),
    output: {
        format: 'esm',
        dir: 'distro',
        exports: 'named',
        compact: false,//减小文件体积
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
        chunkFileNames: (chunkInfo) => {
            const dirname = path.dirname(chunkInfo.name)
            const extname = path.extname(chunkInfo.name)
            const filename = path.basename(chunkInfo.name)
            switch (extname) {
                case '.ts':
                    return path.join(dirname, `${path.basename(chunkInfo.name, extname)}.js`)
                case '.js':
                    return chunkInfo.name
                default:
                    return `${chunkInfo.name}.js`
            }
        }
    },
    treeshake: false,
    plugins: [
        resolve(),
        commonjs(),
        typescript({
            outDir: 'distro/src',
            esModuleInterop: true,
            isolatedModules: true,
            declaration: true,
            emitDecoratorMetadata: true,
            declarationMap: true
        }),
        swc()
    ]
}
