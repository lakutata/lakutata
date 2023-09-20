import './ReflectMetadata'
import path from 'path'
import {Alias} from './lib/Alias'
import fs from 'fs'

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
    if (!appRootDir) {
        //判断是否在全局的安装目录内
        const pkgJsonFilename: string = path.resolve(__dirname, './package.json')
        if (fs.existsSync(pkgJsonFilename)) {
            try {
                if (JSON.parse(fs.readFileSync(pkgJsonFilename, {encoding: 'utf-8'})).name === 'lakutata') {
                    appRootDir = __dirname
                }
            } catch (e) {
                appRootDir = ''
            }
        }
    }
    return appRootDir
})()

//获取程序执行入口文件所在目录失败则报错
if (!process.env.ENTRYPOINT_DIR) throw new Error('Failed to retrieve the directory of the program\'s execution entry file.')
Alias.init()
Alias.getAliasInstance().set('@lakutata', __dirname)
//导出库内容
export * from './exports/Core'
export * from './exports/Decorators'
export * from './exports/Components'
export * from './exports/Exceptions'
export * from './exports/Time'
export * from './exports/Validator'
export * from './exports/HttpRequest'
