import {existsSync} from 'node:fs'
import path from 'node:path'
import {runCommand} from '../Processes.js'
import {warn} from '../Output.js'
import {DEPENDENCY_FIELDS, type JSONFile, type Workspace, type WorkspacePackage} from './Workspace.js'
import {type ProcessResult} from '../../types/ProcessResult.js'

const VERSION: RegExp = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/

/**
 * Whether a string is a version (1.2.3, 1.3.0-beta.0)
 * @param version
 */
export function isVersion(version: string): boolean {
    return VERSION.test(version)
}

/**
 * The next version
 * @param current
 * @param bump a bump, or a version
 * @param preid the identifier of the prereleases ("beta"), none by default
 */
export function nextVersion(current: string, bump: string, preid?: string): string {
    if (VERSION.test(bump)) return bump
    const matched: RegExpExecArray | null = VERSION.exec(current)
    if (!matched) throw new Error(`The current version "${current}" is not a version`)
    const [major, minor, patch] = [Number(matched[1]), Number(matched[2]), Number(matched[3])]
    const prerelease: string | undefined = matched[4]
    const pre = (): string => preid ? `${preid}.0` : '0'
    switch (bump) {
        case 'major':
            return prerelease && minor === 0 && patch === 0 ? `${major}.0.0` : `${major + 1}.0.0`
        case 'minor':
            return prerelease && patch === 0 ? `${major}.${minor}.0` : `${major}.${minor + 1}.0`
        case 'patch':
            return prerelease ? `${major}.${minor}.${patch}` : `${major}.${minor}.${patch + 1}`
        case 'premajor':
            return `${major + 1}.0.0-${pre()}`
        case 'preminor':
            return `${major}.${minor + 1}.0-${pre()}`
        case 'prepatch':
            return `${major}.${minor}.${patch + 1}-${pre()}`
        case 'prerelease': {
            if (!prerelease) return `${major}.${minor}.${patch + 1}-${pre()}`
            const parts: string[] = prerelease.split('.')
            const last: number = Number(parts.at(-1))
            //1.0.0-beta.1 → 1.0.0-beta.2; another identifier starts again
            if (preid && parts[0] !== preid) return `${major}.${minor}.${patch}-${preid}.0`
            if (Number.isInteger(last)) parts[parts.length - 1] = String(last + 1)
            else parts.push('0')
            return `${major}.${minor}.${patch}-${parts.join('.')}`
        }
        default:
            throw new Error(`Invalid bump "${bump}": major, minor, patch, premajor, preminor, prepatch, prerelease or a version`)
    }
}

/**
 * The range of a dependency on a package of the workspace, for its new version: its prefix is kept ("^0.0.3" → "^0.0.4"),
 * the ranges which are not a version ("*", "workspace:*", "file:…") are kept
 * @param range
 * @param version
 */
export function updateRange(range: string, version: string): string {
    const matched: RegExpExecArray | null = /^(workspace:)?(\^|~|>=|<=|>|<|=)?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/.exec(range)
    return matched ? `${matched[1] ?? ''}${matched[2] ?? ''}${version}` : range
}

export type VersionOptions = {
    /**
     * The identifier of the prereleases
     */
    preid?: string
    /**
     * Commit the changes and tag them "v<version>"
     */
    git?: boolean
}

export type VersionPlan = {
    from: string
    to: string
    packages: { name: string, from: string | undefined }[]
}

/**
 * The versions a bump gives
 * @param workspace
 * @param bump
 * @param preid
 */
export function planVersion(workspace: Workspace, bump: string, preid?: string): VersionPlan {
    const from: string = workspace.version ?? '0.0.0'
    return {
        from: from,
        to: nextVersion(from, bump, preid),
        packages: workspace.packages.map((pkg: WorkspacePackage): { name: string, from: string | undefined } => ({name: pkg.name, from: pkg.version}))
    }
}

/**
 * Give the packages of the workspace a version (a fixed version: the same for all), update the dependencies between them and the lock file
 * @param workspace
 * @param plan
 * @param options
 */
export async function applyVersion(workspace: Workspace, plan: VersionPlan, options: VersionOptions = {}): Promise<string[]> {
    const git = async (args: string[]): Promise<string> => {
        const result = await runCommand('git', args, workspace.root)
        if (result.code !== 0) throw new Error(`git ${args[0]} failed: ${result.output.trim()}`)
        return result.output
    }
    //Checked before a file is changed: a repository, and a tag which does not exist yet
    if (options.git) {
        if ((await runCommand('git', ['rev-parse', '--is-inside-work-tree'], workspace.root).catch((error: Error): ProcessResult => ({code: 1, output: error.message}))).code !== 0) throw new Error(`${workspace.root} is not in a git repository: --git commits the version there`)
        if ((await runCommand('git', ['rev-parse', '-q', '--verify', `refs/tags/v${plan.to}`], workspace.root)).code === 0) throw new Error(`The tag v${plan.to} exists already`)
    }
    const names: Set<string> = new Set(workspace.packages.map((pkg: WorkspacePackage): string => pkg.name))
    const changed: JSONFile[] = []
    for (const pkg of workspace.packages) {
        const data: Record<string, any> = pkg.manifest.data
        data.version = plan.to
        for (const field of DEPENDENCY_FIELDS) {
            for (const [name, range] of Object.entries<string>(data[field] ?? {})) {
                if (names.has(name)) data[field][name] = updateRange(range, plan.to)
            }
        }
        changed.push(pkg.manifest)
    }
    //The version of the workspace is kept by lerna.json when it gives one, by the root package.json otherwise
    if (workspace.lerna?.data.version !== undefined) {
        workspace.lerna.data.version = plan.to
        changed.push(workspace.lerna)
    } else {
        workspace.manifest.data.version = plan.to
        changed.push(workspace.manifest)
    }
    //The root package.json may depend on the packages too
    for (const field of DEPENDENCY_FIELDS) {
        for (const [name, range] of Object.entries<string>(workspace.manifest.data[field] ?? {})) {
            if (names.has(name)) workspace.manifest.data[field][name] = updateRange(range, plan.to)
        }
    }
    if (!changed.includes(workspace.manifest)) changed.push(workspace.manifest)
    for (const file of changed) await file.write()
    const files: string[] = changed.map((file: JSONFile): string => file.file)
    //The lock file follows (npm ci and the frozen installs fail otherwise)
    const lock: { file: string, command: string, args: string[] } | undefined = [
        {file: 'package-lock.json', command: 'npm', args: ['install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund']},
        {file: 'pnpm-lock.yaml', command: 'pnpm', args: ['install', '--lockfile-only', '--ignore-scripts']}
    ].find((candidate): boolean => existsSync(path.join(workspace.root, candidate.file)))
    if (lock) {
        const result = await runCommand(lock.command, lock.args, workspace.root).catch((error: Error): ProcessResult => ({code: 1, output: error.message}))
        if (result.code === 0) files.push(path.join(workspace.root, lock.file))
        else warn(`The lock file ${lock.file} is not updated (run ${lock.command} install): ${result.output.trim().split('\n').slice(-3).join(' ')}`)
    } else if (existsSync(path.join(workspace.root, 'yarn.lock'))) {
        warn('yarn.lock is not updated: run yarn install')
    }
    if (options.git) {
        //Only the files of the version are committed, the changes staged before kept staged
        await git(['add', ...files])
        await git(['commit', '-m', `v${plan.to}`, '--', ...files])
        await git(['tag', `v${plan.to}`])
    }
    return files
}
