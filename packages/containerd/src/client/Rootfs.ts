import {lstat, readdir, readFile, readlink} from 'node:fs/promises'
import type {Stats} from 'node:fs'
import path from 'node:path'
import type {SnapshotMount} from './ContainerdClient.js'

/**
 * The user of a process: its identifiers and its groups
 */
export type ProcessUser = {
    uid: number
    gid: number
    additionalGids: number[]
    home: string
}

/**
 * The directories of the layers of the mounts of a snapshot, the top one first (overlay: its upper directory and its
 * lower ones, bind: its source)
 * @param mounts
 */
export function layerDirectories(mounts: SnapshotMount[]): string[] {
    const directories: string[] = []
    for (const mount of mounts) {
        if (mount.type === 'bind' || mount.type === 'rbind') {
            directories.push(mount.source)
            continue
        }
        if (mount.type !== 'overlay') continue
        for (const option of mount.options) {
            if (option.startsWith('upperdir=')) directories.unshift(option.slice(9))
            if (option.startsWith('lowerdir=')) directories.push(...option.slice(9).split(':'))
        }
    }
    return directories
}

/**
 * Read a file of the root file system of a snapshot from the directories of its layers (the snapshotter of the host,
 * readable by root): the top layer having it first, its deletions (the whiteouts of overlay) honoured, its symbolic
 * links resolved in the root file system
 * @param mounts
 * @param file an absolute path in the root file system
 * @param depth
 */
export async function readRootfsFile(mounts: SnapshotMount[], file: string, depth: number = 0): Promise<Buffer | undefined> {
    if (depth > 8) return undefined
    const relative: string = path.posix.normalize(file).replace(/^\/+/, '')
    for (const directory of layerDirectories(mounts)) {
        const target: string = path.join(directory, relative)
        let stats: Stats
        try {
            stats = await lstat(target)
        } catch {
            continue
        }
        //Deleted by this layer
        if (stats.isCharacterDevice() && stats.rdev === 0) return undefined
        if (stats.isSymbolicLink()) {
            const link: string = await readlink(target)
            return await readRootfsFile(mounts, link.startsWith('/') ? link : path.posix.join(path.posix.dirname('/' + relative), link), depth + 1)
        }
        if (!stats.isFile()) return undefined
        return await readFile(target)
    }
    return undefined
}

/**
 * The entries of a file of the database of the users or of the groups (name:x:id:…)
 * @param content
 */
function parseEntries(content: Buffer | undefined): string[][] {
    if (!content) return []
    return content.toString('utf8').split('\n').filter((line: string): boolean => !!line.trim() && !line.startsWith('#')).map((line: string): string[] => line.split(':'))
}

/**
 * Resolve the user of a process in a root file system (its /etc/passwd and /etc/group): user, user:group, uid, uid:gid
 * @param mounts
 * @param user empty for root
 */
export async function resolveUser(mounts: SnapshotMount[], user: string | undefined): Promise<ProcessUser> {
    const [userPart, groupPart] = (user ?? '').split(':')
    const passwd: string[][] = parseEntries(await readRootfsFile(mounts, '/etc/passwd'))
    let uid: number = 0
    let gid: number = 0
    let home: string = '/'
    let name: string | undefined = 'root'
    if (userPart) {
        const entry: string[] | undefined = passwd.find((fields: string[]): boolean => fields[0] === userPart) ?? (/^\d+$/.test(userPart) ? passwd.find((fields: string[]): boolean => fields[2] === userPart) : undefined)
        if (entry) {
            uid = Number(entry[2])
            gid = Number(entry[3])
            home = entry[5] || '/'
            name = entry[0]
        } else if (/^\d+$/.test(userPart)) {
            uid = Number(userPart)
            gid = Number(userPart)
            name = undefined
        } else {
            throw new Error(`The user "${userPart}" is not in the /etc/passwd of the image`)
        }
    } else {
        const root: string[] | undefined = passwd.find((fields: string[]): boolean => fields[2] === '0')
        if (root) home = root[5] || '/'
    }
    const groups: string[][] = parseEntries(await readRootfsFile(mounts, '/etc/group'))
    if (groupPart) {
        const entry: string[] | undefined = groups.find((fields: string[]): boolean => fields[0] === groupPart)
        if (entry) gid = Number(entry[2])
        else if (/^\d+$/.test(groupPart)) gid = Number(groupPart)
        else throw new Error(`The group "${groupPart}" is not in the /etc/group of the image`)
    }
    //The groups the user is a member of (supplementary)
    const additionalGids: number[] = name ? groups
        .filter((fields: string[]): boolean => (fields[3] ?? '').split(',').includes(name!) && Number(fields[2]) !== gid)
        .map((fields: string[]): number => Number(fields[2])) : []
    return {uid: uid, gid: gid, additionalGids: [...new Set(additionalGids)], home: home}
}

