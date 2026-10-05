//Derived from the upstream projects listed in THIRD_PARTY_NOTICES.md (rewritten in TypeScript)
import {stringify} from './Stringify.js'

/**
 * Format a log message with its arguments: %s, %d, %f, %i, %o, %O, %j and %%
 * The arguments without placeholder are ignored
 * @param template
 * @param args
 */
export function format(template: unknown, args: unknown[]): unknown {
    if (typeof template === 'object' && template !== null) {
        const count: number = args.length + 1
        if (count === 1) return template
        //Serialize the object and the arguments after the first one (the behavior of 2.x)
        const objects: (string | undefined)[] = new Array(count)
        objects[0] = stringify(template)
        for (let index: number = 1; index < count; index++) objects[index] = stringify(args[index])
        return objects.join(' ')
    }
    if (typeof template !== 'string' || !args.length) return template
    let result: string = ''
    let argument: number = 0
    let last: number = -1
    const length: number = template.length
    for (let index: number = 0; index < length;) {
        if (template.charCodeAt(index) === 37 && index + 1 < length) {
            last = last > -1 ? last : 0
            switch (template.charCodeAt(index + 1)) {
                //d, f
                case 100:
                case 102:
                    if (argument >= args.length || args[argument] == null) break
                    if (last < index) result += template.slice(last, index)
                    result += Number(args[argument])
                    last = index + 2
                    index++
                    break
                //i
                case 105:
                    if (argument >= args.length || args[argument] == null) break
                    if (last < index) result += template.slice(last, index)
                    result += Math.floor(Number(args[argument]))
                    last = index + 2
                    index++
                    break
                //O, o, j
                case 79:
                case 111:
                case 106: {
                    if (argument >= args.length || args[argument] === undefined) break
                    if (last < index) result += template.slice(last, index)
                    const value: unknown = args[argument]
                    if (typeof value === 'string') {
                        result += `'${value}'`
                    } else if (typeof value === 'function') {
                        result += value.name || '<anonymous>'
                    } else {
                        result += stringify(value)
                    }
                    last = index + 2
                    index++
                    break
                }
                //s
                case 115:
                    if (argument >= args.length) break
                    if (last < index) result += template.slice(last, index)
                    result += String(args[argument])
                    last = index + 2
                    index++
                    break
                //%
                case 37:
                    if (last < index) result += template.slice(last, index)
                    result += '%'
                    last = index + 2
                    index++
                    argument--
                    break
            }
            ++argument
        }
        ++index
    }
    if (last === -1) return template
    if (last < length) result += template.slice(last)
    return result
}
