import {chmod, mkdir, symlink, writeFile} from 'node:fs/promises'
import path from 'node:path'
import {gunzipSync} from 'node:zlib'

/**
 * An entry of an archive
 */
export type TarEntry = {
    name: string
    type: string
    mode: number
    data: Buffer
    linkName: string
}

/**
 * A text field of a header
 * @param header
 * @param offset
 * @param length
 */
function Field(header: Buffer, offset: number, length: number): string {
    const field: Buffer = header.subarray(offset, offset + length)
    const end: number = field.indexOf(0)
    return field.subarray(0, end < 0 ? length : end).toString('utf8')
}

/**
 * An octal number field of a header
 * @param header
 * @param offset
 * @param length
 */
function Octal(header: Buffer, offset: number, length: number): number {
    const text: string = Field(header, offset, length).trim()
    return text ? parseInt(text, 8) : 0
}

/**
 * The records of an extended (pax) header
 * @param data
 */
function PaxRecords(data: Buffer): Record<string, string> {
    const records: Record<string, string> = {}
    let offset: number = 0
    while (offset < data.length) {
        const space: number = data.indexOf(0x20, offset)
        if (space < 0) break
        const length: number = parseInt(data.subarray(offset, space).toString('utf8'), 10)
        if (!length) break
        const record: string = data.subarray(space + 1, offset + length - 1).toString('utf8')
        const equals: number = record.indexOf('=')
        if (equals > 0) records[record.slice(0, equals)] = record.slice(equals + 1)
        offset += length
    }
    return records
}

/**
 * The entries of a tar archive (ustar, with the long names of pax and GNU)
 * @param archive
 */
export function ReadTar(archive: Buffer): TarEntry[] {
    const entries: TarEntry[] = []
    let offset: number = 0
    let longName: string | undefined
    let longLink: string | undefined
    while (offset + 512 <= archive.length) {
        const header: Buffer = archive.subarray(offset, offset + 512)
        //Two empty blocks end the archive
        if (header.every((byte: number): boolean => byte === 0)) break
        const size: number = Octal(header, 124, 12)
        const type: string = Field(header, 156, 1) || '0'
        const data: Buffer = archive.subarray(offset + 512, offset + 512 + size)
        offset += 512 + Math.ceil(size / 512) * 512
        if (type === 'x') {
            const records: Record<string, string> = PaxRecords(data)
            longName = records.path ?? longName
            longLink = records.linkpath ?? longLink
            continue
        }
        if (type === 'L') {
            longName = Field(data, 0, data.length)
            continue
        }
        if (type === 'K') {
            longLink = Field(data, 0, data.length)
            continue
        }
        if (type === 'g') continue
        const prefix: string = Field(header, 345, 155)
        const name: string = longName ?? (prefix ? `${prefix}/${Field(header, 0, 100)}` : Field(header, 0, 100))
        entries.push({name: name, type: type, mode: Octal(header, 100, 8), data: data, linkName: longLink ?? Field(header, 157, 100)})
        longName = undefined
        longLink = undefined
    }
    return entries
}

/**
 * Extract a gzipped tar archive into a directory
 * @param archive
 * @param directory
 * @param select the path of an entry in the directory, from its path in the archive (without its leading "/"), undefined to skip it
 * @return the paths of the files extracted, relative to the directory
 */
export async function ExtractTarGz(archive: Buffer, directory: string, select: (name: string) => string | undefined = (name: string): string => name): Promise<string[]> {
    const root: string = path.resolve(directory)
    const files: string[] = []
    for (const entry of ReadTar(gunzipSync(archive))) {
        const selected: string | undefined = select(entry.name.split('/').filter((part: string): boolean => !!part).join('/'))
        if (!selected) continue
        const target: string = path.resolve(root, selected)
        //An entry cannot be written outside of the directory
        if (target !== root && !target.startsWith(`${root}${path.sep}`)) throw new Error(`The archive entry "${entry.name}" is outside of the target directory`)
        switch (entry.type) {
            case '5':
                await mkdir(target, {recursive: true})
                break
            case '0':
            case '7': {
                await mkdir(path.dirname(target), {recursive: true})
                await writeFile(target, entry.data)
                //The executable bits are kept (the scripts of the templates)
                if (entry.mode & 0o111) await chmod(target, 0o755)
                files.push(selected)
                break
            }
            case '2': {
                const linked: string = path.resolve(path.dirname(target), entry.linkName)
                if (!linked.startsWith(`${root}${path.sep}`)) throw new Error(`The archive link "${entry.name}" points outside of the target directory`)
                await mkdir(path.dirname(target), {recursive: true})
                await symlink(entry.linkName, target)
                break
            }
            default:
                //The hard links and the special files are not extracted
                break
        }
    }
    return files
}

/**
 * Select the entries of an archive under a path, without it
 * @param prefix the path ("package/template"), or the number of the leading elements removed
 */
export function Under(prefix: string | number): (name: string) => string | undefined {
    if (typeof prefix === 'number') return (name: string): string | undefined => name.split('/').slice(prefix).join('/') || undefined
    const start: string = `${prefix.replace(/\/+$/, '')}/`
    return (name: string): string | undefined => name.startsWith(start) ? name.slice(start.length) || undefined : undefined
}
