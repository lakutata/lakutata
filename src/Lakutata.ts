import 'reflect-metadata'

declare global {
    namespace NodeJS {
        interface ProcessEnv {
            RUNTIME: 'ESM' | 'CJS'
        }
    }
}

//判断当前运行环境为Commonjs还是ESM
process.env.RUNTIME = (typeof __dirname !== 'string' || typeof __filename !== 'string') ? 'ESM' : 'CJS'

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
