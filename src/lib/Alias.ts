import path from 'path'
import {AliasNotFoundException} from '../exceptions/alias/AliasNotFoundException.js'
import {AliasExistsException} from '../exceptions/alias/AliasExistsException.js'
import {InvalidAliasNameException} from '../exceptions/alias/InvalidAliasNameException.js'

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
     * 初始化别名管理器，需要在非常早期进行初始化
     */
    public static init(): void {
        const instance: Alias = new this()
        Reflect.defineMetadata(this, instance, this)
    }

    /**
     * 获取别名管理器实例
     */
    public static getAliasInstance(): Alias {
        return Reflect.getMetadata(this, this)
    }

    /**
     * 注册别名
     * @param aliasName 别名名称
     * @param aliasPath 别名路径
     */
    public set(aliasName: string, aliasPath: string): void
    /**
     * 注册别名
     * @param aliasName 别名名称
     * @param aliasPath 别名路径
     * @param override 若已存在是否覆写
     */
    public set(aliasName: string, aliasPath: string, override: boolean): void
    public set(aliasName: string, aliasPath: string, override: boolean = false): void {
        if (!this.aliasNameRegExp.test(aliasName)) throw new InvalidAliasNameException('The alias should start with \'@\' and only contain characters a-z|A-Z|0-9. The current alias \'{aliasName}\' does not comply with this rule.', {aliasName})
        if (this.aliasMap.has(aliasName) && !override) throw new AliasExistsException('The alias \'{aliasName}\' already exists.', {aliasName})
        this.aliasMap.set(aliasName, aliasPath)
    }

    /**
     * 解析别名
     * @param aliasName 别名名称
     */
    public get(aliasName: string): string {
        if (!this.aliasNameRegExp.test(aliasName)) throw new InvalidAliasNameException('The alias should start with \'@\' and only contain characters a-z|A-Z|0-9. The current alias \'{aliasName}\' does not comply with this rule.', {aliasName})
        if (!this.aliasMap.has(aliasName)) throw new AliasNotFoundException('The alias \'{aliasName}\' not found.', {aliasName})
        const aliasPath: string = this.aliasMap.get(aliasName)!
        return this.resolve(aliasPath)
    }

    /**
     * 查询别名是否存在
     * @param aliasName
     */
    public has(aliasName: string): boolean {
        if (!this.aliasNameRegExp.test(aliasName)) throw new InvalidAliasNameException('The alias should start with \'@\' and only contain characters a-z|A-Z|0-9. The current alias \'{aliasName}\' does not comply with this rule.', {aliasName})
        return this.aliasMap.has(aliasName)
    }

    /**
     * 解析包含别名的字符串
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
}
