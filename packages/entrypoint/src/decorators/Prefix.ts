import {Controller} from '../lib/Controller.js'
import {PrefixOptions, SetPrefix} from '../lib/Prefix.js'

/**
 * Prefix the actions of a controller (and of the controllers extending it, unless they declare their own prefixes):
 * route: prepended to the routes of the HTTP actions ("/users" + "/:id" = "/users/:id")
 * command: prepended to the commands of the CLI actions ("user" + "get" = "user:get")
 * pattern: merged into the patterns of the service actions ({resource: "user"} + {act: "get"} = {resource: "user", act: "get"})
 * @param options
 */
export function Prefix<ClassConstructor extends typeof Controller>(options: PrefixOptions): (target: ClassConstructor) => void {
    return (target: ClassConstructor): void => SetPrefix(target, options)
}
