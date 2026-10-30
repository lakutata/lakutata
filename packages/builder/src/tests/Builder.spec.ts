import {after, before, describe, it} from 'node:test'
import assert from 'node:assert'
import {execFileSync} from 'node:child_process'
import {lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {deflateSync} from 'node:zlib'
import {buildExecutable, buildInstaller, bundleProject, programName} from '../index.js'
import {applicationIcon, decodePng, encodePng, icnsFile, icoFile, ICO_SIZES, resize, type Image} from '../lib/Icons.js'
import {NODE_EXECUTABLE, NO_NODE_EXECUTABLE} from './support/NodeProgram.js'

describe('The builder of the applications', (): void => {

    let project: string

    /**
     * Write a file of the project
     * @param file
     * @param content
     */
    function write(file: string, content: string): void {
        mkdirSync(path.dirname(path.join(project, file)), {recursive: true})
        writeFileSync(path.join(project, file), content)
    }

    before((): void => {
        project = mkdtempSync(path.join(tmpdir(), 'lakutata-builder-'))
        //An application reading its resource where the packed applications are told it is (resourcesPath of lakutata)
        write('package.json', JSON.stringify({name: '@acme/reader', version: '1.0.0', main: 'build/index.js', lakutata: {resources: [{from: 'data', to: 'texts'}]}}))
        write('data/hello.txt', 'Hello')
        write('build/index.js', `const resources = globalThis[Symbol.for('lakutata.packaged')].resources()
console.log(require('./words.js') + ' ' + require('node:fs').readFileSync(require('node:path').join(resources, 'texts', 'hello.txt'), 'utf8'))`)
        write('build/words.js', `module.exports = 'read'`)
    })

    after((): void => rmSync(project, {recursive: true, force: true}))

    it('names the program after the bin of the package, else its name without its scope', (): void => {
        assert.strictEqual(programName({name: '@acme/reader', bin: {read: 'index.js'}}), 'read')
        assert.strictEqual(programName({name: '@acme/reader'}), 'reader')
    })

    it('bundles the application, its resources next to it', async (): Promise<void> => {
        const result = await bundleProject({project: project})
        assert.strictEqual(result.outfile, path.join(project, 'dist', 'reader.cjs'))
        assert.deepStrictEqual(result.resources, ['texts'])
        assert.strictEqual(result.resourcesDirectory, path.join(project, 'dist', 'reader.resources'))
        assert.strictEqual(execFileSync(process.execPath, [result.outfile], {cwd: tmpdir()}).toString().trim(), 'read Hello')
    })

    it('bundles in the syntax of the version of Node.js given, else in the one of the Node.js running the build', async (): Promise<void> => {
        write('build/static.js', `class Counter { static { console.log('static') } }\nnew Counter()\n`)
        const current = await bundleProject({project: project, entry: 'build/static.js', outfile: path.join(project, 'dist', 'current.cjs'), minify: false})
        //A static block (Node.js 16.11) written for Node.js 14
        const older = await bundleProject({project: project, entry: 'build/static.js', outfile: path.join(project, 'dist', 'older.cjs'), minify: false, node: '14'})
        assert.match(readFileSync(current.outfile, 'utf8'), /static \{/)
        assert.doesNotMatch(readFileSync(older.outfile, 'utf8'), /static \{/)
        assert.strictEqual(execFileSync(process.execPath, [older.outfile], {cwd: tmpdir()}).toString().trim(), 'static')
    })

    it('tells the node program of an executable without the assets of the single executable applications (before Node.js 20.12)', {skip: process.platform === 'win32' && 'a script as the node program'}, async (): Promise<void> => {
        //A node program answering as Node.js 18.10 does to the probe of the builder
        write('old-node', '#!/bin/sh\nprintf "v18.10.0 false"\n')
        execFileSync('chmod', ['+x', path.join(project, 'old-node')])
        await assert.rejects(buildExecutable({project: project, nodeProgram: path.join(project, 'old-node')}), /\(Node\.js 20\.12, 21\.7 or later\): .*old-node is Node\.js v18\.10\.0\. Give a newer node program/)
        await assert.rejects(buildExecutable({project: project, nodeProgram: path.join(project, 'missing-node')}), /missing-node cannot be run as the node program of the executable/)
    })

    it('makes the executable in a directory, which runs without Node.js', {skip: NO_NODE_EXECUTABLE}, async (): Promise<void> => {
        const result = await buildExecutable({project: project, layout: 'directory', ...NODE_EXECUTABLE})
        assert.match(result.runtime, /^Node\.js v\d+/)
        assert.strictEqual(result.directory, path.join(project, 'dist', 'reader'))
        assert.deepStrictEqual(readdirSync(result.directory!).sort(), [path.basename(result.file), 'resources'].sort())
        assert.strictEqual(execFileSync(result.file, [], {cwd: tmpdir(), env: {PATH: ''}}).toString().trim(), 'read Hello')
    })

    it('makes the installers of macOS: the package of its installer, the archive of the directory', {skip: (process.platform !== 'darwin' && 'made on macOS') || NO_NODE_EXECUTABLE}, async (): Promise<void> => {
        write('package.json', JSON.stringify({
            name: '@acme/reader', version: '1.2.3', description: 'Reads', main: 'build/index.js', bin: {read: 'build/index.js'},
            lakutata: {resources: [{from: 'data', to: 'texts'}], installer: {name: 'reader', appId: 'com.acme.reader', service: {env: {PORT: '18080'}, args: ['--serve']}}}
        }))
        const result = await buildInstaller({project: project, ...NODE_EXECUTABLE})
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
        assert.strictEqual(job.RunAtLoad, true)
        assert.strictEqual(job.WorkingDirectory, '/usr/local/var/lib/reader')
        //Installed on the Macs of the architecture of the program only
        assert.match(readFileSync(path.join(expanded, 'Distribution'), 'utf8'), new RegExp(`hostArchitectures="${arch === 'arm64' ? 'arm64' : 'x86_64'}"`))
        //Enabled and started by the installation
        assert.match(readFileSync(path.join(component, 'Scripts', 'postinstall'), 'utf8'), /\nlaunchctl enable system\/com\.acme\.reader\nlaunchctl bootout system\/com\.acme\.reader/)
        //Its scripts are sh, its program runs from the payload
        execFileSync('sh', ['-n', path.join(component, 'Scripts', 'postinstall')])
        execFileSync('sh', ['-n', path.join(payload, 'usr', 'local', 'lib', 'reader', 'uninstall')])
        assert.match(readFileSync(path.join(component, 'Scripts', 'postinstall'), 'utf8'), /PORT="18080"/)
        assert.ok(lstatSync(path.join(payload, 'usr', 'local', 'lib', 'reader', 'read')).mode & 0o111)
        assert.strictEqual(execFileSync(path.join(payload, 'usr', 'local', 'lib', 'reader', 'read'), [], {cwd: tmpdir(), env: {PATH: ''}}).toString().trim(), 'read Hello')
    })

    it('disables at its installation a service of macOS which does not start with the system, restarted by its upgrades when it runs', {skip: (process.platform !== 'darwin' && 'made on macOS') || NO_NODE_EXECUTABLE}, async (): Promise<void> => {
        write('package.json', JSON.stringify({
            name: 'reader', version: '1.2.3', main: 'build/index.js',
            lakutata: {installer: {mac: {targets: ['pkg']}, service: {autoStart: false}}}
        }))
        const result = await buildInstaller({project: project, ...NODE_EXECUTABLE})
        const expanded: string = path.join(project, 'expanded-manual')
        rmSync(expanded, {recursive: true, force: true})
        execFileSync('pkgutil', ['--expand-full', result.files[0].file, expanded])
        const component: string = path.join(expanded, readdirSync(expanded).find((name: string): boolean => name.endsWith('.pkg'))!)
        const postinstall: string = readFileSync(path.join(component, 'Scripts', 'postinstall'), 'utf8')
        execFileSync('sh', ['-n', path.join(component, 'Scripts', 'postinstall')])
        //What the installation does comes from the preinstall script
        assert.match(readFileSync(path.join(component, 'Scripts', 'preinstall'), 'utf8'), /lakutata_action=upgrade; else lakutata_action=install/)
        assert.match(postinstall, /\nif launchctl print system\/reader >\/dev\/null 2>&1; then\n {4}launchctl bootout system\/reader[\s\S]*\n {4}launchctl bootstrap system \/Library\/LaunchDaemons\/reader\.plist\nelif \[ "\$lakutata_action" = install \]; then\n {4}launchctl disable system\/reader\nfi\n/)
        assert.doesNotMatch(postinstall, /launchctl enable/)
    })

    it('checks the scripts of the installers: their moments, their files, the installers running them', async (): Promise<void> => {
        const platform: string = process.platform === 'darwin' ? 'mac' : process.platform === 'win32' ? 'win' : 'linux'
        const installer = (config: Record<string, unknown>): void => write('package.json', JSON.stringify({name: 'reader', version: '1.0.0', main: 'build/index.js', lakutata: {installer: {[platform]: config}}}))
        installer({scripts: {afterinstall: 'scripts/after.sh'}})
        await assert.rejects(buildInstaller({project: project}), new RegExp(`The script lakutata\\.installer\\.${platform}\\.scripts\\.afterinstall is not one of preinstall, postinstall, preremove, postremove`))
        installer({scripts: {postinstall: 'scripts/missing.ps1'}})
        await assert.rejects(buildInstaller({project: project}), /\(scripts\/missing\.ps1\) does not exist/)
        if (platform !== 'linux') {
            installer({[platform === 'mac' ? 'pkg' : 'msi']: {nativeScripts: {postinstall: 'scripts/missing.sh'}}})
            await assert.rejects(buildInstaller({project: project, targets: [platform === 'mac' ? 'pkg' : 'msi']}), /the native scripts are the ones of the packages of Linux/)
        }
        //The options of the installers which are not made are checked too
        const other: string = {mac: 'pkg', win: 'msi', linux: 'rpm'}[platform]!
        installer({[other]: {scripts: {postinstall: `scripts/missing.${platform === 'win' ? 'ps1' : 'sh'}`}}})
        await assert.rejects(buildInstaller({project: project, targets: [platform === 'win' ? 'zip' : 'tar.gz']}), new RegExp(`lakutata\\.installer\\.${platform}\\.${other}\\.scripts\\.postinstall \\(scripts/missing\\.(sh|ps1)\\) does not exist`))
        if (platform !== 'linux') {
            installer({[other]: {nativeScripts: {postinstall: 'scripts/missing.sh'}}})
            await assert.rejects(buildInstaller({project: project, targets: [platform === 'win' ? 'zip' : 'tar.gz']}), (error: Error): boolean => /the native scripts are the ones of the packages of Linux lakutata makes \(deb, rpm, apk, archlinux\)$/.test(error.message))
        }
        //The user of the service is a name of user (or an account of Windows)
        write('package.json', JSON.stringify({name: 'reader', version: '1.0.0', main: 'build/index.js', lakutata: {installer: {service: {user: 'nobody; rm -rf /'}}}}))
        await assert.rejects(buildInstaller({project: project}), /The user of the service "nobody; rm -rf \/" must be/)
        if (platform === 'win') {
            write('scripts/postinstall.sh', 'true')
            installer({scripts: {postinstall: 'scripts/postinstall.sh'}})
            await assert.rejects(buildInstaller({project: project}), /must be a script of PowerShell \(\.ps1\)/)
        }
    })

    it('runs the scripts of the application from the package of macOS: given what it does, the directory of the application', {skip: (process.platform !== 'darwin' && 'made on macOS') || NO_NODE_EXECUTABLE}, async (): Promise<void> => {
        //Run by their interpreters, their lines as they are written
        for (const hook of ['preinstall', 'postinstall', 'preremove', 'postremove']) write(`scripts/${hook}.sh`, `#!/bin/bash\necho "${hook} $1 $LAKUTATA_INSTALL_DIR \${BASH_VERSION:+bash}" >> "$HOOKS_LOG" # it's 'quoted'\n`)
        write('package.json', JSON.stringify({
            name: 'reader', version: '1.0.0', main: 'build/index.js',
            lakutata: {installer: {mac: {scripts: {preinstall: 'scripts/preinstall.sh', postinstall: 'scripts/preinstall.sh', preremove: 'scripts/preremove.sh', postremove: 'scripts/postremove.sh'}, pkg: {scripts: {postinstall: 'scripts/postinstall.sh'}}}}}
        }))
        const result = await buildInstaller({project: project, ...NODE_EXECUTABLE})
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
        const gray: Image = decodePng(png(2, 1, 8, 0, [Buffer.from([0, 200])], [['tRNS', Buffer.from([0, 0])]]))
        assert.deepStrictEqual([pixel(gray, 0, 0), pixel(gray, 1, 0)], [[0, 0, 0, 0], [200, 200, 200, 255]])
        //A palette of 4 bits, its second color half transparent
        const palette: Image = decodePng(png(3, 1, 4, 3, [Buffer.from([0x01, 0x20])], [['PLTE', Buffer.from([255, 0, 0, 0, 255, 0, 0, 0, 255])], ['tRNS', Buffer.from([255, 128])]]))
        assert.deepStrictEqual([pixel(palette, 0, 0), pixel(palette, 1, 0), pixel(palette, 2, 0)], [[255, 0, 0, 255], [0, 255, 0, 128], [0, 0, 255, 255]])
        //Gray of 2 bits, scaled to 8 bits
        assert.deepStrictEqual(pixel(decodePng(png(1, 1, 2, 0, [Buffer.from([0xc0])])), 0, 0), [255, 255, 255, 255])
        //RGB of 16 bits
        assert.deepStrictEqual(pixel(decodePng(png(1, 1, 16, 2, [Buffer.from([0x12, 0x34, 0x56, 0x78, 0x9a, 0xbc])])), 0, 0), [0x12, 0x56, 0x9a, 255])
        //RGBA, encoded and decoded
        const image: Image = {width: 2, height: 2, pixels: Buffer.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16])}
        assert.deepStrictEqual(decodePng(encodePng(image)), image)
        assert.throws((): unknown => decodePng(Buffer.from('GIF89a'), 'logo.gif'), /logo\.gif is not a PNG image/)
    })

    it('makes the icons of each platform from an image: resized, their transparent edges keeping their colors', (): void => {
        //A red square on a transparent background
        const size: number = 512
        const pixels: Buffer = Buffer.alloc(size * size * 4)
        for (let y = 128; y < 384; y++) for (let x = 128; x < 384; x++) pixels.set([255, 0, 0, 255], (y * size + x) * 4)
        const image: Image = {width: size, height: size, pixels: pixels}
        const small: Image = resize(image, 16)
        assert.deepStrictEqual([...small.pixels.subarray((8 * 16 + 8) * 4, (8 * 16 + 8) * 4 + 4)], [255, 0, 0, 255])
        assert.deepStrictEqual([...small.pixels.subarray(0, 4)], [0, 0, 0, 0])
        //The pixels covering the edge are red, half transparent (not darkened)
        const edge: Image = resize(image, 3)
        assert.deepStrictEqual([...edge.pixels.subarray(0, 3)], [255, 0, 0])
        assert.ok(edge.pixels[3] > 0 && edge.pixels[3] < 255)
        //Windows: its sizes, the bitmaps (BITMAPINFOHEADER) and the PNG of 256
        const ico: Buffer = icoFile(image)
        assert.strictEqual(ico.readUInt16LE(2), 1)
        assert.strictEqual(ico.readUInt16LE(4), ICO_SIZES.length)
        ICO_SIZES.forEach((iconSize: number, index: number): void => {
            const entry: number = 6 + index * 16
            assert.strictEqual(ico[entry], iconSize >= 256 ? 0 : iconSize)
            const data: Buffer = ico.subarray(ico.readUInt32LE(entry + 12), ico.readUInt32LE(entry + 12) + ico.readUInt32LE(entry + 8))
            if (iconSize >= 256) assert.strictEqual(decodePng(data).width, 256)
            else assert.deepStrictEqual([data.readUInt32LE(0), data.readInt32LE(4), data.readInt32LE(8)], [40, iconSize, iconSize * 2])
        })
        //macOS: its sizes, but the ones larger than the image (1024)
        const icns: Buffer = icnsFile(image)
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
            if (image) writeFileSync(path.join(project, file), encodePng(image))
            return {lakutata: {icon: file}}
        }
        assert.strictEqual(applicationIcon(project, {}), undefined)
        assert.throws((): unknown => applicationIcon(project, icon('missing.png')), /The icon of the application missing\.png \(lakutata\.icon\) does not exist/)
        assert.throws((): unknown => applicationIcon(project, icon('wide.png', {width: 512, height: 256, pixels: Buffer.alloc(512 * 256 * 4)})), /must be square \(it is 512x256\)/)
        assert.throws((): unknown => applicationIcon(project, icon('small.png', {width: 128, height: 128, pixels: Buffer.alloc(128 * 128 * 4)})), /must be 256 pixels at least \(it is 128\)/)
        assert.strictEqual(applicationIcon(project, icon('logo.png', {width: 256, height: 256, pixels: Buffer.alloc(256 * 256 * 4)}))!.image.width, 256)
    })

    it('tells to build a resource which does not exist', async (): Promise<void> => {
        write('package.json', JSON.stringify({name: 'missing', version: '1.0.0', main: 'build/index.js', lakutata: {resources: [{from: 'ui/dist', to: 'ui'}]}}))
        await assert.rejects(bundleProject({project: project}), /The resource ui\/dist does not exist: build it first/)
    })
})
