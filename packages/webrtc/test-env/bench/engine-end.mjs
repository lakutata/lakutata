//One end of a benchmark of the engine, driven by engine.mjs over IPC. The offerer sends, the answerer receives. Every
//timing is Date.now(), every CPU time process.cpuUsage(), every memory figure the RSS. Signaling is not trickled: an end
//sends its description once its candidates are gathered.
//
//The engine is the RTCPeerConnection of the package's protocol implementation (dist/esm/lib/peer), the one measured
//when the targets were set against libdatachannel (node-datachannel) on the same machine, an Apple M4 with Node.js 24.
//
//WEBRTC_BENCH_DIST: the exports of another build (the absolute path of its dist/esm/exports/WebRTC.js), to compare two
//builds. TURN=host:port:username:password: both ends relay only, through that TURN server.
import path from 'node:path'
import {pathToFileURL} from 'node:url'

const dist = process.env.WEBRTC_BENCH_DIST ? pathToFileURL(path.resolve(process.env.WEBRTC_BENCH_DIST)) : new URL('../../dist/esm/exports/WebRTC.js', import.meta.url)
const {RTCPeerConnection, MediaStreamTrack, RTCRtpCodecParameters} = await import(new URL('../lib/peer/index.js', dist).href)
const turn = process.env.TURN ? (([host, port, username, password]) => ({host, port, username, password}))(process.env.TURN.split(':')) : undefined
const codecs = {video: [new RTCRtpCodecParameters({mimeType: 'video/VP8', clockRate: 90000, payloadType: 96})]}

const peers = new Map()
//The answerer sets its handlers on each peer created for an offer, before it answers
let onPeer = () => undefined
let rssMax = 0
setInterval(() => void (rssMax = Math.max(rssMax, process.memoryUsage().rss)), 100).unref()

const send = (message) => process.send(message)
const onCommand = (cmd, cb) => process.on('message', (message) => message.cmd === cmd && cb(message))
const cpu = (since) => {
    const {user, system} = process.cpuUsage(since)
    return (user + system) / 1e6
}
const rss = () => {
    globalThis.gc?.()
    return process.memoryUsage().rss
}

/**
 * Once the candidates of a connection are gathered
 */
function gathered(pc) {
    return pc.iceGatheringState === 'complete' ? Promise.resolve() : new Promise((resolve) => {
        const {unSubscribe} = pc.iceGatheringStateChange.subscribe((state) => {
            if (state !== 'complete') return
            unSubscribe()
            resolve()
        })
    })
}

/**
 * A data channel, as the tests use it
 */
function channel(dc) {
    return {
        send: (buffer) => dc.send(buffer),
        buffered: () => dc.bufferedAmount,
        setLowThreshold: (bytes) => void (dc.bufferedAmountLowThreshold = bytes),
        onLow: (cb) => dc.bufferedAmountLow.subscribe(cb),
        onOpen: (cb) => dc.readyState === 'open' ? cb() : dc.stateChanged.subscribe((state) => state === 'open' && cb()),
        onMessage: (cb) => dc.onMessage.subscribe(cb)
    }
}

/**
 * A connection, as the tests use it
 */
function createPeer() {
    const pc = new RTCPeerConnection(turn
        ? {iceServers: [{urls: `turn:${turn.host}:${turn.port}`, username: turn.username, credential: turn.password}], iceTransportPolicy: 'relay', codecs}
        : {iceServers: [], codecs})
    return {
        createChannel: (label, {reliable = true} = {}) => channel(pc.createDataChannel(label, reliable ? {} : {ordered: false, maxRetransmits: 0})),
        onChannel: (cb) => pc.onDataChannel.subscribe((dc) => cb(channel(dc))),
        addVideoSender: () => {
            const track = new MediaStreamTrack({kind: 'video'})
            pc.addTransceiver(track, {direction: 'sendonly'})
            return {send: (rtp) => track.writeRtp(rtp), onOpen: (cb) => pc.connectionStateChange.subscribe((state) => state === 'connected' && cb())}
        },
        onVideo: (cb) => pc.onTrack.subscribe((track) => track.onReceiveRtp.subscribe(() => cb())),
        offer: async () => {
            const done = gathered(pc)
            await pc.setLocalDescription(await pc.createOffer())
            await done
            return pc.localDescription.sdp
        },
        answer: async (sdp) => {
            await pc.setRemoteDescription({type: 'offer', sdp})
            const done = gathered(pc)
            await pc.setLocalDescription(await pc.createAnswer())
            await done
            return pc.localDescription.sdp
        },
        accept: async (sdp) => pc.setRemoteDescription({type: 'answer', sdp}),
        state: () => ({connection: pc.connectionState, ice: pc.iceConnectionState, gathering: pc.iceGatheringState, signaling: pc.signalingState}),
        close: async () => pc.close()
    }
}

/**
 * Sends while the buffer is under high, resumes on the low event (at a quarter of high), while more() is true
 */
function pump(dc, payload, high, more, sent) {
    dc.setLowThreshold(high / 4)
    const fill = () => {
        while (more() && dc.buffered() < high) {
            dc.send(payload)
            sent()
        }
    }
    dc.onLow(fill)
    fill()
    return fill
}

function offerer(id = 0) {
    const peer = createPeer()
    peers.set(id, peer)
    return peer
}

/**
 * The receiver of a timed test: the times of its first and last items, and its CPU time until the last one (sampled
 * every 50 ms, so it leaves out the idle time before finish)
 */
