/*
 * The context of a build: the files of a directory packed into a gzipped tar archive, as dockerode prepares it (with
 * tar-fs and @balena/dockerignore, see THIRD_PARTY_NOTICES.md), modified: an error of the packing fails the archive
 * (instead of ending it), and each file is packed once
 */
import {createReadStream, type Stats} from 'node:fs'
import {lstat, readdir, readFile, readlink} from 'node:fs/promises'
import path from 'node:path'
import {pipeline} from 'node:stream/promises'
import {createGzip, type Gzip} from 'node:zlib'
import {pack as TarPack, type Pack} from 'tar-stream'
import {DockerIgnore} from './DockerIgnore.js'

export type BuildContextOptions = {
    /**
     * The directory of the context
     */
    directory: string
    /**
     * The files and the directories packed (their paths relative to the directory): the directories are packed with
     * their content
     */
    entries: string[]
    /**
     * The files packed even when .dockerignore excludes them (the Dockerfile, as the docker command does)
     */
    always?: string[]
}

/**
 * The path of an entry of the archive ("/" separated, relative)
 * @param entry
 */
function EntryName(entry: string): string {
    return path.posix.normalize(entry.split(path.sep).join('/')).replace(/^(\.\/)+/, '').replace(/\/+$/, '')
}

/**
 * Pack the context of a build: a gzipped tar stream; the files excluded by the .dockerignore of the directory are
 * skipped. An error of the packing (a file which cannot be read, or changes while it is read) is an error of the stream
 * @param options
 */
export function PackBuildContext(options: BuildContextOptions): Gzip {
    const archive: Pack = TarPack()
    const gzip: Gzip = createGzip()
    archive.once('error', (error: Error): unknown => gzip.destroy(error))
    archive.pipe(gzip)
    ;(async (): Promise<void> => {
        const root: string = path.resolve(options.directory)
        let ignore: DockerIgnore = new DockerIgnore()
        try {
            ignore = new DockerIgnore(await readFile(path.join(root, '.dockerignore'), 'utf8'))
        } catch {
            //No .dockerignore
        }
        const always: Set<string> = new Set((options.always ?? []).map(EntryName))
        const packed: Set<string> = new Set()
        const add = async (name: string): Promise<void> => {
            if (!name || name === '.' || name.startsWith('../') || packed.has(name)) return
            if (!always.has(name) && ignore.ignores(name)) return
            packed.add(name)
            const file: string = path.join(root, name)
            const stats: Stats = await lstat(file)
            const header = {name: name, mode: stats.mode & 0o7777, mtime: stats.mtime, uid: stats.uid, gid: stats.gid}
            if (stats.isDirectory()) {
                await new Promise<void>((resolve: () => void, reject: (error: Error) => void): unknown => archive.entry({...header, type: 'directory'}, (error?: Error | null): void => error ? reject(error) : resolve()))
                for (const child of (await readdir(file)).sort()) await add(`${name}/${child}`)
            } else if (stats.isSymbolicLink()) {
                //The links of the images are the ones of Linux: "/" separated (readlink gives backslashes on Windows)
                const target: string = (await readlink(file)).split(path.sep).join('/')
                await new Promise<void>((resolve: () => void, reject: (error: Error) => void): unknown => archive.entry({...header, type: 'symlink', linkname: target}, (error?: Error | null): void => error ? reject(error) : resolve()))
            } else if (stats.isFile()) {
                await pipeline(createReadStream(file), archive.entry({...header, type: 'file', size: stats.size}))
            }
            //The sockets and the pipes are not packed
        }
        for (const entry of options.entries) await add(EntryName(entry))
        archive.finalize()
    })().catch((error: Error): unknown => gzip.destroy(error))
    return gzip
}
