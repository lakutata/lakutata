import 'reflect-metadata'
import path from 'path'
import {Alias} from './lib/Alias'

declare const require: NodeRequire

declare global {
    namespace NodeJS {
        interface ProcessEnv {
            appId: string
            appName: string
            ENTRYPOINT_DIR: string
        }
    }
}

//判断当前应用程序的执行根目录位置
process.env.ENTRYPOINT_DIR = process.env.ENTRYPOINT_DIR ? process.env.ENTRYPOINT_DIR : (() => {
    let appRootDir: string = ''
    if (typeof require !== 'undefined') {
        appRootDir = require.main?.filename ? path.dirname(require.main.filename) : ''
        appRootDir = new RegExp('node_modules').test(appRootDir) ? '' : appRootDir
    }
    const argv: string[] = process.argv.filter((arg: string) => {
        const isPath: boolean = new RegExp('^(\\/|\\.\\.?\\/|([A-Za-z]:)?\\\\)([^\\\\\\/:*?"<>|\\r\\n]+[\\\\\\/])*[^\\\\\\/:*?"<>|\\r\\n]*$').test(arg)
        const isValidEntryPoint: boolean = ['.ts', '.js', '.cjs', '.cts'].includes(path.extname(arg).toLowerCase())
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
export * from './exports/Core'
export * from './exports/Decorators'
export * from './exports/Components'
export * from './exports/Exceptions'
export * from './exports/Hash'
export * from './exports/Time'
export * from './exports/Utilities'
export * from './exports/Validator'
export * from './exports/Crypto'
export * from './exports/HttpRequest'