/**
 * A file system read from the host: a directory (the root of a process), or the directories of the layers of a snapshot
 */
export interface FileTree {
    /**
     * A path whose symbolic links are resolved in the file system (not in the one of the host)
     * @param file an absolute path in the file system
     */
    resolve(file: string): Promise<string>

    /**
     * The stats of a path (its link not followed) and the path of the host to read it, undefined when it does not exist
     * @param file
     */
    lstat(file: string): Promise<{ stats: Stats, path: string } | undefined>

    /**
     * The names of the entries of a directory, sorted
     * @param directory
     */
    readdir(directory: string): Promise<string[]>
}

/**
 * The resolution of the symbolic links of a path in a file tree
 * @param tree
 * @param file
 */
async function resolveInTree(tree: FileTree, file: string): Promise<string> {
    const pending: string[] = path.posix.normalize(`/${file}`).split('/').filter(Boolean)
    let current: string = '/'
    let links: number = 0
    while (pending.length) {
        const part: string = pending.shift()!
        if (part === '..') {
            current = path.posix.dirname(current)
            continue
        }
        const candidate: string = path.posix.join(current, part)
        const found = await tree.lstat(candidate)
        if (found?.stats.isSymbolicLink()) {
            if (++links > 40) throw new Error(`The path ${file} has too many symbolic links`)
            const target: string = await readlink(found.path)
            if (target.startsWith('/')) current = '/'
            pending.unshift(...target.split('/').filter(Boolean))
            continue
        }
        current = candidate
    }
    return current
}

/**
 * A file system of a directory of the host (/proc/<pid>/root: the one of a running container, its mounts with it)
 */
export class DirectoryTree implements FileTree {

    constructor(protected readonly root: string) {
    }

    public resolve(file: string): Promise<string> {
        return resolveInTree(this, file)
    }

    public async lstat(file: string): Promise<{ stats: Stats, path: string } | undefined> {
        const real: string = path.join(this.root, path.posix.normalize(`/${file}`))
        try {
            return {stats: await lstat(real), path: real}
        } catch {
            return undefined
        }
    }

    public async readdir(directory: string): Promise<string[]> {
        return (await readdir(path.join(this.root, path.posix.normalize(`/${directory}`)))).sort()
    }
}

/**
 * Whether stats are the ones of a whiteout of overlay (a deletion of a layer)
 * @param stats
 */
function isWhiteout(stats: Stats): boolean {
    return stats.isCharacterDevice() && stats.rdev === 0
}

/**
 * A file system of the layers of a snapshot (the directories of overlay, the top one first): the deletions of the upper
 * layers (their whiteouts) hide the entries of the lower ones
 */
export class LayersTree implements FileTree {

    constructor(protected readonly layers: string[]) {
    }

    public resolve(file: string): Promise<string> {
        return resolveInTree(this, file)
    }

    protected async stat(file: string): Promise<Stats | undefined> {
        try {
            return await lstat(file)
        } catch {
            return undefined
        }
    }

    public async lstat(file: string): Promise<{ stats: Stats, path: string } | undefined> {
        const parts: string[] = path.posix.normalize(`/${file}`).split('/').filter(Boolean)
        for (const layer of this.layers) {
            //An ancestor deleted (or replaced by a file) by this layer hides the path in the lower layers
            for (let length = 1; length < parts.length; length++) {
                const ancestor: Stats | undefined = await this.stat(path.join(layer, ...parts.slice(0, length)))
                if (ancestor && (isWhiteout(ancestor) || !ancestor.isDirectory())) return undefined
            }
            const real: string = path.join(layer, ...parts)
            const stats: Stats | undefined = await this.stat(real)
            if (!stats) continue
            return isWhiteout(stats) ? undefined : {stats: stats, path: real}
        }
        return undefined
    }

    public async readdir(directory: string): Promise<string[]> {
        const parts: string[] = path.posix.normalize(`/${directory}`).split('/').filter(Boolean)
        const names: Map<string, boolean> = new Map()
        for (const layer of this.layers) {
            const stats: Stats | undefined = await this.stat(path.join(layer, ...parts))
            if (!stats) continue
            //Deleted or replaced by this layer: the lower layers are hidden
            if (!stats.isDirectory()) break
            for (const name of await readdir(path.join(layer, ...parts))) {
                if (names.has(name)) continue
                const entry: Stats | undefined = await this.stat(path.join(layer, ...parts, name))
                names.set(name, !!entry && !isWhiteout(entry))
            }
        }
        return [...names].filter(([, present]): boolean => present).map(([name]): string => name).sort()
    }
}
