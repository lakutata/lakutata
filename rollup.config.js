import resolve from '@rollup/plugin-node-resolve'
import typescript from '@rollup/plugin-typescript'
import commonjs from '@rollup/plugin-commonjs'
import json from '@rollup/plugin-json'
import copy from 'rollup-plugin-copy'
import progress from 'rollup-plugin-progress'
import path from 'node:path'
import {sync as globFiles} from 'glob'
import {dts} from 'rollup-plugin-dts'
import {builtinModules} from 'node:module'

const normalizeString = (str) => Buffer.from(str).filter((v, i) => i ? true : v !== 0).toString()
const currentWorkingDir = normalizeString(process.cwd())
const thirdPartyPackageRootDirname = 'vendor'
const outputDirname = 'distro'
const jsrcOutputDirname = path.join(outputDirname, 'src')

let jsVendorNumber = 0
const jsVendorMap = new Map()
const jsChunkNameGenerator = (chunkName) => {
    if (!jsVendorMap.has(chunkName)) jsVendorMap.set(chunkName, ++jsVendorNumber)
    return `${thirdPartyPackageRootDirname}/Package.${jsVendorMap.get(chunkName) || 0}`
}

let dtsVendorNumber = 0
const dtsVendorMap = new Map()
const dtsChunkNameGenerator = (chunkName) => {
    if (!dtsVendorMap.has(chunkName)) dtsVendorMap.set(chunkName, ++dtsVendorNumber)
    return `${thirdPartyPackageRootDirname}/TypeDef.${dtsVendorMap.get(chunkName) || 0}`
}

export default [
    {
        input: globFiles('src/**/*.ts'),
        output: {
            format: 'esm',
            dir: outputDirname,
            exports: 'named',
            compact: true,//减小文件体积
            interop: 'auto',
            generatedCode: 'es2015',
            entryFileNames: (chunkInfo) => {
                const facadeModuleId = normalizeString(chunkInfo.facadeModuleId)
                const relativeDir = path.relative(currentWorkingDir, path.dirname(facadeModuleId))
                return path.join(relativeDir, `${chunkInfo.name}.js`)
            },
            chunkFileNames: (chunkInfo) => {
                if (!chunkInfo.name.startsWith(thirdPartyPackageRootDirname)) chunkInfo.name = jsChunkNameGenerator(chunkInfo.name)
                return `${chunkInfo.name}.js`
            }
        },
        makeAbsoluteExternalsRelative: true,
        treeshake: false,
        plugins: [
            resolve({
                browser: false,
                preferBuiltins: true
            }),
            typescript({
                outDir: jsrcOutputDirname,
                esModuleInterop: true,
                isolatedModules: true,
                declaration: false,
                emitDecoratorMetadata: true,
                declarationMap: false,
                allowSyntheticDefaultImports: true,
                allowJs: true
            }),
            commonjs(),
            json(),
            copy({
                targets: [
                    {src: 'src/cpp/**/*', dest: path.join(jsrcOutputDirname, 'cpp')},
                    {src: 'binding.gyp', dest: outputDirname}
                ]
            }),
            progress({clearLine: true})
        ]
    }, {
        input: globFiles('src/**/*.ts'),
        output: {
            format: 'esm',
            dir: outputDirname,
            entryFileNames: (chunkInfo) => `${chunkInfo.name}.d.ts`,
            chunkFileNames: (chunkInfo) => {
                if (!chunkInfo.name.startsWith(thirdPartyPackageRootDirname)) chunkInfo.name = dtsChunkNameGenerator(chunkInfo.name, 'type.')
                return `${chunkInfo.name}.d.ts`
            }
        },
        plugins: [
            dts({
                respectExternal: true,
                compilerOptions: {
                    outDir: outputDirname
                }
            }),
            progress({clearLine: true})
        ],
        external: [
            ...builtinModules
        ]
    }
]
