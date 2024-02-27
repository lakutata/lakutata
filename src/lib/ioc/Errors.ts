import {ResolutionStack} from './DependencyInjectionContainer.js'
import {DependencyInjectionException} from '../../exceptions/di/DependencyInjectionException.js'
import {As} from '../base/func/As.js'
import {IsSymbol} from '../base/func/IsSymbol.js'
import {ResolveConstructorNameBySymbol} from '../base/internal/ConstructorSymbol.js'

/**
 * 可扩展错误类
 */
export class ExtendableError extends DependencyInjectionException {
    /**
     * 可扩展错误类构造函数
     * @param message
     */
    constructor(message: string) {
        super(message)
        Object.defineProperty(this, 'message', {
            enumerable: false,
            value: message
        })
        Object.defineProperty(this, 'name', {
            enumerable: false,
            value: this.constructor.name
        })
        if ('captureStackTrace' in Error) {
            Error.captureStackTrace(this, this.constructor)
        } else {
            Object.defineProperty(this, 'stack', {
                enumerable: false,
                value: (Error as ErrorConstructor)(message).stack,
                writable: true,
                configurable: true
            })
        }
    }
}

/**
 * 抛出的错误，用于指示类型不匹配
 */
export class DependencyInjectionTypeError extends ExtendableError {
    /**
     * 构造函数，接受函数名称、期望的类型和给定的类型，以生成错误
     * @param funcDescription
     * @param paramName
     * @param expectedType
     * @param givenType
     */
    constructor(
        funcDescription: string,
        paramName: string,
        expectedType: string,
        givenType: any
    ) {
        super(
            `${funcDescription}: expected ${paramName} to be ${expectedType}, but got ${givenType}.`
        )
    }

    /**
     * 断言给定的条件，否则抛出错误
     * @param condition
     * @param funcDescription
     * @param paramName
     * @param expectedType
     * @param givenType
     */
    static assert<T>(
        condition: T,
        funcDescription: string,
        paramName: string,
        expectedType: string,
        givenType: any
    ) {
        if (!condition) {
            throw new DependencyInjectionTypeError(
                funcDescription,
                paramName,
                expectedType,
                givenType
            )
        }
        return condition
    }
}

/**
 * 一个友好的错误类，以便我们可以进行 instanceof 检查
 */
export class DependencyInjectionResolutionError extends ExtendableError {
    /**
     * 构造函数，接受注册的模块和未解析的标记，以创建一条消息
     * @param name
     * @param resolutionStack
     * @param message
     */
    constructor(
        name: string | symbol,
        resolutionStack: ResolutionStack,
        message?: string
    ) {
        if (IsSymbol(name)) name = ResolveConstructorNameBySymbol(name as any).toString()
        const purifiedName: string = (name as any).split('_$$').reverse()[0]
        resolutionStack = resolutionStack.map((val) => IsSymbol(val) ? (ResolveConstructorNameBySymbol(val as any) as any).toString() : val)
        resolutionStack.push(As(purifiedName))
        const resolutionPathString: string = resolutionStack.join(' -> ')
        let msg: string = `Could not resolve '${purifiedName}'.`
        if (message) msg = `${msg} ${message}`
        msg = `${msg} Resolution path: ${resolutionPathString}`
        super(msg)
    }
}

/**
 * A nice error class, so we can do an instanceOf check.
 */
export class DependencyInjectionRegistrationError extends ExtendableError {
    /**
     * Constructor, takes the registered modules and unresolved tokens
     * to create a message.
     *
     * @param {string|symbol} name
     * The name of the module that could not be registered.
     */
    constructor(name: string | symbol, message?: string) {
        const stringName = name.toString()
        let msg = `Could not register '${stringName}'.`
        if (message) {
            msg += ` ${message}`
        }
        super(msg)
    }
}
