export type ContainerdBind = {
    hostPath: string
    containerPath: string
    rw?: boolean
    propagation?: 'private' | 'rprivate' | 'shared' | 'rshared' | 'slave' | 'rslave'
}
