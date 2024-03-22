import {rollup} from 'rollup'
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
import {mkdir, readFile, writeFile} from 'node:fs/promises'
import {fileURLToPath} from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const normalizeString = (str) => Buffer.from(str).filter((v, i) => i ? true : v !== 0).toString()
const currentWorkingDir = normalizeString(process.cwd())
const thirdPartyPackageRootDirname = 'vendor'
const outputDirname = 'distro'
const absoluteOutputDirname = path.resolve(__dirname, outputDirname)
const jsrcOutputDirname = path.join(outputDirname, 'src')

let jsVendorNumber = 0
let dtsVendorNumber = 0
const jsVendorMap = new Map()
const dtsVendorMap = new Map()
/**
 * Generate JS chunk name
 * @param chunkName {string}
 * @return {`vendor/Package.${any}`|'vendor/Package.0'}
 */
const jsChunkNameGenerator = (chunkName) => {
    if (!jsVendorMap.has(chunkName)) jsVendorMap.set(chunkName, ++jsVendorNumber)
    return `${thirdPartyPackageRootDirname}/Package.${jsVendorMap.get(chunkName) || 0}`
}
/**
 * Generate DTS chunk name
 * @param chunkName {string}
 * @return {`vendor/TypeDef.${any}`|'vendor/TypeDef.0'}
 */
const dtsChunkNameGenerator = (chunkName) => {
    if (!dtsVendorMap.has(chunkName)) dtsVendorMap.set(chunkName, ++dtsVendorNumber)
    return `${thirdPartyPackageRootDirname}/TypeDef.${dtsVendorMap.get(chunkName) || 0}`
}
/**
 * Process package.json
 * @param packageJsonFilename {string}
 * @return {Promise<void>}
 */
const processPackageJson = async (packageJsonFilename) => {
    const packageJsonObject = JSON.parse(await readFile(packageJsonFilename, {encoding: 'utf-8'}))
    Reflect.deleteProperty(packageJsonObject, 'devDependencies')
    Reflect.deleteProperty(packageJsonObject, 'scripts')
    await writeFile(packageJsonFilename, JSON.stringify(packageJsonObject, null, 2), {encoding: 'utf-8', flag: 'w'})
}
/**
 * Process tsconfig.json
 * @param tsconfigJsonFilename {string}
 * @return {Promise<void>}
 */
const processTsConfigJson = async (tsconfigJsonFilename) => {
    const tsconfigJsonObject = JSON.parse(await readFile(tsconfigJsonFilename, {encoding: 'utf-8'}))
    Reflect.deleteProperty(tsconfigJsonObject.compilerOptions, 'rootDir')
    Reflect.deleteProperty(tsconfigJsonObject.compilerOptions, 'outDir')
    Reflect.deleteProperty(tsconfigJsonObject, 'exclude')
    await writeFile(tsconfigJsonFilename, JSON.stringify(tsconfigJsonObject, null, 2), {encoding: 'utf-8', flag: 'w'})
}

/**
 * Process bundles
 * @return {Promise<void>}
 */
async function processBundles() {
    /**
     * Write file promises
     * @type {Promise[]}
     */
    const writeFilePromises = []

    /**
     * Generate output files
     * @param bundle
     * @param outputOptions
     * @return {Promise}
     */
    async function generateOutputs(bundle, outputOptions) {
        const {output} = await bundle.generate(outputOptions)
        for (const chunkOrAsset of output) {
            writeFilePromises.push(new Promise((writeFileResolve, writeFileReject) => {
                const filename = path.resolve(__dirname, outputDirname, chunkOrAsset.fileName)
                mkdir(path.dirname(filename), {recursive: true}).then(() => {
                    if (chunkOrAsset.type === 'asset') {
                        //asset
                        return writeFile(filename, chunkOrAsset.source).then(writeFileResolve).catch(writeFileReject)
                    } else {
                        return writeFile(filename, chunkOrAsset.code, {encoding: 'utf-8'}).then(writeFileResolve).catch(writeFileReject)
                    }
                }).catch(writeFileReject)
            }))
        }
    }

    /**
     * Generate bundles
     */
    await Promise.all([
        new Promise((jsBundleResolve, jsBundleReject) => {
            return rollup(jsBundleOptions).then(jsBundle => {
                return generateOutputs(jsBundle, jsBundleOptions.output).then(jsBundleResolve).catch(jsBundleReject)
            }).catch(jsBundleReject)
        }),
        new Promise((dtsBundleResolve, dtsBundleReject) => {
            return rollup(dtsBundleOptions).then(dtsBundle => {
                return generateOutputs(dtsBundle, dtsBundleOptions.output).then(dtsBundleResolve).catch(dtsBundleReject)
            }).catch(dtsBundleReject)
        })
    ])
    /**
     * Write files
     */
    await Promise.all(writeFilePromises)
}

//===================================Configurations===================================
/**
 * Log level
 * @type {'warn' | 'info' | 'debug' | 'silent' | undefined}
 */
const logLevel = 'silent'
/**
 * Output format
 * @type {'amd' | 'cjs' | 'es' | 'iife' | 'system' | 'umd' | 'commonjs' | 'esm' | 'module' | 'systemjs' | undefined}
 */
const format = 'esm'
/**
 * Output format
 * @type {Array.<{src: string, dest: string}>}
 */
const copyTargets = [
    {src: 'src/cpp/**/*', dest: path.join(jsrcOutputDirname, 'cpp')},
    {src: 'binding.gyp', dest: outputDirname},
    {src: 'LICENSE', dest: outputDirname},
    {src: 'package.json', dest: outputDirname},
    {src: 'tsconfig.json', dest: outputDirname}
]
/**
 * Javascript bundle options
 * @type {RollupOptions}
 */
const jsBundleOptions = {
    logLevel: logLevel,
    input: globFiles('src/**/*.ts'),
    output: {
        format: format,
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
        progress({clearLine: true}),
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
        json()
    ]
}
/**
 * DTS bundle options
 * @type {RollupOptions}
 */
const dtsBundleOptions = {
    logLevel: logLevel,
    input: globFiles('src/**/*.ts'),
    output: {
        format: format,
        dir: outputDirname,
        entryFileNames: (chunkInfo) => `${chunkInfo.name}.d.ts`,
        chunkFileNames: (chunkInfo) => {
            if (!chunkInfo.name.startsWith(thirdPartyPackageRootDirname)) chunkInfo.name = dtsChunkNameGenerator(chunkInfo.name, 'type.')
            return `${chunkInfo.name}.d.ts`
        }
    },
    plugins: [
        progress({clearLine: true}),
        dts({
            respectExternal: true,
            compilerOptions: {
                outDir: outputDirname
            }
        }),
        copy({targets: copyTargets})
    ],
    external: [
        ...builtinModules
    ]
}

//===================================Configurations===================================

/**
 * Process bundles
 */
await processBundles()
/**
 * Process package.json
 */
await processPackageJson(path.resolve(absoluteOutputDirname, 'package.json'))
/**
 * Process tsconfig.json
 */
await processTsConfigJson(path.resolve(absoluteOutputDirname, 'tsconfig.json'))
