//The application of the end-to-end test in k3s, one image for two roles: the signaling (ROLE=signaling, a Deployment)
//or a TURN server (ROLE=turn, a DaemonSet on the network of the node), the nodes of one cluster on NATS. The signaling
//also answers GET on port 8080 with its rooms and the nodes of the cluster, for the client of the test.
import {createServer} from 'node:http'
import {Application} from 'lakutata'
import {buildEntrypoints} from 'lakutata/com/entrypoint'
import {socketIOServiceEntrypoint} from 'lakutata/adapter/socket.io'
import {buildClusterOptions, buildSignalingOptions, buildTURNServerOptions, SignalingController} from '@lakutata/webrtc'

const cluster = buildClusterOptions({
    transport: {type: 'nats', servers: process.env.NATS_URL},
    nodeId: process.env.POD_NAME,
    labels: {node: process.env.NODE_NAME ?? ''}
})
const components = process.env.ROLE === 'turn'
    ? {
        cluster: cluster,
        turn: buildTURNServerOptions({
            cluster: 'cluster',
            publicAddress: process.env.PUBLIC_ADDRESS,
            secret: process.env.TURN_SECRET,
            relayPortRange: [49160, 49200]
        })
    }
    : {
        cluster: cluster,
        signaling: buildSignalingOptions({cluster: 'cluster', turnSecret: process.env.TURN_SECRET}),
        entrypoint: buildEntrypoints({
            controllers: [SignalingController],
            service: socketIOServiceEntrypoint({port: 3000})
        })
    }

Application
    .run(() => ({
        id: 'webrtc-e2e.app',
        name: 'WebRTCE2E',
        components: components,
        bootstrap: Object.keys(components)
    }))
    .onLaunched(async (app) => {
        if (process.env.ROLE === 'turn') return
        const signaling = await app.getObject('signaling')
        const nodes = await app.getObject('cluster')
        createServer((request, response) => {
            response.setHeader('Content-Type', 'application/json')
            response.end(JSON.stringify({rooms: signaling.rooms(), nodes: nodes.nodes()}))
        }).listen(8080)
    })
