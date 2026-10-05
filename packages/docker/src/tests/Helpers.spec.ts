import {describe, it} from 'node:test'
import assert from 'node:assert'
import {buildDockerHttpsConnectionOptions, buildDockerSocketConnectionOptions, buildDockerSSHConnectionOptions, Docker, parseEnvToRecord, parseRepositoryTag} from '../exports/Docker.js'
import {EnginePortBindings, EngineRestartPolicy, ParseRestartPolicy} from '../docker/lib/EngineSettings.js'

describe('The helpers of the Docker component', (): void => {

    it('parses the environment variables of a container', (): void => {
        assert.deepStrictEqual(parseEnvToRecord(['PATH=/usr/bin', 'EMPTY=', 'EQUALS=a=b', 'NOVALUE']), {PATH: '/usr/bin', EMPTY: '', EQUALS: 'a=b'})
        assert.deepStrictEqual(parseEnvToRecord(), {})
    })

    it('parses the repositories and the tags of the images', (): void => {
        assert.deepStrictEqual(parseRepositoryTag('alpine'), {repo: 'alpine'})
        assert.deepStrictEqual(parseRepositoryTag('alpine:3.20'), {repo: 'alpine', tag: '3.20'})
        assert.deepStrictEqual(parseRepositoryTag('registry.example.com:5000/team/app'), {repo: 'registry.example.com:5000/team/app'})
        assert.deepStrictEqual(parseRepositoryTag('registry.example.com:5000/team/app:1.0'), {repo: 'registry.example.com:5000/team/app', tag: '1.0'})
        assert.deepStrictEqual(parseRepositoryTag('alpine@sha256:abc'), {repo: 'alpine', tag: 'sha256:abc'})
    })

    it('builds the options of the connections', (): void => {
        assert.deepStrictEqual(buildDockerSocketConnectionOptions({socketPath: '/var/run/docker.sock'}), {socketPath: '/var/run/docker.sock', class: Docker})
        assert.strictEqual(buildDockerHttpsConnectionOptions({host: 'docker.example.com', port: 2376}).protocol, 'https')
        assert.strictEqual(buildDockerSSHConnectionOptions({host: 'docker.example.com', port: 22, username: 'deploy'}).protocol, 'ssh')
    })

    it('turns the restart policies into the ones of the Engine API, and back', (): void => {
        assert.deepStrictEqual(EngineRestartPolicy('on-failure:3'), {Name: 'on-failure', MaximumRetryCount: 3})
        assert.deepStrictEqual(EngineRestartPolicy('always'), {Name: 'always'})
        assert.strictEqual(ParseRestartPolicy({Name: 'on-failure', MaximumRetryCount: 3}), 'on-failure:3')
        assert.strictEqual(ParseRestartPolicy({Name: 'on-failure', MaximumRetryCount: 0}), 'on-failure')
        assert.strictEqual(ParseRestartPolicy({Name: ''}), '')
    })

    it('binds each host port once', (): void => {
        assert.deepStrictEqual(EnginePortBindings([{port: 80, type: 'tcp', hostPorts: [8080, 8080]}, {port: 80, type: 'tcp', hostPorts: [8081]}, {port: 53, type: 'udp'}]), {
            '80/tcp': [{HostPort: '8080'}, {HostPort: '8081'}],
            '53/udp': null
        })
    })
})
