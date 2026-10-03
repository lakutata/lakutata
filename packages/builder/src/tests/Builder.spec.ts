import {after, before, describe, it} from 'node:test'
import assert from 'node:assert'
import {execFileSync} from 'node:child_process'
import {lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {deflateSync} from 'node:zlib'
import {BuildExecutable, BuildInstaller, BundleProject, ProgramName} from '../index.js'
import {ApplicationIcon, DecodePng, EncodePng, IcnsFile, IcoFile, ICO_SIZES, Resize, type Image} from '../lib/Icons.js'

describe('The builder of the applications', (): void => {

    let project: string

    /**
     * Write a file of the project
     * @param file
     * @param content
     */
    function Write(file: string, content: string): void {
        mkdirSync(path.dirname(path.join(project, file)), {recursive: true})
        writeFileSync(path.join(project, file), content)
    }

    before((): void => {
        project = mkdtempSync(path.join(tmpdir(), 'lakutata-builder-'))
        //An application reading its resource where the packed applications are told it is (ResourcesPath of lakutata)
        Write('package.json', JSON.stringify({name: '@acme/reader', version: '1.0.0', main: 'build/index.js', lakutata: {resources: [{from: 'data', to: 'texts'}]}}))
        Write('data/hello.txt', 'Hello')
        Write('build/index.js', `const resources = globalThis[Symbol.for('lakutata.packaged')].resources()
console.log(require('./words.js') + ' ' + require('node:fs').readFileSync(require('node:path').join(resources, 'texts', 'hello.txt'), 'utf8'))`)
        Write('build/words.js', `module.exports = 'read'`)
    })

    after((): void => rmSync(project, {recursive: true, force: true}))

    it('names the program after the bin of the package, else its name without its scope', (): void => {
        assert.strictEqual(ProgramName({name: '@acme/reader', bin: {read: 'index.js'}}), 'read')
        assert.strictEqual(ProgramName({name: '@acme/reader'}), 'reader')
    })

    it('bundles the application, its resources next to it', async (): Promise<void> => {
        const result = await BundleProject({project: project})
        assert.strictEqual(result.outfile, path.join(project, 'dist', 'reader.cjs'))
        assert.deepStrictEqual(result.resources, ['texts'])
        assert.strictEqual(result.resourcesDirectory, path.join(project, 'dist', 'reader.resources'))
        assert.strictEqual(execFileSync(process.execPath, [result.outfile], {cwd: tmpdir()}).toString().trim(), 'read Hello')
    })

    it('makes the executable in a directory, which runs without Node.js', async (): Promise<void> => {
        const result = await BuildExecutable({project: project, layout: 'directory'})
        assert.match(result.runtime, /^Node\.js v\d+/)
        assert.strictEqual(result.directory, path.join(project, 'dist', 'reader'))
        assert.deepStrictEqual(readdirSync(result.directory!).sort(), [path.basename(result.file), 'resources'].sort())
        assert.strictEqual(execFileSync(result.file, [], {cwd: tmpdir(), env: {PATH: ''}}).toString().trim(), 'read Hello')
    })

    it('makes the installers of macOS: the package of its installer, the archive of the directory', {skip: process.platform !== 'darwin' && 'made on macOS'}, async (): Promise<void> => {
        Write('package.json', JSON.stringify({
            name: '@acme/reader', version: '1.2.3', description: 'Reads', main: 'build/index.js', bin: {read: 'build/index.js'},
            lakutata: {resources: [{from: 'data', to: 'texts'}], installer: {name: 'reader', appId: 'com.acme.reader', service: {env: {PORT: '18080'}, args: ['--serve']}}}
        }))
        const result = await BuildInstaller({project: project})
        const arch: string = process.arch
        assert.deepStrictEqual(result.files.map(({target, file}): string => `${target} ${path.basename(file)}`), [`pkg reader-1.2.3-${arch}.pkg`, `tar.gz reader-1.2.3-darwin-${arch}.tar.gz`])
        //Its payload: the application in /usr/local/lib, its program in the PATH, its service
        const expanded: string = path.join(project, 'expanded')
        execFileSync('pkgutil', ['--expand-full', result.files[0].file, expanded])
        const component: string = path.join(expanded, readdirSync(expanded).find((name: string): boolean => name.endsWith('.pkg'))!)
        const payload: string = path.join(component, 'Payload')
        assert.deepStrictEqual(readdirSync(path.join(payload, 'usr', 'local', 'lib', 'reader')).sort(), ['read', 'resources', 'uninstall'])
        assert.strictEqual(readlinkSync(path.join(payload, 'usr', 'local', 'bin', 'read')), '../lib/reader/read')
        const daemon: string = path.join(payload, 'Library', 'LaunchDaemons', 'com.acme.reader.plist')
        execFileSync('plutil', ['-lint', daemon])
        const job = JSON.parse(execFileSync('plutil', ['-convert', 'json', '-o', '-', daemon]).toString())
        assert.deepStrictEqual(job.ProgramArguments.slice(3), ['/usr/local/lib/reader/read', '--serve'])
        assert.strictEqual(job.UserName, '_reader')
        assert.deepStrictEqual(job.KeepAlive, {SuccessfulExit: false})
        assert.strictEqual(job.WorkingDirectory, '/usr/local/var/lib/reader')
        //Its scripts are sh, its program runs from the payload
        execFileSync('sh', ['-n', path.join(component, 'Scripts', 'postinstall')])
        execFileSync('sh', ['-n', path.join(payload, 'usr', 'local', 'lib', 'reader', 'uninstall')])
        assert.match(readFileSync(path.join(component, 'Scripts', 'postinstall'), 'utf8'), /PORT="18080"/)
        assert.ok(lstatSync(path.join(payload, 'usr', 'local', 'lib', 'reader', 'read')).mode & 0o111)
        assert.strictEqual(execFileSync(path.join(payload, 'usr', 'local', 'lib', 'reader', 'read'), [], {cwd: tmpdir(), env: {PATH: ''}}).toString().trim(), 'read Hello')
    })

    it('checks the scripts of the installers: their moments, their files, the installers running them', async (): Promise<void> => {
        const platform: string = process.platform === 'darwin' ? 'mac' : process.platform === 'win32' ? 'win' : 'linux'
        const installer = (config: Record<string, unknown>): void => Write('package.json', JSON.stringify({name: 'reader', version: '1.0.0', main: 'build/index.js', lakutata: {installer: {[platform]: config}}}))
        installer({scripts: {afterinstall: 'scripts/after.sh'}})
        await assert.rejects(BuildInstaller({project: project}), new RegExp(`The script lakutata\\.installer\\.${platform}\\.scripts\\.afterinstall is not one of preinstall, postinstall, preremove, postremove`))
        installer({scripts: {postinstall: 'scripts/missing.ps1'}})
        await assert.rejects(BuildInstaller({project: project}), /\(scripts\/missing\.ps1\) does not exist/)
        if (platform !== 'linux') {
            installer({[platform === 'mac' ? 'pkg' : 'msi']: {nativeScripts: {postinstall: 'scripts/missing.sh'}}})
            await assert.rejects(BuildInstaller({project: project, targets: [platform === 'mac' ? 'pkg' : 'msi']}), /the native scripts are the ones of the packages of Linux/)
        }
        if (platform === 'win') {
            Write('scripts/postinstall.sh', 'true')
            installer({scripts: {postinstall: 'scripts/postinstall.sh'}})
            await assert.rejects(BuildInstaller({project: project}), /must be a script of PowerShell \(\.ps1\)/)
        }
    })

    it('runs the scripts of the application from the package of macOS: given what it does, the directory of the application', {skip: process.platform !== 'darwin' && 'made on macOS'}, async (): Promise<void> => {
        //Run by their interpreters, their lines as they are written
        for (const hook of ['preinstall', 'postinstall', 'preremove', 'postremove']) Write(`scripts/${hook}.sh`, `#!/bin/bash\necho "${hook} $1 $LAKUTATA_INSTALL_DIR \${BASH_VERSION:+bash}" >> "$HOOKS_LOG" # it's 'quoted'\n`)
        Write('package.json', JSON.stringify({
            name: 'reader', version: '1.0.0', main: 'build/index.js',
            lakutata: {installer: {mac: {scripts: {preinstall: 'scripts/preinstall.sh', postinstall: 'scripts/preinstall.sh', preremove: 'scripts/preremove.sh', postremove: 'scripts/postremove.sh'}, pkg: {scripts: {postinstall: 'scripts/postinstall.sh'}}}}}
        }))
        const result = await BuildInstaller({project: project})
        assert.ok(result.warnings.includes('Some scripts of the application are not run by their installers: tar.gz (preinstall, postinstall, preremove, postremove)'), result.warnings.join('\n'))
        const expanded: string = path.join(project, 'expanded-scripts')
        rmSync(expanded, {recursive: true, force: true})
        execFileSync('pkgutil', ['--expand-full', result.files[0].file, expanded])
        const component: string = path.join(expanded, readdirSync(expanded).find((name: string): boolean => name.endsWith('.pkg'))!)
        const uninstall: string = path.join(component, 'Payload', 'usr', 'local', 'lib', 'reader', 'uninstall')
        for (const script of [path.join(component, 'Scripts', 'preinstall'), path.join(component, 'Scripts', 'postinstall'), uninstall]) execFileSync('sh', ['-n', script])
        //The installation (no service: run as the user): the preinstall script tells the postinstall one what it does
        const log: string = path.join(project, 'hooks.log')
        const temporary: string = mkdtempSync(path.join(tmpdir(), 'lakutata-installer-temp-'))
        const env = {...process.env, HOOKS_LOG: log, INSTALLER_TEMP: temporary}
        for (const script of ['preinstall', 'postinstall']) execFileSync(path.join(component, 'Scripts', script), [], {env: env})
        rmSync(temporary, {recursive: true, force: true})
        //The postinstall script of the package replaces the one of the platform
        assert.deepStrictEqual(readFileSync(log, 'utf8').trim().split('\n'), ['preinstall install /usr/local/lib/reader bash', 'postinstall install /usr/local/lib/reader bash'])
        //The removal runs its scripts (its uninstall script, as root)
        assert.match(readFileSync(uninstall, 'utf8'), /# scripts\/preremove\.sh\n[\s\S]*echo "preremove \$1 \$LAKUTATA_INSTALL_DIR \$\{BASH_VERSION:\+bash\}" >> "\$HOOKS_LOG" # it's 'quoted'\n[\s\S]*\/bin\/bash "\$lakutata_script" remove/)
    })

    it('reads the PNG images of every kind: gray, palette, transparent colors, 16 bits', (): void => {
        //A PNG of rows already filtered (filter None)
        const png = (width: number, height: number, depth: number, type: number, rows: Buffer[], chunks: [string, Buffer][] = []): Buffer => {
            const header: Buffer = Buffer.alloc(13)
            header.writeUInt32BE(width, 0)
            header.writeUInt32BE(height, 4)
            header[8] = depth
            header[9] = type
            //A chunk, its CRC left empty (not checked by the decoder)
            const chunk = (name: string, data: Buffer): Buffer => {
                const length: Buffer = Buffer.alloc(4)
                length.writeUInt32BE(data.length)
                return Buffer.concat([length, Buffer.from(name, 'latin1'), data, Buffer.alloc(4)])
            }
            const data: Buffer = deflateSync(Buffer.concat(rows.map((row: Buffer): Buffer => Buffer.concat([Buffer.from([0]), row]))))
            return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', header), ...chunks.map(([name, value]): Buffer => chunk(name, value)), chunk('IDAT', data), chunk('IEND', Buffer.alloc(0))])
        }
        const pixel = (image: Image, x: number, y: number): number[] => [...image.pixels.subarray((y * image.width + x) * 4, (y * image.width + x) * 4 + 4)]
        //Gray of 8 bits, its black transparent (tRNS)
        const gray: Image = DecodePng(png(2, 1, 8, 0, [Buffer.from([0, 200])], [['tRNS', Buffer.from([0, 0])]]))
        assert.deepStrictEqual([pixel(gray, 0, 0), pixel(gray, 1, 0)], [[0, 0, 0, 0], [200, 200, 200, 255]])
        //A palette of 4 bits, its second color half transparent
        const palette: Image = DecodePng(png(3, 1, 4, 3, [Buffer.from([0x01, 0x20])], [['PLTE', Buffer.from([255, 0, 0, 0, 255, 0, 0, 0, 255])], ['tRNS', Buffer.from([255, 128])]]))
        assert.deepStrictEqual([pixel(palette, 0, 0), pixel(palette, 1, 0), pixel(palette, 2, 0)], [[255, 0, 0, 255], [0, 255, 0, 128], [0, 0, 255, 255]])
        //Gray of 2 bits, scaled to 8 bits
        assert.deepStrictEqual(pixel(DecodePng(png(1, 1, 2, 0, [Buffer.from([0xc0])])), 0, 0), [255, 255, 255, 255])
        //RGB of 16 bits
        assert.deepStrictEqual(pixel(DecodePng(png(1, 1, 16, 2, [Buffer.from([0x12, 0x34, 0x56, 0x78, 0x9a, 0xbc])])), 0, 0), [0x12, 0x56, 0x9a, 255])
        //RGBA, encoded and decoded
        const image: Image = {width: 2, height: 2, pixels: Buffer.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16])}
        assert.deepStrictEqual(DecodePng(EncodePng(image)), image)
        assert.throws((): unknown => DecodePng(Buffer.from('GIF89a'), 'logo.gif'), /logo\.gif is not a PNG image/)
    })

    it('makes the icons of each platform from an image: resized, their transparent edges keeping their colors', (): void => {
        //A red square on a transparent background
        const size: number = 512
        const pixels: Buffer = Buffer.alloc(size * size * 4)
        for (let y = 128; y < 384; y++) for (let x = 128; x < 384; x++) pixels.set([255, 0, 0, 255], (y * size + x) * 4)
        const image: Image = {width: size, height: size, pixels: pixels}
        const small: Image = Resize(image, 16)
        assert.deepStrictEqual([...small.pixels.subarray((8 * 16 + 8) * 4, (8 * 16 + 8) * 4 + 4)], [255, 0, 0, 255])
        assert.deepStrictEqual([...small.pixels.subarray(0, 4)], [0, 0, 0, 0])
        //The pixels covering the edge are red, half transparent (not darkened)
        const edge: Image = Resize(image, 3)
        assert.deepStrictEqual([...edge.pixels.subarray(0, 3)], [255, 0, 0])
        assert.ok(edge.pixels[3] > 0 && edge.pixels[3] < 255)
        //Windows: its sizes, the bitmaps (BITMAPINFOHEADER) and the PNG of 256
        const ico: Buffer = IcoFile(image)
        assert.strictEqual(ico.readUInt16LE(2), 1)
        assert.strictEqual(ico.readUInt16LE(4), ICO_SIZES.length)
        ICO_SIZES.forEach((iconSize: number, index: number): void => {
            const entry: number = 6 + index * 16
            assert.strictEqual(ico[entry], iconSize >= 256 ? 0 : iconSize)
            const data: Buffer = ico.subarray(ico.readUInt32LE(entry + 12), ico.readUInt32LE(entry + 12) + ico.readUInt32LE(entry + 8))
            if (iconSize >= 256) assert.strictEqual(DecodePng(data).width, 256)
            else assert.deepStrictEqual([data.readUInt32LE(0), data.readInt32LE(4), data.readInt32LE(8)], [40, iconSize, iconSize * 2])
        })
        //macOS: its sizes, but the ones larger than the image (1024)
        const icns: Buffer = IcnsFile(image)
        assert.strictEqual(icns.toString('latin1', 0, 4), 'icns')
        assert.strictEqual(icns.readUInt32BE(4), icns.length)
        const types: string[] = []
        for (let offset = 8; offset < icns.length; offset += icns.readUInt32BE(offset + 4)) types.push(icns.toString('latin1', offset, offset + 4))
        assert.deepStrictEqual(types, ['icp4', 'icp5', 'ic11', 'icp6', 'ic12', 'ic07', 'ic08', 'ic13', 'ic09', 'ic14'])
        if (process.platform === 'darwin') {
            //Read by the tools of macOS
            writeFileSync(path.join(project, 'icon.icns'), icns)
            writeFileSync(path.join(project, 'icon.ico'), ico)
            execFileSync('iconutil', ['-c', 'iconset', path.join(project, 'icon.icns'), '-o', path.join(project, 'icon.iconset')])
            const iconset: string[] = readdirSync(path.join(project, 'icon.iconset'))
            for (const name of ['icon_16x16.png', 'icon_16x16@2x.png', 'icon_32x32@2x.png', 'icon_128x128.png', 'icon_256x256@2x.png', 'icon_512x512.png']) assert.ok(iconset.includes(name), `${name}: ${iconset.join(', ')}`)
            assert.match(execFileSync('sips', ['-g', 'pixelWidth', path.join(project, 'icon.ico')]).toString(), /pixelWidth: 256/)
        }
    })

    it('checks the icon of the application: a square PNG image, 256 pixels at least', (): void => {
        const icon = (file: string, image?: Image): Record<string, any> => {
            if (image) writeFileSync(path.join(project, file), EncodePng(image))
            return {lakutata: {icon: file}}
        }
        assert.strictEqual(ApplicationIcon(project, {}), undefined)
        assert.throws((): unknown => ApplicationIcon(project, icon('missing.png')), /The icon of the application missing\.png \(lakutata\.icon\) does not exist/)
        assert.throws((): unknown => ApplicationIcon(project, icon('wide.png', {width: 512, height: 256, pixels: Buffer.alloc(512 * 256 * 4)})), /must be square \(it is 512x256\)/)
        assert.throws((): unknown => ApplicationIcon(project, icon('small.png', {width: 128, height: 128, pixels: Buffer.alloc(128 * 128 * 4)})), /must be 256 pixels at least \(it is 128\)/)
        assert.strictEqual(ApplicationIcon(project, icon('logo.png', {width: 256, height: 256, pixels: Buffer.alloc(256 * 256 * 4)}))!.image.width, 256)
    })

    it('tells to build a resource which does not exist', async (): Promise<void> => {
        Write('package.json', JSON.stringify({name: 'missing', version: '1.0.0', main: 'build/index.js', lakutata: {resources: [{from: 'ui/dist', to: 'ui'}]}}))
        await assert.rejects(BundleProject({project: project}), /The resource ui\/dist does not exist: build it first/)
    })
})
