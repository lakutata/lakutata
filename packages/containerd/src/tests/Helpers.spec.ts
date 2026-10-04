import {describe, it} from 'node:test'
import assert from 'node:assert'
import {mkdir, mkdtemp, rm, symlink, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {ImageName, ParseReference} from '../client/Reference.js'
import {FormatPlatform, MatchPlatform, ParsePlatform, PlatformRank, SupportedPlatforms} from '../client/Platforms.js'
import {Capabilities, ExecProcessSpec, GenerateSpec, ParseDeviceCgroupRule} from '../client/Spec.js'
import {ChainIds} from '../client/ImageStore.js'
import {DirectoryTree, LayerDirectories, LayersTree, ReadRootfsFile, ResolveUser} from '../client/Rootfs.js'
import {VolumeStore} from '../client/Volumes.js'
import {SeccompHint, SignalNumber} from '../client/ContainerStore.js'
import {DefaultSeccompProfile, SeccompSupported, type SeccompSyscall} from '../client/Seccomp.js'

describe('The helpers of the containerd component', (): void => {

    it('normalizes the references of the images as Docker and containerd do', (): void => {
        assert.strictEqual(ImageName('alpine'), 'docker.io/library/alpine:latest')
        assert.strictEqual(ImageName('alpine:3.20'), 'docker.io/library/alpine:3.20')
        assert.strictEqual(ImageName('user/app'), 'docker.io/user/app:latest')
        assert.strictEqual(ImageName('index.docker.io/library/alpine'), 'docker.io/library/alpine:latest')
        assert.strictEqual(ImageName('localhost:5000/app:1'), 'localhost:5000/app:1')
        assert.strictEqual(ImageName('ghcr.io/org/team/app@sha256:abc'), 'ghcr.io/org/team/app@sha256:abc')
        assert.deepStrictEqual(ParseReference('registry.example.com:5000/team/app:1.0'), {
            registry: 'registry.example.com:5000',
            host: 'registry.example.com:5000',
            repository: 'team/app',
            tag: '1.0',
            digest: undefined,
            name: 'registry.example.com:5000/team/app:1.0'
        })
        assert.strictEqual(ParseReference('busybox').host, 'registry-1.docker.io')
        assert.throws((): unknown => ParseReference('Upper/Case'))
        assert.throws((): unknown => ParseReference('alpine:bad tag'))
    })

    it('parses and matches the platforms', (): void => {
        assert.deepStrictEqual(ParsePlatform('arm64'), {os: 'linux', architecture: 'arm64', variant: 'v8'})
        assert.strictEqual(FormatPlatform(ParsePlatform('linux/arm')), 'linux/arm/v7')
        assert.strictEqual(FormatPlatform(ParsePlatform('linux/x86_64')), 'linux/amd64')
        assert.ok(MatchPlatform({os: 'linux', architecture: 'arm', variant: 'v6'}, ParsePlatform('linux/arm/v7')))
        assert.ok(!MatchPlatform({os: 'linux', architecture: 'arm', variant: 'v7'}, ParsePlatform('linux/arm/v6')))
        assert.ok(!MatchPlatform({os: 'linux', architecture: 'amd64'}, ParsePlatform('linux/arm64')))
        assert.ok(PlatformRank({os: 'linux', architecture: 'arm', variant: 'v7'}, ParsePlatform('linux/arm/v7'))! < PlatformRank({os: 'linux', architecture: 'arm', variant: 'v6'}, ParsePlatform('linux/arm/v7'))!)
    })

    it('detects the emulators of binfmt_misc', async (): Promise<void> => {
        const directory: string = await mkdtemp(path.join(tmpdir(), 'lakutata-binfmt-'))
        try {
            //The entries of Docker Desktop and of tonistiigi/binfmt
            const entry = (magic: string, enabled: string = 'enabled'): string => `${enabled}\ninterpreter /usr/bin/qemu\nflags: POCF\noffset 0\nmagic ${magic}\nmask ffffffffffffff00fffffffffffffffffeffffff\n`
            await writeFile(path.join(directory, 'x86_64'), entry('7f454c4602010100000000000000000002003e00'))
            await writeFile(path.join(directory, 'rosetta'), entry('7f454c4602010100000000000000000002003e00'))
            await writeFile(path.join(directory, 'qemu-arm'), entry('7f454c4601010100000000000000000002002800'))
            await writeFile(path.join(directory, 'qemu-aarch64'), entry('7f454c460201010000000000000000000200b700'))
            await writeFile(path.join(directory, 's390x'), entry('7f454c4602020100000000000000000000020016'))
            await writeFile(path.join(directory, 'riscv64'), entry('7f454c460201010000000000000000000200f300', 'disabled'))
            await writeFile(path.join(directory, 'status'), 'enabled\n')
            await writeFile(path.join(directory, 'register'), '')
            const platforms: string[] = SupportedPlatforms(directory).map(FormatPlatform)
            for (const platform of ['linux/amd64', 'linux/arm/v7', 'linux/arm/v6', 'linux/arm64/v8', 'linux/s390x']) assert.ok(platforms.includes(platform), platform)
            assert.ok(!platforms.includes('linux/riscv64'))
            assert.strictEqual(new Set(platforms).size, platforms.length)
        } finally {
            await rm(directory, {recursive: true, force: true})
        }
    })

    it('computes the chain identifiers of the layers', (): void => {
        const diffIds: string[] = [`sha256:${'a'.repeat(64)}`, `sha256:${'b'.repeat(64)}`]
        const chain: string[] = ChainIds(diffIds)
        assert.strictEqual(chain[0], diffIds[0])
        //sha256("sha256:aaa… sha256:bbb…")
        assert.strictEqual(chain[1], 'sha256:ccd722928bd92476ba1745586fed6e45a102504185ad88cd89e01ff116fd146c')
    })

    it('generates the specifications of the containers', (): void => {
        const spec = GenerateSpec({
            id: 'c', namespace: 'default', args: ['sh'], env: ['A=1'], cwd: '', uid: 1000, gid: 1000, additionalGids: [10],
            hostname: 'host', network: {mode: 'none'}, cgroupsPath: '/default/c', memory: 1024 * 1024, cpuQuota: 50000,
            capAdd: ['NET_ADMIN'], capDrop: ['net_raw'], mounts: [{source: '/data', destination: '/data', options: ['rbind', 'ro']}]
        })
        assert.strictEqual(spec.process.cwd, '/')
        assert.deepStrictEqual(spec.process.user, {uid: 1000, gid: 1000, additionalGids: [10]})
        assert.ok(spec.process.capabilities.bounding.includes('CAP_NET_ADMIN'))
        assert.ok(!spec.process.capabilities.bounding.includes('CAP_NET_RAW'))
        assert.ok(spec.linux.namespaces.some((namespace: any): boolean => namespace.type === 'network'))
        assert.strictEqual(spec.linux.resources.memory.limit, 1024 * 1024)
        assert.deepStrictEqual(spec.linux.resources.cpu, {quota: 50000, period: 100000})
        assert.ok(spec.mounts.some((mount: any): boolean => mount.destination === '/data' && mount.options.includes('ro')))
        assert.ok(spec.linux.maskedPaths.length > 0)
        const host = GenerateSpec({id: 'c', namespace: 'default', args: ['sh'], env: [], cwd: '/', uid: 0, gid: 0, additionalGids: [], hostname: 'h', network: {mode: 'host'}, cgroupsPath: '/default/c', privileged: true})
        assert.ok(!host.linux.namespaces.some((namespace: any): boolean => namespace.type === 'network'))
        assert.strictEqual(host.linux.maskedPaths, undefined)
        assert.deepStrictEqual(host.linux.resources.devices, [{allow: true, access: 'rwm'}])
        assert.strictEqual(Capabilities({capDrop: ['ALL'], capAdd: ['CHOWN']}).join(), 'CAP_CHOWN')
        const process = ExecProcessSpec(spec, {args: ['id'], env: ['A=2', 'B=3'], uid: 0, gid: 0})
        assert.deepStrictEqual(process.env, ['A=2', 'B=3'])
        assert.deepStrictEqual(process.user, {uid: 0, gid: 0})
        assert.deepStrictEqual(spec.process.args, ['sh'])
    })

    it('parses the rules of the devices of the cgroups as Docker writes them', (): void => {
        assert.deepStrictEqual(ParseDeviceCgroupRule('c 188:* rwm'), {type: 'c', major: 188, access: 'rwm'})
        assert.deepStrictEqual(ParseDeviceCgroupRule('b 8:16 r'), {type: 'b', major: 8, minor: 16, access: 'r'})
        assert.deepStrictEqual(ParseDeviceCgroupRule('a *:* rwm'), {type: 'a', access: 'rwm'})
        for (const invalid of ['c 188 rwm', 'x 1:2 r', 'c 1:2 rx', 'c 1:2 rr', 'c a:2 r']) assert.throws((): unknown => ParseDeviceCgroupRule(invalid), invalid)
        const spec = GenerateSpec({id: 'c', namespace: 'default', args: ['sh'], env: [], cwd: '/', uid: 0, gid: 0, additionalGids: [], hostname: 'h', network: {mode: 'host'}, cgroupsPath: '/default/c', deviceCgroupRules: [ParseDeviceCgroupRule('c 188:* rwm')]})
        assert.deepStrictEqual(spec.linux.resources.devices.at(-1), {allow: true, type: 'c', major: 188, access: 'rwm'})
        assert.deepStrictEqual(spec.linux.resources.devices[0], {allow: false, access: 'rwm'})
    })

    it('reads the users of the root file systems of the snapshots', async (): Promise<void> => {
        const root: string = await mkdtemp(path.join(tmpdir(), 'lakutata-rootfs-'))
        try {
            const [lower, upper] = [path.join(root, 'lower'), path.join(root, 'upper')]
            await mkdir(path.join(lower, 'etc'), {recursive: true})
            await mkdir(path.join(upper, 'etc'), {recursive: true})
            await writeFile(path.join(lower, 'etc', 'passwd'), 'root:x:0:0:root:/root:/bin/sh\napp:x:1000:1000::/home/app:/bin/sh\n')
            await writeFile(path.join(lower, 'etc', 'group'), 'root:x:0:\napp:x:1000:\nvideo:x:44:app,other\n')
            //The upper layer links its passwd to the one of the lower layer
            await symlink('../etc/passwd', path.join(upper, 'etc', 'users'))
            const mounts = [{type: 'overlay', source: 'overlay', options: [`upperdir=${upper}`, `lowerdir=${lower}`, 'workdir=/w']}]
            assert.deepStrictEqual(LayerDirectories(mounts), [upper, lower])
            assert.ok((await ReadRootfsFile(mounts, '/etc/users'))!.toString().startsWith('root:'))
            assert.deepStrictEqual(await ResolveUser(mounts, 'app'), {uid: 1000, gid: 1000, additionalGids: [44], home: '/home/app'})
            assert.deepStrictEqual(await ResolveUser(mounts, ''), {uid: 0, gid: 0, additionalGids: [], home: '/root'})
            assert.deepStrictEqual(await ResolveUser(mounts, '1000:video'), {uid: 1000, gid: 44, additionalGids: [], home: '/home/app'})
            assert.deepStrictEqual(await ResolveUser(mounts, '2000:2000'), {uid: 2000, gid: 2000, additionalGids: [], home: '/'})
            await assert.rejects(ResolveUser(mounts, 'nobody'))
        } finally {
            await rm(root, {recursive: true, force: true})
        }
    })

    it('gives the default profile of seccomp of containerd', (): void => {
        const allowed = (profile: ReturnType<typeof DefaultSeccompProfile>, name: string): SeccompSyscall[] => profile.syscalls!.filter((rule: SeccompSyscall): boolean => rule.names.includes(name))
        const profile = DefaultSeccompProfile(Capabilities({}), 'x64', '6.1.0-13-amd64')
        assert.strictEqual(profile.defaultAction, 'SCMP_ACT_ERRNO')
        assert.deepStrictEqual(profile.architectures, ['SCMP_ARCH_X86_64', 'SCMP_ARCH_X86', 'SCMP_ARCH_X32'])
        assert.strictEqual(allowed(profile, 'read').length, 1)
        assert.strictEqual(allowed(profile, 'arch_prctl').length, 1)
        //The capabilities by default: chroot, not mount nor reboot; clone without namespaces, clone3 ENOSYS
        assert.strictEqual(allowed(profile, 'chroot').length, 1)
        assert.strictEqual(allowed(profile, 'mount').length, 0)
        assert.strictEqual(allowed(profile, 'reboot').length, 0)
        assert.deepStrictEqual(allowed(profile, 'clone')[0].args, [{index: 0, value: 0x7e020000, valueTwo: 0, op: 'SCMP_CMP_MASKED_EQ'}])
        assert.deepStrictEqual(allowed(profile, 'clone3')[0], {names: ['clone3'], action: 'SCMP_ACT_ERRNO', errnoRet: 38})
        assert.deepStrictEqual(allowed(profile, 'socket')[0].args, [{index: 0, value: 40, op: 'SCMP_CMP_NE'}])
        assert.strictEqual(allowed(profile, 'personality').length, 5)
        assert.strictEqual(allowed(profile, 'ptrace').length, 1)
        //The capabilities added: their system calls
        const admin = DefaultSeccompProfile(Capabilities({capAdd: ['SYS_ADMIN', 'SYS_TIME']}), 'arm64', '6.1.0')
        assert.deepStrictEqual(admin.architectures, ['SCMP_ARCH_ARM', 'SCMP_ARCH_AARCH64'])
        assert.ok(allowed(admin, 'mount').length && allowed(admin, 'unshare').length && allowed(admin, 'clock_settime').length && allowed(admin, 'set_tls').length)
        assert.deepStrictEqual(allowed(admin, 'clone').map((rule: SeccompSyscall): unknown => rule.args), [[]])
        assert.strictEqual(allowed(admin, 'clone3')[0].action, 'SCMP_ACT_ALLOW')
        //s390x: the flags of clone are its second argument; the kernels before 4.8: no ptrace
        const old = DefaultSeccompProfile(Capabilities({}), 's390x', '4.4.0')
        assert.strictEqual(allowed(old, 'clone')[0].args![0].index, 1)
        assert.strictEqual(allowed(old, 'ptrace').length, 0)
        assert.ok(SeccompSupported('Name:\tsh\nSeccomp:\t0\n'))
        assert.ok(!SeccompSupported('Name:\tsh\n'))
    })

    it('reads the file systems of the containers: a directory, the layers of a snapshot', async (): Promise<void> => {
        const root: string = await mkdtemp(path.join(tmpdir(), 'lakutata-tree-'))
        try {
            const [lower, upper] = [path.join(root, 'lower'), path.join(root, 'upper')]
            await mkdir(path.join(lower, 'app', 'old'), {recursive: true})
            await mkdir(path.join(upper, 'app'), {recursive: true})
            await writeFile(path.join(lower, 'app', 'kept.txt'), 'lower')
            await writeFile(path.join(lower, 'app', 'changed.txt'), 'lower')
            await writeFile(path.join(lower, 'app', 'old', 'inside.txt'), 'lower')
            await writeFile(path.join(upper, 'app', 'changed.txt'), 'upper')
            await symlink('/app', path.join(upper, 'link'))
            const layers: LayersTree = new LayersTree([upper, lower])
            assert.deepStrictEqual(await layers.readdir('/app'), ['changed.txt', 'kept.txt', 'old'])
            assert.strictEqual((await layers.lstat('/app/changed.txt'))!.path, path.join(upper, 'app', 'changed.txt'))
            assert.strictEqual((await layers.lstat('/app/kept.txt'))!.path, path.join(lower, 'app', 'kept.txt'))
            //The absolute links resolved in the tree, not in the host
            assert.strictEqual(await layers.resolve('/link/kept.txt'), '/app/kept.txt')
            assert.strictEqual(await layers.resolve('/app/../link/../app/old'), '/app/old')
            assert.strictEqual(await new DirectoryTree(lower).resolve('/app/old/inside.txt'), '/app/old/inside.txt')
            assert.strictEqual(await new DirectoryTree(upper).resolve('/link'), '/app')
            assert.strictEqual(await layers.lstat('/missing'), undefined)
        } finally {
            await rm(root, {recursive: true, force: true})
        }
    })

    it('keeps the named volumes', async (): Promise<void> => {
        const root: string = await mkdtemp(path.join(tmpdir(), 'lakutata-volumes-'))
        try {
            const volumes: VolumeStore = new VolumeStore(root)
            const created = await volumes.create('data', {app: 'web'})
            assert.strictEqual(created.mountpoint, path.join(root, 'data', '_data'))
            await writeFile(path.join(created.mountpoint, 'kept'), 'x')
            //Created again: the existing one
            assert.deepStrictEqual((await volumes.create('data')).labels, {app: 'web'})
            await volumes.create('cache')
            assert.deepStrictEqual((await volumes.list()).map((volume): string => volume.name), ['cache', 'data'])
            await volumes.remove('data')
            assert.strictEqual(await volumes.get('data'), undefined)
            await assert.rejects(volumes.create('../escape'))
        } finally {
            await rm(root, {recursive: true, force: true})
        }
    })

    it('tells what to do when the runtime has no seccomp', (): void => {
        const error: Error = SeccompHint(new Error('failed to create shim task: OCI runtime create failed: seccomp: config provided but seccomp not supported: unknown')) as Error
        assert.match(error.message, /seccomp unconfined/)
        assert.strictEqual((SeccompHint(new Error('other')) as Error).message, 'other')
    })

    it('numbers the signals', (): void => {
        assert.strictEqual(SignalNumber('SIGTERM'), 15)
        assert.strictEqual(SignalNumber('kill'), 9)
        assert.strictEqual(SignalNumber('2'), 2)
        assert.throws((): unknown => SignalNumber('SIGNOPE'))
    })
})