function receiver() {
    const state = {received: 0, first: 0, last: 0, cpu: 0}
    let cpu0
    let seen = 0
    setInterval(() => {
        if (state.received === seen) return
        seen = state.received
        state.cpu = cpu(cpu0)
    }, 50).unref()
    onCommand('finish', () => send({type: 'result', ...state, rssMax}))
    return () => {
        cpu0 ??= process.cpuUsage()
        state.first ||= Date.now()
        state.last = Date.now()
        state.received++
    }
}

const tests = {
    async bulk({role, size, total, high}) {
        if (role === 'offerer') {
            const peer = offerer()
            const dc = peer.createChannel('bulk')
            dc.onOpen(() => {
                const t0 = Date.now()
                const cpu0 = process.cpuUsage()
                let sent = 0
                pump(dc, Buffer.alloc(size, 7), high, () => sent < total, () => void (sent += size))
                send({type: 'started', t0})
                onCommand('finish', () => send({type: 'result', cpu: cpu(cpu0), rssMax}))
            })
            send({type: 'signal', id: 0, sdp: await peer.offer()})
        } else {
            let received = 0
            let cpu0
            onPeer = (peer) => peer.onChannel((dc) => dc.onMessage((message) => {
                cpu0 ??= process.cpuUsage()
                received += message.length
                if (received === total) send({type: 'result', t1: Date.now(), cpu: cpu(cpu0), rssMax, received})
            }))
        }
    },
    async small({role, size, duration, reliable, high}) {
        if (role === 'offerer') {
            const peer = offerer()
            const dc = peer.createChannel('small', {reliable})
            dc.onOpen(() => {
                const cpu0 = process.cpuUsage()
                const end = Date.now() + duration
                let sent = 0
                const fill = pump(dc, Buffer.alloc(size, 7), high, () => Date.now() < end, () => void sent++)
                //The low event does not come when the buffer never fills: refill on a timer too. The CPU time stops at
                //the end
                const timer = setInterval(() => {
                    if (Date.now() < end) return fill()
                    clearInterval(timer)
                    const used = cpu(cpu0)
                    setTimeout(() => send({type: 'result', cpu: used, rssMax, sent}), 1500)
                }, 1)
                send({type: 'started', t0: Date.now()})
            })
            send({type: 'signal', id: 0, sdp: await peer.offer()})
        } else {
            const item = receiver()
            onPeer = (peer) => peer.onChannel((dc) => dc.onMessage(item))
        }
    },
    async conns({role, n, idle}) {
        const before = rss()
        if (role === 'offerer') {
            const t0 = Date.now()
            let open = 0
            await Promise.all(Array.from({length: n}, async (_, id) => {
                const peer = offerer(id)
                peer.createChannel('c').onOpen(() => {
                    if (++open < n) return
                    const t1 = Date.now()
                    const after = rss()
                    const cpu0 = process.cpuUsage()
                    send({type: 'opened', t1})
                    setTimeout(() => send({type: 'result', setup: t1 - t0, rssPerConn: (after - before) / n, idleCpu: cpu(cpu0) / (idle / 1000)}), idle)
                })
                send({type: 'signal', id, sdp: await peer.offer()})
            }))
        } else {
            let open = 0
            onPeer = (peer) => peer.onChannel((dc) => dc.onOpen(() => void open++))
            onCommand('opened', () => {
                const after = rss()
                const cpu0 = process.cpuUsage()
                setTimeout(() => send({type: 'result', rssPerConn: (after - before) / n, idleCpu: cpu(cpu0) / (idle / 1000), open}), idle)
            })
        }
    },
    async rtp({role, rate, duration}) {
        if (role === 'offerer') {
            const peer = offerer()
            const video = peer.addVideoSender()
            video.onOpen(() => setTimeout(() => {
                const cpu0 = process.cpuUsage()
                const packet = Buffer.alloc(1200, 7)
                packet[0] = 0x80
                packet[1] = 96
                packet.writeUInt32BE(0x1234, 8)
                let sent = 0
                const start = Date.now()
                //Paced: every millisecond, the packets due since the start
                const timer = setInterval(() => {
                    const now = Date.now()
                    if (now - start >= duration) {
                        clearInterval(timer)
                        const used = cpu(cpu0)
                        setTimeout(() => send({type: 'result', cpu: used, rssMax, sent}), 1000)
                        return
                    }
                    const due = Math.floor((now - start) * rate / 1000)
                    for (; sent < due; sent++) {
                        packet.writeUInt16BE(sent & 0xffff, 2)
                        packet.writeUInt32BE((sent * 3000) >>> 0, 4)
                        video.send(packet)
                    }
                }, 1)
                send({type: 'started', t0: start})
            }, 500))
            send({type: 'signal', id: 0, sdp: await peer.offer()})
        } else {
            const item = receiver()
            onPeer = (peer) => peer.onVideo(item)
        }
    }
}

process.on('message', async (message) => {
    if (message.cmd === 'run') return tests[message.test]({role: message.role, ...message.params})
    if (message.cmd === 'signal' && message.kind === 'offer') {
        const peer = createPeer()
        peers.set(message.id, peer)
        onPeer(peer)
        return send({type: 'signal', id: message.id, sdp: await peer.answer(message.sdp)})
    }
    if (message.cmd === 'signal' && message.kind === 'answer') return peers.get(message.id).accept(message.sdp)
    if (message.cmd === 'status') {
        const states = {}
        for (const peer of peers.values()) {
            const key = JSON.stringify(peer.state())
            states[key] = (states[key] ?? 0) + 1
        }
        return send({type: 'status', peers: peers.size, states})
    }
    if (message.cmd === 'exit') {
        await Promise.race([Promise.allSettled([...peers.values()].map((peer) => peer.close())), new Promise((resolve) => setTimeout(resolve, 2000))])
        process.exit(0)
    }
})
send({type: 'ready'})
