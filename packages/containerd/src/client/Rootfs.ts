import {lstat, readFile, readlink} from 'node:fs/promises'
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
export function LayerDirectories(mounts: SnapshotMount[]): string[] {
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
export async function ReadRootfsFile(mounts: SnapshotMount[], file: string, depth: number = 0): Promise<Buffer | undefined> {
    if (depth > 8) return undefined
    const relative: string = path.posix.normalize(file).replace(/^\/+/, '')
    for (const directory of LayerDirectories(mounts)) {
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
            return await ReadRootfsFile(mounts, link.startsWith('/') ? link : path.posix.join(path.posix.dirname('/' + relative), link), depth + 1)
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
function Entries(content: Buffer | undefined): string[][] {
    if (!content) return []
    return content.toString('utf8').split('\n').filter((line: string): boolean => !!line.trim() && !line.startsWith('#')).map((line: string): string[] => line.split(':'))
}

/**
 * Resolve the user of a process in a root file system (its /etc/passwd and /etc/group): user, user:group, uid, uid:gid
 * @param mounts
 * @param user empty for root
 */
export async function ResolveUser(mounts: SnapshotMount[], user: string | undefined): Promise<ProcessUser> {
    const [userPart, groupPart] = (user ?? '').split(':')
    const passwd: string[][] = Entries(await ReadRootfsFile(mounts, '/etc/passwd'))
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
    const groups: string[][] = Entries(await ReadRootfsFile(mounts, '/etc/group'))
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
