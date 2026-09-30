#!/bin/sh
# Install the deb of an Electron application in a clean Debian (with its dependencies), start it in a virtual display and
# print the text of its page (PAGE: …), read with the DevTools protocol
set -e
DEB="$1"
apt-get update -qq > /dev/null
apt-get install -y -qq --no-install-recommends "$DEB" xvfb xauth > /dev/null 2>&1 || apt-get install -y --no-install-recommends "$DEB" xvfb xauth
PACKAGE="$(dpkg-deb -f "$DEB" Package)"
EXECUTABLE="$(dpkg -L "$PACKAGE" | grep -E '^/opt/[^/]+/[^/]+$' | while read -r file; do [ -x "$file" ] && [ -f "$file" ] && case "$file" in *.so|*chrome-sandbox|*chrome_crashpad_handler) ;; *) echo "$file";; esac; done | head -n 1)"
echo "installed $PACKAGE: $EXECUTABLE"
xvfb-run -a "$EXECUTABLE" --no-sandbox --remote-debugging-port=9222 > /tmp/app.log 2>&1 &
node -e '
const wait = ms => new Promise(r => setTimeout(r, ms))
;(async () => {
    let text = ""
    for (let i = 0; i < 60 && !/Hello, /.test(text); i++) {
        await wait(1000)
        try {
            const page = (await (await fetch("http://127.0.0.1:9222/json")).json()).find(p => p.type === "page")
            if (!page) continue
            text = await new Promise((resolve, reject) => {
                const ws = new WebSocket(page.webSocketDebuggerUrl)
                ws.onopen = () => ws.send(JSON.stringify({id: 1, method: "Runtime.evaluate", params: {expression: "document.body.innerText + \" | isolated: \" + (typeof require === \"undefined\" && typeof process === \"undefined\")", returnByValue: true}}))
                ws.onmessage = m => { const r = JSON.parse(m.data); if (r.id === 1) { ws.close(); resolve(r.result?.result?.value ?? "") } }
                ws.onerror = reject
            })
        } catch {}
    }
    console.log("PAGE: " + text.replace(/\n/g, " / "))
    process.exit(0)
})()'
tail -n 5 /tmp/app.log
