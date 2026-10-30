import {after, before, describe, it} from 'node:test'
import assert from 'node:assert'
import {mkdir, mkdtemp, rm, symlink, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {type glob as UpstreamGlob, type globSync as UpstreamGlobSync} from 'glob'
import {Glob, GlobSync, type GlobOptions} from '../exports/Utils.js'

/**
 * The files of the tree of the tests
 */
const FILES: string[] = [
    'a/b/c.js', 'a/b/.dot.js', 'a/B.js', 'a/b/d/e.js', 'a/f.txt', 'a/.hidden/x.js',
    'src/index.ts', 'src/lib/util.ts', 'src/lib/util.spec.ts', 'src/.env',
    '.git/config', 'file1.txt', 'file2.txt', 'file10.txt', 'README.md', 'space name.js', 'weird[x].js'
]

/**
 * The patterns compared with the upstream
 */
const PATTERNS: string[] = [
    '*', '**', '**/*', '*.js', '**/*.js', 'a/*', 'a/**', 'a/**/*.js', '**/b/*.js', 'a/b/**', '?/*', 'file?.txt',
    'file[12].txt', 'file[!1].txt', 'file{1,2}.txt', 'file{1..10}.txt', '{a,src}/**/*.{js,ts}', 'src/**', '**/.*', '.*',
    'a/', '*/', '**/', 'a/b', 'a/b/c.js', 'missing/*', './a/*', 'src/../a/*', 'a/b/../f.txt', 'A/*', '**/*.JS', 'a/**/',
    'space*', 'weird\\[x\\].js', 'src/**/*.spec.ts', '**/d/**', 'a/*/', '*/*/*.js'
]

/**
 * The options compared with the upstream
 */
const OPTIONS: GlobOptions[] = [
    {}, {dot: true}, {nodir: true}, {absolute: true}, {ignore: ['**/*.spec.ts']}, {ignore: 'a/**'}, {ignore: ['**/b/**', '*.txt']},
    {nocase: false}, {dot: true, nodir: true}
]

/**
 * Sort the results of the upstream (in no order)
 * @param results
 */
function sorted(results: string[]): string[] {
    return [...results].sort()
}

//glob 13, the reference, loads on Node.js 18.19, 19.9 and later (its lru-cache imports diagnostics_channel.tracingChannel):
//the comparisons with it are skipped on the older ones
const UPSTREAM: { glob: typeof UpstreamGlob, globSync: typeof UpstreamGlobSync } | undefined = await import('glob').catch((): undefined => undefined)

const NO_UPSTREAM: string | false = !UPSTREAM && 'glob 13 loads on Node.js 18.19, 19.9 and later'

describe('Glob', (): void => {

    let root: string

    before(async (): Promise<void> => {
        root = await mkdtemp(path.join(tmpdir(), 'lakutata-glob-'))
        for (const file of FILES) {
            await mkdir(path.dirname(path.join(root, file)), {recursive: true})
            await writeFile(path.join(root, file), file)
        }
    })

    after(async (): Promise<void> => rm(root, {recursive: true, force: true}))

    it('matches as the upstream glob', {skip: NO_UPSTREAM}, (): void => {
        for (const options of OPTIONS) {
            for (const pattern of PATTERNS) {
                const settings: GlobOptions = {...options, cwd: root}
                assert.deepStrictEqual(GlobSync(pattern, settings), sorted(UPSTREAM!.globSync(pattern, settings) as string[]), `${pattern} ${JSON.stringify(options)}`)
            }
        }
    })

    it('matches the absolute patterns and the patterns of a sub directory as the upstream glob', {skip: NO_UPSTREAM}, (): void => {
        for (const pattern of ['a/*', '**/*.js', 'src/**']) {
            const absolute: string = path.join(root, pattern)
            assert.deepStrictEqual(GlobSync(absolute), sorted(UPSTREAM!.globSync(absolute)), absolute)
            assert.deepStrictEqual(GlobSync(pattern, {cwd: path.join(root, 'a')}), sorted(UPSTREAM!.globSync(pattern, {cwd: path.join(root, 'a')})), `${pattern} in a`)
        }
        assert.deepStrictEqual(GlobSync(['a/*.js', 'src/*.ts', 'a/*.js'], {cwd: root}), sorted(UPSTREAM!.globSync(['a/*.js', 'src/*.ts', 'a/*.js'], {cwd: root})))
    })

    it('gives the same results asynchronously', {skip: NO_UPSTREAM}, async (): Promise<void> => {
        for (const pattern of PATTERNS) assert.deepStrictEqual(await Glob(pattern, {cwd: root}), GlobSync(pattern, {cwd: root}), pattern)
        assert.deepStrictEqual(await Glob('**/*.ts', {cwd: root}), sorted(await UPSTREAM!.glob('**/*.ts', {cwd: root})))
    })

    it('follows the links of directories when asked, without looping on their cycles', async (): Promise<void> => {
        const tree: string = await mkdtemp(path.join(tmpdir(), 'lakutata-glob-links-'))
        try {
            await mkdir(path.join(tree, 'real/sub'), {recursive: true})
            await writeFile(path.join(tree, 'real/sub/module.js'), '')
            await symlink(path.join(tree, 'real'), path.join(tree, 'linked'), 'dir')
            //A cycle: real/sub/back -> real
            await symlink(path.join(tree, 'real'), path.join(tree, 'real/sub/back'), 'dir')
            //The paths of the results are the ones of the platform (backslashes on Windows)
            const posix = (files: string[]): string[] => files.map((file: string): string => file.split(path.sep).join('/'))
            assert.deepStrictEqual(posix(GlobSync('**/*.js', {cwd: tree, nodir: true})), ['real/sub/module.js'])
            assert.deepStrictEqual(posix(GlobSync('**/*.js', {cwd: tree, nodir: true, follow: true})), ['linked/sub/module.js', 'real/sub/module.js'])
            assert.deepStrictEqual(posix(GlobSync('linked/*/*.js', {cwd: tree})), ['linked/sub/module.js'])
        } finally {
            await rm(tree, {recursive: true, force: true})
        }
    })
})
