import resolve from '@rollup/plugin-node-resolve'
import typescript from '@rollup/plugin-typescript'
import commonjs from '@rollup/plugin-commonjs'
import swc from '@rollup/plugin-swc'
import esmShim from '@rollup/plugin-esm-shim'
import copy from 'rollup-plugin-copy'
import path from 'node:path'
import {sync as globFiles} from 'glob'

const normalizeString = (str) => Buffer.from(str).filter((v, i) => i ? true : v !== 0).toString()
const currentWorkingDir = normalizeString(process.cwd())
// const thirdPartyPackageRootDirname = 'modules'
const thirdPartyPackageRootDirname = 'vendor'
const outputDirname = 'distro'
const jsrcOutputDirname = path.join(outputDirname, 'src')

export default {
    input: globFiles('src/**/*.ts'),
    output: {
        format: 'esm',
        dir: outputDirname,
        exports: 'auto',
        compact: false,//减小文件体积
        interop: 'auto',
        generatedCode: 'es2015',
        manualChunks: (id) => {
            if (id.includes('node_modules')) {
                const absPath = path.dirname(normalizeString(id))
                let nodeModulesFound = false
                const dirnames = absPath.split(path.sep).filter(value => {
                    let dirname = value.trim()
                    if (!dirname) return false
                    if (nodeModulesFound) return true
                    if (dirname === 'node_modules') nodeModulesFound = true
                    return dirname === 'node_modules'
                })
                let chunkName = dirnames[1]
                return `vendor/${chunkName}`
            }
        },
        entryFileNames: (chunkInfo) => {
            const facadeModuleId = normalizeString(chunkInfo.facadeModuleId)
            const relativeDir = path.relative(currentWorkingDir, path.dirname(facadeModuleId))
            return path.join(relativeDir, `${chunkInfo.name}.js`)
        }
        // chunkFileNames: (chunkInfo,b,c) => {
        //     console.log(chunkInfo,b,c)
        //     const dirname = path.dirname(chunkInfo.name)
        //     const extname = path.extname(chunkInfo.name)
        //     const filename = path.basename(chunkInfo.name)
        //     return path.join('src/vendor',dirname, `${filename}.js`)
        //     // console.log(filename, extname)
        //     // switch (extname) {
        //     //     case '.ts':
        //     //         return path.join(dirname, `${path.basename(chunkInfo.name, extname)}.js`)
        //     //     case '.js':
        //     //         return chunkInfo.name
        //     //     case '.js_commonjs-proxy':
        //     //         return path.join(dirname, `${path.basename(chunkInfo.name, extname)}.proxy.js`)
        //     //     case '.js_commonjs-exports':
        //     //         return path.join(dirname, `${path.basename(chunkInfo.name, extname)}.exports.js`)
        //     //     case '.js_commonjs-module':
        //     //         return path.join(dirname, `${path.basename(chunkInfo.name, extname)}.module.js`)
        //     //     default:
        //     //         return !extname ? `${chunkInfo.name}.js` : path.join(dirname, `${path.basename(chunkInfo.name, extname)}.def.js`)
        //     // }
        // }
    },
    treeshake: false,
    plugins: [
        resolve(),
        esmShim(),
        typescript({
            outDir: jsrcOutputDirname,
            esModuleInterop: true,
            isolatedModules: true,
            declaration: true,
            emitDecoratorMetadata: true,
            declarationMap: true,
            allowSyntheticDefaultImports: true,
            allowJs: true
        }),
        commonjs({
            esmExternals: true,
            requireReturnsDefault: 'auto'
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
