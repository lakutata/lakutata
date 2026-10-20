# Third-party notices

Parts of `@lakutata/webrtc` are derived from the third-party projects listed below; the original copyright notices and
license terms are reproduced here as required.

## werift 0.25.1

The implementation of WebRTC in `src/lib` (ICE, DTLS, SCTP, RTP, RTCP, SRTP, SDP, the peer connection, and the STUN and
TURN server) is derived from the source of werift (https://github.com/shinyoshiaki/werift-webrtc, commit
`9b2438b461d953833e16981f79d37d5d77d6d9e2`): its packages `common`, `dtls`, `ice`, `ice-server`, `rtp` (without its
`extra` module), `sctp` and `webrtc` (without its `nonstandard` module and its polyfill).

Modifications: the code style of the repository; the dependencies replaced by the modules of Node.js (`node:crypto` for
the certificates and the key exchanges, `node:dgram` for multicast DNS, a logging hook instead of `debug`); no default
STUN server; the DTLS records arriving before the transport is ready are buffered; ICE checks again after a restart
while DTLS is connected; the transports a BUNDLE group replaced are stopped when the connection closes; the SCTP stack
made faster (bundling, the acknowledgements sent with the data, a larger initial window, ring buffers) and its receive
window enforced (RFC 9260, section 6.2), the room of a reset stream given back; the data channels sending without
waiting, a message size of 256 KiB advertised; the TURN server given a range of relay ports, its timer kept stopped
once closed; the tests ported to `node:test`.

```
MIT License

Copyright (c) 2020 shinyoshiaki

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
