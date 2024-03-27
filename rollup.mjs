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

const isProductionBuild = process.env.BUILD_MODE === 'production'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const require = createRequire(__filename)

function nativePlugin(options) {
    const Path = require('path')
    const Fs = require('fs-extra')
    const MagicString = require('magic-string')
    const hasOwnProperty = Object.prototype.hasOwnProperty
    const copyTo = options.copyTo || './'
    const destDir = options.destDir || './'
    const dlopen = options.dlopen || false
    const originTransform = options.originTransform
    let map = options.map
    const isSourceMapEnabled = options['sourceMap'] !== false && options.sourcemap !== false
    const targetEsm = options.targetEsm || false
    if (typeof map !== 'function') {
        map = fullPath => generateDefaultMapping(fullPath)
    }
    const PREFIX = '\0natives:'
    let renamedMap = /**@type {Map<String, {name: String, copyTo: String}>}*/new Map()

    function exportModule(path) {
        if (dlopen)
            return `
            function get() {
              let p = require('path').resolve(__dirname, ${JSON.stringify(path)});
              if (!require.cache[p]) {
                let module = {exports:{}};
                process.dlopen(module, p);
                require.cache[p] = module;
              }
              // Fool other plugins, leave this one alone! (Resilient to uglifying too)
              let req = require || require;
              return req(p);
            };
            export default get();\n`

        if (targetEsm)
            return `
            import {createRequire} from 'module';
            const require = createRequire(import.meta.url);
            export default require(${JSON.stringify(path)});
            \n`

        return `export default require(${JSON.stringify(path)});\n`
    }

    function findAvailableBasename(path) {
        let basename = Path.basename(path)
        let i = 1
        while (Array.from(renamedMap.values()).filter(x => x.name === rebaseModule(basename)).length) {
            basename = Path.basename(path, Path.extname(path)) + '_' + (i++) + Path.extname(path)
        }
        return basename
    }

    function rebaseModule(basename) {
        return (destDir + (/\\$|\/$/.test(destDir) ? '' : '/') + basename).replace(/\\/g, '/')
    }

    function generateDefaultMapping(path) {
        let basename = findAvailableBasename(path)

        return {
            name: rebaseModule(basename),
            copyTo: Path.join(copyTo, basename)
        }
    }

    function replace(code, magicString, pattern, fn) {
        let result = false
        let match
        pattern.lastIndex = 0
        while ((match = pattern.exec(code))) {
            let replacement = fn(match)
            if (replacement === null) continue
            let start = match.index
            let end = start + match[0].length
            magicString.overwrite(start, end, replacement)
            result = true
        }
        return result
    }

    function mapAndReturnPrefixedId(importee, importer) {
        let resolvedFull = Path.resolve(importer ? Path.dirname(importer) : '', importee)

        let nativePath = null
        if (/\.(node|dll)$/i.test(importee))
            nativePath = resolvedFull
        else if (Fs.pathExistsSync(resolvedFull + '.node'))
            nativePath = resolvedFull + '.node'
        else if (Fs.pathExistsSync(resolvedFull + '.dll'))
            nativePath = resolvedFull + '.dll'

        if (nativePath) {
            let mapping = renamedMap.get(nativePath), isNew = false

            if (!mapping) {
                mapping = map(nativePath)

                if (typeof mapping === 'string') {
                    mapping = generateDefaultMapping(mapping)
                }

                renamedMap.set(nativePath, mapping)
                isNew = true
            }

            if (isNew) {
                let exists = Fs.pathExistsSync(nativePath)
                if (typeof originTransform === 'function') {
                    const transformed = originTransform(nativePath, exists)
                    if (transformed !== undefined) {
                        nativePath = transformed
                        exists = Fs.pathExistsSync(nativePath)
                    }
                }

                if (exists) {
                    Fs.copyFileSync(nativePath, mapping.copyTo)
                } else {
                    this.warn(`${nativePath} does not exist`)
                }
            }

            // console.log(mapping.name)
            return mapping.name
            // return PREFIX + mapping.name
        }

        return null
    }

    return {
        name: 'rollup-plugin-natives',
        buildStart(_options) {
            Fs.mkdirpSync(copyTo, {recursive: true})
        },
        load(id) {
            if (id.startsWith(PREFIX))
                return exportModule(id.substr(PREFIX.length))

            if (renamedMap.has(id))
                return exportModule(renamedMap.get(id).name)

            return null
        },
        transform(code, id) {
            let magicString = new MagicString(code)
            let bindingsRgx = /require\(['"]bindings['"]\)\(((['"]).+?\2)?\)/g
            let simpleRequireRgx = /require\(['"](.*?)['"]\)/g
            let hasBindingReplacements = false
            let hasBinaryReplacements = false
            const getModuleRoot = (() => {
                let moduleRoot = null
                return () => {
                    if (moduleRoot === null) {
                        moduleRoot = Path.dirname(id)
                        let prev = null
                        while (true) { // eslint-disable-line no-constant-condition
                            if (moduleRoot === '.')
                                moduleRoot = process.cwd()
                            if (Fs.pathExistsSync(Path.join(moduleRoot, 'package.json')) ||
                                Fs.pathExistsSync(Path.join(moduleRoot, 'node_modules')))
                                break
                            if (prev === moduleRoot)
                                break
                            // Try the parent dir next
                            prev = moduleRoot
                            moduleRoot = Path.resolve(moduleRoot, '..')
                        }
                    }

                    return moduleRoot
                }
            })()
            hasBindingReplacements = replace(code, magicString, bindingsRgx, (match) => {
                let name = match[1]
                let nativeAlias = name ? new Function('return ' + name)() : 'bindings.node'
                if (!nativeAlias.endsWith('.node'))
                    nativeAlias += '.node'
                let partsMap = {
                    'compiled': process.env.NODE_BINDINGS_COMPILED_DIR || 'compiled',
                    'platform': options.target_platform || process.platform,
                    'arch': options.target_arch || process.arch,
                    'version': process.versions.node,
                    'bindings': nativeAlias,
                    'module_root': getModuleRoot()
                }
                let possibilities = [
                    ['module_root', 'build', 'bindings'],
                    ['module_root', 'build', 'Debug', 'bindings'],
                    ['module_root', 'build', 'Release', 'bindings'],
                    ['module_root', 'compiled', 'version', 'platform', 'arch', 'bindings']
                ]
                let possiblePaths = /**@type {String[]}*/possibilities.map(parts => {
                    parts = parts.map(part => {
                        if (hasOwnProperty.call(partsMap, part))
                            return partsMap[part]
                        return part
                    })
                    return Path.join.apply(Path, parts)
                })
                let chosenPath = possiblePaths.find(x => Fs.pathExistsSync(x)) || possiblePaths[0]
                let prefixedId = mapAndReturnPrefixedId.apply(this, [chosenPath])
                if (prefixedId) {
                    return 'require(' + JSON.stringify(prefixedId) + ')'
                }

                return null
            })
            hasBindingReplacements = hasBindingReplacements || replace(code, magicString, simpleRequireRgx, (match) => {
                let path = match[1]

                if (!path.endsWith('.node'))
                    path += '.node'

                path = Path.join(getModuleRoot(), path)

                if (Fs.pathExistsSync(path)) {
                    let prefixedId = mapAndReturnPrefixedId.apply(this, [path])
                    if (prefixedId) {
                        return 'require(' + JSON.stringify(prefixedId) + ')'
                    }
                }

                return null
            })

            if (code.indexOf('node-pre-gyp') !== -1) {
                let varRgx = /(var|let|const)\s+([a-zA-Z0-9_]+)\s+=\s+require\((['"])(@mapbox\/node-pre-gyp|node-pre-gyp)\3\);?/g
                let binaryRgx = /\b(var|let|const)\s+([a-zA-Z0-9_]+)\s+=\s+binary\.find\(path\.resolve\(path\.join\(__dirname,\s*((['"]).*\4)\)\)\);?\s*(var|let|const)\s+([a-zA-Z0-9_]+)\s+=\s+require\(\2\)/g

                let varMatch = varRgx.exec(code)

                if (varMatch) {
                    binaryRgx = new RegExp(`\\b(var|let|const)\\s+([a-zA-Z0-9_]+)\\s+=\\s+${varMatch[2]}\\.find\\(path\\.resolve\\(path\\.join\\(__dirname,\\s*((?:['"]).*\\4)\\)\\)\\);?\\s*(var|let|const)\\s+([a-zA-Z0-9_]+)\\s+=\\s+require\\(\\2\\)`, 'g')
                }

                hasBinaryReplacements = replace(code, magicString, binaryRgx, (match) => {
                    let preGyp = null

                    let r1 = varMatch && varMatch[4][0] === '@' ? '@mapbox/node-pre-gyp' : 'node-pre-gyp'
                    let r2 = varMatch && varMatch[4][0] === '@' ? 'node-pre-gyp' : '@mapbox/node-pre-gyp'

                    // We can't simply require('node-pre-gyp') because we are not in the same context as the target module
                    // Maybe node-pre-gyp is installed in node_modules/target_module/node_modules
                    let preGypPath = Path.dirname(id)
                    while (preGypPath !== '/' && preGyp === null) {
                        // Start with the target module context and then go back in the directory tree
                        // until the right context has been found
                        try {
                            // noinspection NpmUsedModulesInstalled
                            preGyp = require(Path.resolve(Path.join(preGypPath, 'node_modules', r1)))
                        } catch (ex) {
                            try {
                                // noinspection NpmUsedModulesInstalled
                                preGyp = require(Path.resolve(Path.join(preGypPath, 'node_modules', r2)))
                            } catch (ex) {
                                // ignore
                            }
                        }
                        preGypPath = Path.dirname(preGypPath)
                    }

                    if (!preGyp) return null

                    let [, d1, v1, ref, d2, v2] = match

                    let libPath = preGyp.find(Path.resolve(Path.join(Path.dirname(id), new Function('return ' + ref)())), options)

                    let prefixedId = mapAndReturnPrefixedId.apply(this, [libPath])
                    if (prefixedId) {
                        return `${d1} ${v1}=${JSON.stringify(renamedMap.get(libPath).name.replace(/\\/g, '/'))};${d2} ${v2}=require(${JSON.stringify(prefixedId)})`
                    }

                    return null
                })

                // If the native module has been required through a hard-coded path, then node-pre-gyp
                // is not required anymore - remove the require('node-pre-gyp') statement because it
                // pulls some additional dependencies - like AWS S3 - which are needed only for downloading
                // new binaries
                if (hasBinaryReplacements)
                    replace(code, magicString, varRgx, () => '')
            }
            if (!hasBindingReplacements && !hasBinaryReplacements)
                return null
            let result = {code: magicString.toString()}
            if (isSourceMapEnabled) {
                result.map = magicString.generateMap({hires: true})
            }
            return result
        },

        resolveId(importee, importer) {
            if (importee.startsWith(PREFIX))
                return importee

            // Avoid trouble with other plugins like commonjs
            if (importer && importer[0] === '\0' && importer.indexOf(':') !== -1)
                importer = importer.slice(importer.indexOf(':') + 1)
            if (importee && importee[0] === '\0' && importee.indexOf(':') !== -1)
                importee = importee.slice(importee.indexOf(':') + 1)
            if (importee.endsWith('?commonjs-require'))
                importee = importee.slice(1, -'?commonjs-require'.length)

            return mapAndReturnPrefixedId.apply(this, [importee, importer])
        }
    }
}

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
        new Promise((jsBundlesResolve, jsBundlesReject) => {
            const generateJsBundlePromises = []
            jsBundlesOptions.forEach(jsBundleOptions => {
                generateJsBundlePromises.push(new Promise((jsBundleResolve, jsBundleReject) => {
                    return rollup(jsBundleOptions).then(jsBundle => {
                        return generateOutputs(jsBundle, jsBundleOptions.output).then(jsBundleResolve).catch(jsBundleReject)
                    }).catch(jsBundleReject)
                }))
            })
            return Promise.all(generateJsBundlePromises).then(jsBundlesResolve).catch(jsBundlesReject)
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
 * @type {Array.<{src: string, dest: string}>}
 */
const copyTargets = [
    {src: 'LICENSE', dest: outputDirname},
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
            nativePlugin({
                copyTo: path.resolve(outputDirname, thirdPartyPackageRootDirname),
                map: (modulePath) => `${path.basename(path.dirname(modulePath))}_ffi.node`,
                targetEsm: false
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
                },
                transformMixedEsModules: true
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
            ...builtinModules
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
