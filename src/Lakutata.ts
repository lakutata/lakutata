import 'reflect-metadata'
import path from 'path'
import {Alias} from './lib/Alias.js'

declare const require: NodeRequire

declare global {
    namespace NodeJS {
        interface ProcessEnv {
            RUNTIME: 'ESM' | 'CJS'
            ENTRYPOINT_DIR: string
        }
    }
}

//判断当前运行环境为Commonjs还是ESM
process.env.RUNTIME = (typeof __dirname !== 'string' || typeof __filename !== 'string') ? 'ESM' : 'CJS'

//判断当前应用程序的执行根目录位置
process.env.ENTRYPOINT_DIR = (() => {
    let appRootDir: string = ''
    if (typeof require !== 'undefined' && process.env.RUNTIME === 'CJS') {
        appRootDir = require.main?.filename ? path.dirname(require.main.filename) : ''
        appRootDir = new RegExp('node_modules').test(appRootDir) ? '' : appRootDir
    }
    const argv: string[] = process.argv.filter((arg: string) => {
        const isPath: boolean = new RegExp('^(\\/|\\.\\.?\\/|([A-Za-z]:)?\\\\)([^\\\\\\/:*?"<>|\\r\\n]+[\\\\\\/])*[^\\\\\\/:*?"<>|\\r\\n]*$').test(arg)
        const isValidEntryPoint: boolean = ['.ts', '.js', '.mjs', '.cjs', 'mts', '.cts'].includes(path.extname(arg).toLowerCase())
        const isNotInNodeModules: boolean = !(new RegExp('node_modules').test(arg))
        return isPath && isValidEntryPoint && isNotInNodeModules
    })
    if (!appRootDir) appRootDir = argv[0] ? path.dirname(argv[0]) : ''
    return appRootDir
})()

//获取程序执行入口文件所在目录失败则报错
if (!process.env.ENTRYPOINT_DIR) throw new Error('Failed to retrieve the directory of the program\'s execution entry file.')
Alias.init()

//导出库内容
export * from './exports/Core.js'
export * from './exports/Decorators.js'
export * from './exports/Components.js'
export * from './exports/Exceptions.js'
export * from './exports/Hash.js'
export * from './exports/Time.js'
export * from './exports/Utilities.js'
export * from './exports/Validator.js'
export * from './exports/Crypto.js'
