import resolve from '@rollup/plugin-node-resolve'
import typescript from '@rollup/plugin-typescript'
import commonjs from '@rollup/plugin-commonjs'
import swc from '@rollup/plugin-swc'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {createHash} from 'crypto'

const normalizeString = (str) => Buffer.from(str).filter((value, index) => index ? true : value !== 0).toString()
const currentWorkingDir = normalizeString(process.cwd())
const thirdPartyPackageRootDirname = 'modules'

export default {
    input: ['src/Lakutata.ts'],
    // input: ['src/Lakutata.ts', 'src/tests/App.spec.ts'],
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
        }
    },
    plugins: [
        resolve(),
        commonjs({ignoreDynamicRequires: false}),
        typescript({
            outDir: 'build',
            declaration: true,
            emitDecoratorMetadata: true,
            declarationMap: true
        }),
        swc()
    ]
}
