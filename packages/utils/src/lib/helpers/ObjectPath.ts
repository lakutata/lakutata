export class ObjectPath {

    /**
     * Get keys from path string
     * @param path
     * @protected
     */
    protected static getPathKeys(path: string): string[] {
        return path.replace(/\[(\w+)\]/g, '.$1').split('.')
    }

    /**
     * Get specified object path's value
     * @param obj
     * @param path
     */
    public static get<T>(obj: Record<string, any>, path: string): T | undefined {
        const keys: string[] = this.getPathKeys(path)
        let result: any = obj
        for (const key of keys) {
            if (result == null) return undefined
            result = result[key]
        }
        return result as T
    }

    /**
     * Set value to specified object path
     * @param obj
     * @param path
     * @param value
     */
    public static set(obj: Record<string, any>, path: string, value: any): void {
        if (value === undefined) return
        const keys: string[] = this.getPathKeys(path)
        let current: Record<string, any> = obj
        for (let i: number = 0; i < keys.length - 1; i++) {
            const key: string = keys[i]
            if (typeof current[key] !== 'object') current[key] = {}
            current = current[key]
        }
        current[keys[keys.length - 1]] = value
    }

    /**
     * Whether specified object path exists
     * @param obj
     * @param path
     */
    public static has(obj: Record<string, any>, path: string): boolean {
        const keys: string[] = this.getPathKeys(path)
        let current: Record<string, any> = obj
        for (const key of keys) {
            if (current == null || !(key in current)) return false
            current = current[key]
        }
        return true
    }
}