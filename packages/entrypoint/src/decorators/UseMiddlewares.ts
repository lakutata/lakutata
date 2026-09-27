import {AddMiddlewares, MiddlewareDefinition, ValidateMiddlewares} from '../lib/Middleware.js'

/**
 * Add middlewares to a controller (all its actions) or to an action
 * Order: the middlewares of the entrypoint, of the controller classes (parents first), of the action options, of the action method,
 * then the input validation, the access control and the action
 * @param middlewares
 */
export function UseMiddlewares(...middlewares: MiddlewareDefinition[]): (target: object, propertyKey?: string | symbol, descriptor?: PropertyDescriptor) => void {
    ValidateMiddlewares(middlewares)
    return (target: object, propertyKey?: string | symbol): void => AddMiddlewares(target, propertyKey, middlewares)
}
