export interface IPatRun {
    add: (pattern: Record<string, any>, obj: any) => void
    remove: (pattern: Record<string, any>) => void
    find: (subject: Record<string, any>) => any
    list: (partialPattern?: Record<string, any>) => { match: Record<string, any>, data: any }[]
    toJSON: () => string
}
