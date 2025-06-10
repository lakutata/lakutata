import {rollup} from 'rollup'
import resolve from '@rollup/plugin-node-resolve'
import typescript from '@rollup/plugin-typescript'
import commonjs from '@rollup/plugin-commonjs'
import json from '@rollup/plugin-json'
import terser from '@rollup/plugin-terser'
import esmShim from '@rollup/plugin-esm-shim'
import copy from 'rollup-plugin-copy'
import progress from 'rollup-plugin-progress'
import path from 'node:path'
import {sync as globFiles} from 'glob'
import {dts} from 'rollup-plugin-dts'
import {builtinModules} from 'node:module'
import {mkdir, readFile, writeFile} from 'node:fs/promises'
import {fileURLToPath} from 'node:url'
import os from 'os'
import {createRequire} from 'module'
import packageJson from './package.json' with {type: 'json'}
import * as fs from 'node:fs'

const isProductionBuild = process.env.BUILD_MODE === 'production'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const require = createRequire(__filename)

const removeShebang = () => ({
    name: 'rollup-plugin-remove-shebang',
    transform: (code, id) => {
        return code.replace('#!/usr/bin/env node', '')
    }
})

const normalizeString = (str) => Buffer.from(str).filter((v, i) => i ? true : v !== 0).toString()
const currentWorkingDir = normalizeString(process.cwd())
const thirdPartyPackageRootDirname = 'vendor'
const outputDirname = 'distro'
const absoluteOutputDirname = path.resolve(__dirname, outputDirname)
const jsrcOutputDirname = path.join(outputDirname, 'src')
const packageName = packageJson.name
const packageJsonExports = {...packageJson.exports}

const exportMap = new Map()
/**
 * Get output filename (without path)
 * @param name
 */
const getOutputFilename = (name) => {
    if (!exportMap.size) Object
        .keys(packageJsonExports)
        .map(exportName => {
            const exportFilename = packageJsonExports[exportName]
            return path.extname(exportFilename) !== '.json' ? {
                exportName: exportName === '.' ? `./${packageName}` : exportName,
                filename: path.basename(exportFilename, path.extname(exportFilename))
            } : null
        })
        .filter(value => !!value)
        .forEach(exportConfig => exportMap.set(exportConfig.filename, exportConfig.exportName))
    const exportName = exportMap.get(name)
    if (!exportName) return name
    return exportName.toString().replace('./', '')
}

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
 * @param outputFormats {('cjs'|'esm')[]}
 * @return {Promise<void>}
 */
const processPackageJson = async (packageJsonFilename, outputFormats = []) => {
    const packageJsonObject = {...packageJson}
    const packageJsonObjectExports = packageJsonObject.exports
    Object.keys(packageJsonObjectExports).forEach(exportName => {
        const sourceFilename = packageJsonObjectExports[exportName]
        if (path.extname(sourceFilename) === '.json') return
        const exportFile = exportName === '.' ? `./${packageName}` : exportName
        packageJsonObjectExports[exportName] = {
            types: `${exportFile}.d.ts`
        }
        outputFormats.forEach(format => {
            switch (format) {
                case 'cjs': {
                    packageJsonObjectExports[exportName].require = `${exportFile}.cjs`
                }
                    break
                case 'esm': {
                    packageJsonObjectExports[exportName].import = `${exportFile}.mjs`
                }
                    break
                default:
                    return
            }
        })
    })
    Reflect.deleteProperty(packageJsonObject, 'type')
    Reflect.deleteProperty(packageJsonObject, 'devDependencies')
    Reflect.deleteProperty(packageJsonObject, 'scripts')
    Reflect.deleteProperty(packageJsonObject, 'release-it')
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
 * Process Docker auth.proto file
 */
const processDockerAuthProto = (code) => {
    if (!code.includes('auth.proto')) return code
    const protoContentBuffer = fs.readFileSync(path.resolve(__dirname, 'node_modules/dockerode/lib/proto/auth.proto'))
    const protoContentBase64 = protoContentBuffer.toString('base64')
    const newCodeLines = code.split('\n').map(line => {
        let newLine = line
        if (line.includes('auth.proto')) {
            let [declareVar] = line.split('=')
            const protoLoaderCode = ` (()=>{
                const fsForLoadProto=require('fs');
                const osForLoadProto=require('os');
                const authProtoTempDir=path.resolve(osForLoadProto.tmpdir(),'.tempProto');
                if(!fsForLoadProto.existsSync(authProtoTempDir)) fsForLoadProto.mkdirSync(authProtoTempDir,{recursive:true});
                const authProtoFilename=path.resolve(authProtoTempDir,"lakutata.${packageJson.version}.docker.auth.proto");
                if(!fsForLoadProto.existsSync(authProtoFilename)) fsForLoadProto.writeFileSync(authProtoFilename,Buffer.from("${protoContentBase64}","base64").toString("utf-8"));
                return protoLoader.loadSync(authProtoFilename);
            })();
            `
            newLine = [declareVar, protoLoaderCode].join('=')
        }
        return newLine
    })
    return newCodeLines.join('\n')
}

/**
 * Process bundles
 * @param jsBundlesOptions {RollupOptions[]}
 * @param dtsBundleOptions {RollupOptions}
 * @return {Promise<void>}
 */
async function processBundles(jsBundlesOptions, dtsBundleOptions) {
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
                        chunkOrAsset.code = processDockerAuthProto(chunkOrAsset.code)
                        return writeFile(filename, chunkOrAsset.code, {encoding: 'utf-8'}).then(writeFileResolve).catch(writeFileReject)
                    }
                }).catch(writeFileReject)
            }))
        }
    }

    /**
     * Generate bundles
     */
    const generateJsBundlePromises = []
    jsBundlesOptions.forEach(jsBundleOptions => {
        generateJsBundlePromises.push(new Promise((jsBundleResolve, jsBundleReject) => {
            return rollup(jsBundleOptions).then(jsBundle => {
                return generateOutputs(jsBundle, jsBundleOptions.output).then(jsBundleResolve).catch(jsBundleReject)
            }).catch(jsBundleReject)
        }))
    })
    await Promise.all(generateJsBundlePromises)
    await generateOutputs(await rollup(dtsBundleOptions), dtsBundleOptions.output)
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
 * @type {Array.<{src: string, dest: string}>}
 */
