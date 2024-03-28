import path from 'path'
import {InvalidAliasNameException} from '../../exceptions/alias/InvalidAliasNameException.js'
import {AliasExistsException} from '../../exceptions/alias/AliasExistsException.js'
import {AliasNotFoundException} from '../../exceptions/alias/AliasNotFoundException.js'

export class Alias {

    protected aliasNameRegExp: RegExp = /^@[a-zA-Z0-9]+$/

    protected readonly aliasMap: Map<string, string> = new Map()

    /**
     * Constructor
     */
    constructor() {
        const oldPathResolve: (...paths: string[]) => string = path.resolve
        path.resolve = (...paths: string[]): string => {
            const resolvedPaths: string[] = paths.map((value: string) => this.resolve(value))
            return oldPathResolve(...resolvedPaths)
        }
    }

    /**
     * Init alias manager, must init it before application instance init
     */
    public static init(): void {
        const instance: Alias = new this()
        Reflect.defineMetadata(this, instance, this)
    }

    /**
     * Get alias manager instance
     */
    public static getAliasInstance(): Alias {
        if (!Reflect.hasOwnMetadata(this, this)) this.init()
        return Reflect.getMetadata(this, this)
    }

    /**
     * Register alias
     * @param aliasName
     * @param aliasPath
     */
    public set(aliasName: string, aliasPath: string): void
    /**
     * Register alias
     * @param aliasName
     * @param aliasPath
     * @param override
     */
    public set(aliasName: string, aliasPath: string, override: boolean): void
    public set(aliasName: string, aliasPath: string, override: boolean = false): void {
        if (!this.aliasNameRegExp.test(aliasName)) throw new InvalidAliasNameException('The alias should start with \'@\' and only contain characters a-z|A-Z|0-9. The current alias \'{aliasName}\' does not comply with this rule.', {aliasName})
        if (this.aliasMap.has(aliasName) && !override) throw new AliasExistsException('The alias \'{aliasName}\' already exists.', {aliasName})
        this.aliasMap.set(aliasName, aliasPath)
    }

    /**
     * Resolve alias
     * @param aliasName
     */
    public get(aliasName: string): string {
        if (!this.aliasNameRegExp.test(aliasName)) throw new InvalidAliasNameException('The alias should start with \'@\' and only contain characters a-z|A-Z|0-9. The current alias \'{aliasName}\' does not comply with this rule.', {aliasName})
        if (!this.aliasMap.has(aliasName)) throw new AliasNotFoundException('The alias \'{aliasName}\' not found.', {aliasName})
        const aliasPath: string = this.aliasMap.get(aliasName)!
        return this.resolve(aliasPath)
    }

    /**
     * Whether an alias exists
     * @param aliasName
     */
    public has(aliasName: string): boolean {
        if (!this.aliasNameRegExp.test(aliasName)) throw new InvalidAliasNameException('The alias should start with \'@\' and only contain characters a-z|A-Z|0-9. The current alias \'{aliasName}\' does not comply with this rule.', {aliasName})
        return this.aliasMap.has(aliasName)
    }

    /**
     * Resolve string and replace alias name to alias value inside the string
     * @param containAliasPath
     */
    public resolve(containAliasPath: string): string {
        let isContainsAlias: boolean = true
        while (isContainsAlias) {
            let _isContainsAlias: boolean = false
            this.aliasMap.forEach((aliasPath: string, aliasName: string) => {
                if (containAliasPath.includes(aliasName)) {
                    _isContainsAlias = true
                    containAliasPath = containAliasPath.replace(aliasName, aliasPath)
                }
            })
            isContainsAlias = _isContainsAlias
        }
        return path.normalize(containAliasPath)
    }

    /**
     * List aliases
     */
    public list(): Record<string, string> {
        const aliasList: Record<string, string> = {}
        this.aliasMap.forEach((aliasValue: string, aliasKey: string) => Reflect.set(aliasList, aliasKey, aliasValue))
        return aliasList
    }
}
