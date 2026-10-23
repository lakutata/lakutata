# The client of aiortc (Python) in the interop tests (test-env/interop/run.sh): it joins the room interop of the
# signaling of @lakutata/webrtc over JSON-RPC 2.0 (WebSocket), answers the offers of the member node and echoes the
# messages of its channel echo, as section 14 of the guide describes it. It also calls the service action interop.echo
# of node through a channel service, its messages cut into frames as ChunkedChannel does (a byte of flags: 1 for the
# last frame, 2 for a text message). It exits with 0 once it got bye and the result of the call, 1 after 90 seconds.
#   python client.py ws://<server>:3001/
import asyncio
import json
import sys

import websockets
from aiortc import RTCConfiguration, RTCIceServer, RTCPeerConnection, RTCSessionDescription
from aiortc.sdp import candidate_from_sdp

FINAL = 0x01
TEXT = 0x02
CHUNK_SIZE = 16384


def log(text):
    print(f'aiortc: {text}', flush=True)


async def main(url):
    async with websockets.connect(f'{url}?id=aiortc') as socket:
        answers = {}
        next_id = 0
        bye = asyncio.Event()
        called = asyncio.Event()
        connection = None
        held = []
        calling = []

        async def request(method, params):
            nonlocal next_id
            next_id += 1
            answer = asyncio.get_running_loop().create_future()
            answers[next_id] = answer
            await socket.send(json.dumps({'jsonrpc': '2.0', 'id': next_id, 'method': method, 'params': params}))
            result = await asyncio.wait_for(answer, 15)
            if 'error' in result:
                raise RuntimeError(f'{method} failed: {result["error"]}')
            return result['result']

        def call_service():
            # A request of JSON-RPC in frames: text (2), the last one final (1)
            channel = connection.createDataChannel('service')
            parts = []
            text = 'framed by aiortc ' + 'x' * 40000

            @channel.on('open')
            def on_open():
                data = json.dumps({'jsonrpc': '2.0', 'id': 1, 'method': 'interop.echo', 'params': {'text': text}}).encode()
                for offset in range(0, len(data), CHUNK_SIZE):
                    last = offset + CHUNK_SIZE >= len(data)
                    channel.send(bytes([TEXT | (FINAL if last else 0)]) + data[offset:offset + CHUNK_SIZE])

            @channel.on('message')
            def on_message(frame):
                parts.append(frame[1:])
                if not frame[0] & FINAL:
                    return
                response = json.loads(b''.join(parts).decode())
                parts.clear()
                result = response.get('result') or {}
                if result.get('text') != text or result.get('caller') != 'aiortc':
                    log(f'unexpected response: {str(response)[:200]}')
                    sys.exit(1)
                log(f'called interop.echo: {len(result["text"])} characters back, as {result["caller"]}')
                called.set()

        async def on_signal(event):
            nonlocal connection
            description = event.get('description')
            candidate = event.get('candidate')
            if description and description['type'] == 'offer':
                if connection is None:
                    connection = RTCPeerConnection(configuration)

                    @connection.on('connectionstatechange')
                    def on_state():
                        log(f'connection {connection.connectionState}')

                    @connection.on('datachannel')
                    def on_channel(channel):
                        log(f'channel {channel.label}')

                        @channel.on('message')
                        def on_message(text):
                            if text == 'bye':
                                log('bye')
                                bye.set()
                                return
                            channel.send(f'echo: {text}')
                            # The association is up: the service is called through a channel of this side, once
                            if not calling:
                                calling.append(True)
                                call_service()

                await connection.setRemoteDescription(RTCSessionDescription(sdp=description['sdp'], type='offer'))
                for each in held:
                    await connection.addIceCandidate(each)
                held.clear()
                await connection.setLocalDescription(await connection.createAnswer())
                local = connection.localDescription
                await request('webrtc.signal', {'room': event['room'], 'to': event['from'], 'description': {'type': local.type, 'sdp': local.sdp}})
            elif candidate and candidate.get('candidate'):
                parsed = candidate_from_sdp(candidate['candidate'].split(':', 1)[1])
                parsed.sdpMid = candidate.get('sdpMid')
                parsed.sdpMLineIndex = candidate.get('sdpMLineIndex')
                if connection is None or connection.remoteDescription is None:
                    held.append(parsed)
                else:
                    await connection.addIceCandidate(parsed)

        async def read():
            async for raw in socket:
                received = json.loads(raw)
                if received.get('id') in answers:
                    answers.pop(received['id']).set_result(received)
                elif received.get('method') == 'webrtc:signal':
                    asyncio.create_task(on_signal(received['params'][0]))

        reader = asyncio.create_task(read())
        joined = await request('webrtc.join', {'room': 'interop', 'session': 'aiortc'})
        configuration = RTCConfiguration(iceServers=[
            RTCIceServer(urls=server['urls'], username=server.get('username'), credential=server.get('credential'))
            for server in joined['iceServers']
        ])
        log(f'joined as {joined["peerId"]}, {len(joined["iceServers"])} ICE servers')
        await asyncio.wait_for(asyncio.gather(bye.wait(), called.wait()), 90)
        await asyncio.sleep(0.5)
        reader.cancel()
        if connection:
            await connection.close()


if __name__ == '__main__':
    try:
        asyncio.run(main(sys.argv[1]))
    except asyncio.TimeoutError:
        log('timed out')
        sys.exit(1)