const copyTargets = [
    {src: 'LICENSE', dest: outputDirname},
    {src: 'README.md', dest: outputDirname},
    {src: 'package.json', dest: outputDirname},
    {src: 'tsconfig.json', dest: outputDirname}
]
/**
 * Generate javascript bundle options
 * @param format {'cjs'|'esm'}
 * @return {RollupOptions}
 */
const generateJsBundleOptions = (format) => {
    const isEsm = format === 'esm'
    const outputExt = isEsm ? 'mjs' : 'cjs'
    return {
        logLevel: logLevel,
        input: globFiles('src/**/*.ts')
            .filter(filename => isProductionBuild ? !filename.includes('src/tests') : true),
        output: {
            format: isEsm ? 'esm' : 'cjs',
            dir: outputDirname,
            exports: 'named',
            compact: false,
            interop: 'auto',
            generatedCode: 'es2015',
            entryFileNames: (chunkInfo) => {
                const facadeModuleId = normalizeString(chunkInfo.facadeModuleId)
                const relativeDir = path.relative(currentWorkingDir, path.dirname(facadeModuleId))
                if (relativeDir === 'src/exports') return `${getOutputFilename(chunkInfo.name)}.${outputExt}`
                return path.join(relativeDir, `${chunkInfo.name}.${outputExt}`)
            },
            chunkFileNames: (chunkInfo) => {
                if (!chunkInfo.name.startsWith(thirdPartyPackageRootDirname)) chunkInfo.name = jsChunkNameGenerator(chunkInfo.name)
                return `${chunkInfo.name}.${outputExt}`
            }
        },
        makeAbsoluteExternalsRelative: true,
        treeshake: false,
        plugins: [
            progress({clearLine: true}),
            isEsm ? removeShebang() : undefined,
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
            resolve({
                browser: false,
                preferBuiltins: true
            }),
            commonjs({
                ignore: (id) => {
                    if (id.includes('.node')) {
                        return true
                    }
                    return false
                }
            }),
            json(),
            terser({
                format: {
                    comments: false,
                    beautify: true
                },
                keep_classnames: true,
                maxWorkers: os.cpus().length,
                compress: false,
                module: true
            }),
            esmShim()
        ],
        external: [
            ...builtinModules,
            /\.node$/
        ]
    }
}
/**
 * DTS bundle options
 * @return {RollupOptions}
 */
const generateDTSBundleOptions = () => {
    const outputExt = 'ts'
    return {
        logLevel: logLevel,
        input: (() => {
            return Object.keys(packageJsonExports)
                .map(exportName => {
                    const inputFilename = packageJsonExports[exportName]
                    return path.extname(inputFilename) !== '.json' ? inputFilename : null
                }).filter(value => !!value)
        })(),
        output: {
            format: 'esm',
            dir: outputDirname,
            entryFileNames: (chunkInfo) => `${getOutputFilename(path.basename(chunkInfo.name))}.d.${outputExt}`,
            chunkFileNames: (chunkInfo) => {
                if (!chunkInfo.name.startsWith(thirdPartyPackageRootDirname)) chunkInfo.name = dtsChunkNameGenerator(chunkInfo.name)
                return `${chunkInfo.name}.d.${outputExt}`
            }
        },
        plugins: [
            progress({clearLine: true}),
            resolve(),
            dts({
                respectExternal: true,
                compilerOptions: {
                    outDir: outputDirname
                }
            }),
            copy({targets: copyTargets})
        ],
        external: [
            ...builtinModules,
            /\.node$/
        ]
    }
}

//===================================Configurations===================================

/**
 * Process bundles
 */
await processBundles(
    isProductionBuild
        ? [
            generateJsBundleOptions('esm'),
            generateJsBundleOptions('cjs')
        ]
        : [
            generateJsBundleOptions('esm')
        ],
    generateDTSBundleOptions()
)
/**
 * Process package.json
 */
await processPackageJson(path.resolve(absoluteOutputDirname, 'package.json'), ['esm', 'cjs'])
/**
 * Process tsconfig.json
 */
await processTsConfigJson(path.resolve(absoluteOutputDirname, 'tsconfig.json'))
