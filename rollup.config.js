import resolve from '@rollup/plugin-node-resolve'
import typescript from '@rollup/plugin-typescript'
import commonjs from '@rollup/plugin-commonjs'
import json from '@rollup/plugin-json'
import copy from 'rollup-plugin-copy'
import progress from 'rollup-plugin-progress'
import path from 'node:path'
import {sync as globFiles} from 'glob'
import {dts} from 'rollup-plugin-dts'
import { builtinModules } from 'node:module'

const normalizeString = (str) => Buffer.from(str).filter((v, i) => i ? true : v !== 0).toString()
const currentWorkingDir = normalizeString(process.cwd())
const thirdPartyPackageRootDirname = 'vendor'
const outputDirname = 'distro'
const jsrcOutputDirname = path.join(outputDirname, 'src')

let vendorNumber = 0
const vendorMap = new Map()
const chunkNameGenerator = (chunkName) => {
    if (!vendorMap.has(chunkName)) vendorMap.set(chunkName, ++vendorNumber)
    return `${thirdPartyPackageRootDirname}/package${vendorMap.get(chunkName) || 0}`
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
                if (!chunkInfo.name.startsWith(thirdPartyPackageRootDirname)) chunkInfo.name = chunkNameGenerator(chunkInfo.name)
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
                // declaration: true,
                declaration: false,
                emitDecoratorMetadata: true,
                declarationMap: false,
                // declarationMap: true,
                allowSyntheticDefaultImports: true,
                allowJs: true
            }),
            dts(),
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
            exports: 'named',
            compact: true,//减小文件体积
            interop: 'auto',
            generatedCode: 'es2015',
            entryFileNames: (chunkInfo) => {
                console.log(chunkInfo)
                const facadeModuleId = normalizeString(chunkInfo.facadeModuleId)
                const relativeDir = path.relative(currentWorkingDir, path.dirname(facadeModuleId))
                return path.join(relativeDir, `${chunkInfo.name}.d.ts`)
            }
        },
        plugins: [
            dts({respectExternal: true})
        ],
        external: [
            ...builtinModules
        ]
    }
]
