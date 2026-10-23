//The benchmark of the worker threads of the connections (PeerThreads): pairs of PeerConnections in this process, each
//pair sending messages over a data channel, their engines in the main thread or in worker threads. The CPU measured is
//the one of the process, all its threads.
//
//   npm run compile && node test-env/bench/threads.mjs [--pairs 4] [--threads 0] [--size 100] [--seconds 5]
//
//--threads 0: the engines run in the main thread; else the most worker threads of the PeerThreads component (a pair's
//two connections are served by two threads). --size: the messages, in bytes (100, or 16384 for large ones). Each sender
//keeps 1 MiB buffered at most.
import path from 'node:path'
import {pathToFileURL} from 'node:url'
import {parseArgs} from 'node:util'
import {Container} from '@lakutata/core'

const exports = process.env.WEBRTC_BENCH_DIST ? pathToFileURL(path.resolve(process.env.WEBRTC_BENCH_DIST)).href : new URL('../../dist/esm/exports/WebRTC.js', import.meta.url).href
const {PeerConnection, PeerThreads} = await import(exports)

const {values: options} = parseArgs({
    options: {
        pairs: {type: 'string', default: '4'},
        threads: {type: 'string', default: '0'},
        size: {type: 'string', default: '100'},
        seconds: {type: 'string', default: '5'}
    }
})
const pairs = Number(options.pairs)
const threads = Number(options.threads)
const size = Number(options.size)
const HIGH = 1024 * 1024

/**
 * A pair of connections, the first one opening a channel to the other
 */
async function pair(container) {
    const settings = {iceUseIpv6: false, ...threads ? {threads: 'threads'} : {}}
    const offerer = await container.get(PeerConnection, settings)
    const answerer = await container.get(PeerConnection, settings)
    offerer.on('icecandidate', (candidate) => void answerer.addIceCandidate(candidate))
    answerer.on('icecandidate', (candidate) => void offerer.addIceCandidate(candidate))
    const remote = new Promise((resolve) => answerer.once('datachannel', resolve))
    const local = offerer.createDataChannel('bench')
    await offerer.setLocalDescription()
    await answerer.setRemoteDescription(offerer.localDescription)
    await answerer.setLocalDescription()
    await offerer.setRemoteDescription(answerer.localDescription)
    await new Promise((resolve) => local.readyState === 'open' ? resolve() : local.once('open', resolve))
    return {local, remote: await remote}
}

const container = new Container()
try {
    if (threads) await container.setNamed('threads', PeerThreads, {threads: threads})
    const channels = []
    for (let index = 0; index < pairs; index++) channels.push(await pair(container))
    let received = 0
    let sending = true
    const message = Buffer.alloc(size)
    for (const {local, remote} of channels) {
        remote.on('message', () => void received++)
        local.bufferedAmountLowThreshold = HIGH / 4
        const fill = () => {
            while (sending && local.bufferedAmount < HIGH) local.send(message)
        }
        local.on('bufferedamountlow', fill)
        fill()
    }
    //A second to warm up, then the measure
    await new Promise((resolve) => setTimeout(resolve, 1000))
    const received0 = received
    const cpu0 = process.cpuUsage()
    const t0 = performance.now()
    let rss = 0
    const sampling = setInterval(() => void (rss = Math.max(rss, process.memoryUsage().rss)), 100)
    await new Promise((resolve) => setTimeout(resolve, Number(options.seconds) * 1000))
    const seconds = (performance.now() - t0) / 1000
    const {user, system} = process.cpuUsage(cpu0)
    clearInterval(sampling)
    sending = false
    const messages = received - received0
    const cpu = (user + system) / 1e6
    const format = (value, digits = 0) => value.toLocaleString('en-US', {maximumFractionDigits: digits})
    const load = threads ? ` (connections by thread: ${(await container.get('threads')).load().join('/')})` : ''
    console.log(`${pairs} pairs, ${size}-byte messages, engines in ${threads ? `${threads} worker threads` : 'the main thread'}${load}: ${format(messages / seconds)} messages a second (${format(messages * size / seconds / 2 ** 20, 1)} MiB/s), the process ${format(cpu / seconds * 100)} % of a core, ${format(cpu / messages * 1e6, 2)} CPU µs per message, ${format(rss / 2 ** 20)} MiB resident at most`)
} finally {
    await container.destroy()
}
