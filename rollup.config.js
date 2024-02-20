import resolve from '@rollup/plugin-node-resolve'
import typescript from '@rollup/plugin-typescript'
import commonjs from '@rollup/plugin-commonjs'
import swc from '@rollup/plugin-swc'
import copy from 'rollup-plugin-copy'
import path from 'node:path'
import {sync as globFiles} from 'glob'

const normalizeString = (str) => Buffer.from(str).filter((v, i) => i ? true : v !== 0).toString()
const currentWorkingDir = normalizeString(process.cwd())
const thirdPartyPackageRootDirname = 'modules'
const outputDirname = 'distro'
const jsrcOutputDirname = path.join(outputDirname, 'src')

export default {
    input: globFiles('src/**/*.ts'),
    output: {
        format: 'esm',
        dir: outputDirname,
        exports: 'named',
        compact: false,//减小文件体积
        preserveEntrySignatures: 'allow-extension',
        esModule: true,
        // validate: true,
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
            // console.log(filename, extname)
            switch (extname) {
                case '.ts':
                    return path.join(dirname, `${path.basename(chunkInfo.name, extname)}.js`)
                case '.js':
                    return chunkInfo.name
                case '.js_commonjs-proxy':
                    return path.join(dirname, `${path.basename(chunkInfo.name, extname)}.proxy.js`)
                case '.js_commonjs-exports':
                    return path.join(dirname, `${path.basename(chunkInfo.name, extname)}.exports.js`)
                case '.js_commonjs-module':
                    return path.join(dirname, `${path.basename(chunkInfo.name, extname)}.module.js`)
                default:
                    return !extname ? `${chunkInfo.name}.js` : path.join(dirname, `${path.basename(chunkInfo.name, extname)}.def.js`)
            }
        }
    },
    treeshake: false,
    plugins: [
        resolve(),
        commonjs({include: /node_modules/}),
        typescript({
            outDir: jsrcOutputDirname,
            esModuleInterop: true,
            isolatedModules: true,
            declaration: true,
            emitDecoratorMetadata: true,
            declarationMap: true,
            allowSyntheticDefaultImports: true
        }),
        swc(),
        copy({
            targets: [
                {src: 'src/cpp/**/*', dest: path.join(jsrcOutputDirname, 'cpp')},
                {src: 'binding.gyp', dest: outputDirname}
            ]
        })
    ]
}
