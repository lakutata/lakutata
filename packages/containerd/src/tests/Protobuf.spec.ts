import {describe, it} from 'node:test'
import assert from 'node:assert'
import {decode, encode, type Schema} from '@lakutata/grpc'
import * as M from '../client/Messages.js'

describe('The protobuf codec of the messages of containerd', (): void => {

    it('encodes the fields as protoc does', (): void => {
        //protoc --encode=Descriptor: media_type "a", digest "sha256:x", size 300, annotations {k: v}
        const bytes: Uint8Array = encode(M.Descriptor, {mediaType: 'a', digest: 'sha256:x', size: 300, annotations: {k: 'v'}})
        assert.strictEqual(Buffer.from(bytes).toString('hex'), '0a01611208736861323536' + '3a78' + '18ac02' + '2a060a016b120176')
    })

    it('skips the default values of proto3', (): void => {
        assert.strictEqual(encode(M.KillRequest, {containerId: '', execId: '', signal: 0, all: false}).length, 0)
    })

    it('decodes what it encodes: nested messages, repeated fields, maps, 64 bits integers', (): void => {
        const container = {
            id: 'web',
            labels: {'nerdctl/name': 'web', empty: ''},
            image: 'docker.io/library/alpine:3.20',
            runtime: {name: 'io.containerd.runc.v2'},
            spec: {typeUrl: 'types.containerd.io/opencontainers/runtime-spec/1/Spec', value: Buffer.from('{}')},
            snapshotter: 'overlayfs',
            snapshotKey: 'web',
            createdAt: {seconds: 1791063274, nanos: 558647013}
        }
        const decoded = decode(M.ContainerResponse, encode(M.ContainerResponse, {container: container})).container
        assert.strictEqual(decoded.id, 'web')
        assert.deepStrictEqual(decoded.labels, {'nerdctl/name': 'web', empty: ''})
        assert.strictEqual(decoded.runtime.name, 'io.containerd.runc.v2')
        assert.strictEqual(Buffer.from(decoded.spec.value).toString(), '{}')
        assert.deepStrictEqual(decoded.createdAt, {seconds: 1791063274, nanos: 558647013})
        assert.deepStrictEqual(decoded.extensions, {})
        const mounts = decode(M.MountsResponse, encode(M.MountsResponse, {mounts: [{type: 'overlay', source: 'overlay', options: ['index=off', 'lowerdir=/a:/b']}, {type: 'bind', source: '/c', options: []}]})).mounts
        assert.deepStrictEqual(mounts.map((mount: any): string[] => mount.options), [['index=off', 'lowerdir=/a:/b'], []])
        const big = decode(M.ReadContentRequest, encode(M.ReadContentRequest, {digest: 'd', offset: 2 ** 40, size: 5}))
        assert.strictEqual(big.offset, 2 ** 40)
        assert.strictEqual(decode(M.Process, encode(M.Process, {pid: 4294967295, exitStatus: 137})).pid, 4294967295)
    })

    it('decodes the packed and the unpacked repeated integers', (): void => {
        const schema: Schema = {values: {no: 1, type: 'uint32', repeated: true}}
        assert.deepStrictEqual(decode(schema, encode(schema, {values: [1, 300, 70000]})).values, [1, 300, 70000])
        //Unpacked: the tag repeated for each value
        assert.deepStrictEqual(decode(schema, Uint8Array.from([0x08, 0x01, 0x08, 0xac, 0x02])).values, [1, 300])
    })

    it('skips the fields it does not know, whatever their wire type', (): void => {
        //A Lease: id 1, created_at 2 (a message, not in the schema), labels 3
        const lease: Schema = {id: {no: 1, type: 'string'}, createdAt: {no: 2, type: M.Timestamp}, labels: {no: 3, type: 'string', map: true}}
        const bytes: Uint8Array = encode(lease, {id: 'l', createdAt: {seconds: 1700000000, nanos: 5}, labels: {a: 'b'}})
        assert.deepStrictEqual(decode(M.Lease, bytes), {id: 'l', labels: {a: 'b'}})
        //A fixed64 and a fixed32 field unknown
        assert.deepStrictEqual(decode({id: {no: 1, type: 'string'}}, Uint8Array.from([0x11, 1, 2, 3, 4, 5, 6, 7, 8, 0x1d, 1, 2, 3, 4, 0x0a, 0x01, 0x78])), {id: 'x'})
    })

    it('decodes the events of containerd', (): void => {
        const exit = encode(M.EVENTS['containerd.events.TaskExit'], {containerId: 'c', id: 'c', pid: 12, exitStatus: 3})
        const envelope = decode(M.Envelope, encode(M.Envelope, {namespace: 'default', topic: '/tasks/exit', event: {typeUrl: 'containerd.events.TaskExit', value: exit}}))
        assert.strictEqual(envelope.topic, '/tasks/exit')
        assert.deepStrictEqual(decode(M.EVENTS[envelope.event.typeUrl], envelope.event.value), {containerId: 'c', id: 'c', pid: 12, exitStatus: 3})
    })
})
