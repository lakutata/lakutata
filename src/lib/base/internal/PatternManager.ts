import {Patrun} from 'patrun'
import {IPatRun} from '../../../interfaces/IPatRun.js'

export type PatternManagerOptions = {
    globMatch?: boolean
}

export class PatternManager implements IPatRun {

    #engine: IPatRun

    private constructor(options: PatternManagerOptions = {globMatch: true}) {
        this.#engine = Patrun({gex: !!options.globMatch})
    }

    /**
     * Register a pattern, and the object that will be returned if an input matches.
     * Both keys and values are considered to be strings.
     * Other types are converted to strings.
     * @param pattern
     * @param obj
     */
    public add(pattern: Record<string, any>, obj: any): this {
        this.#engine.add(pattern, obj)
        return this
    }

    /**
     * Remove this pattern, and it's object, from the matcher.
     * @param pattern
     */
    public remove(pattern: Record<string, any>): this {
        this.#engine.remove(pattern)
        return this
    }

    /**
     * Return the unique match for this subject, or null if not found.
     * The properties of the subject are matched against the patterns previously added, and the most specifc pattern wins.
     * Unknown properties in the subject are ignored.
     * You can optionally provide a second boolean parameter, exact. If true, then all properties of the subject must match.
     *
     * If the optional third boolean parameter collect is true, then find returns an array of all sub matches
     * (i.e. run find on each element of the power set of the subject pattern elements, and collate in breadth first order).
     * Thus, {a:1,b:2} will generate {a:1},{b:2},{a:1,b:2} searches.
     * If exact is true, only increasing sub patterns in lexicographical order are chosen.
     * Thus, {a:1,b:2} will generate {a:1},{a:1,b:2}, omitting {b:2}. (You probably want to set exact to false!).
     * @param subject
     * @param exact
     */
    public find(subject: Record<string, any>, exact: boolean = false): any {
        return this.#engine.find(subject, exact)
    }

    /**
     * Return the list of registered patterns that contain this partial pattern.
     * You can use wildcards for property values.
     * Omitted values are not equivalent to a wildcard of "*", you must specify each property explicitly.
     * @param partialPattern
     */
    public list(partialPattern?: Record<string, any> | undefined): { match: Record<string, any>; data: any }[] {
        return this.#engine.list(partialPattern)
    }

    /**
     * Generate a string representation of the decision tree for debugging.
     */
    public toJSON(): string {
        return this.#engine.toJSON()
    }
}
