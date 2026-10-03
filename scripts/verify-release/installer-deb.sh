#!/bin/sh
# Install the deb of an application (lakutata package installer) in a clean Debian and run its program from the PATH: the greet
# command of a command line tool (OUTPUT: …), or a service, its /health (HEALTH: …) and its page (PAGE: …)
set -e
DEB="$1"
KIND="$2"
apt-get update -qq > /dev/null
apt-get install -y -qq --no-install-recommends "$DEB" curl ca-certificates > /dev/null 2>&1 || apt-get install -y --no-install-recommends "$DEB" curl ca-certificates
PACKAGE="$(dpkg-deb -f "$DEB" Package)"
PROGRAM="$(dpkg -L "$PACKAGE" | grep '^/usr/bin/' | head -n 1)"
echo "installed $PACKAGE: $PROGRAM"
if [ "$KIND" = cli ]; then
    echo "OUTPUT: $("$PROGRAM" greet --name deb)"
    exit 0
fi
# Run as its service runs it: its environment, its port
PORT=18080 MODE=production "$PROGRAM" > /tmp/app.log 2>&1 &
for attempt in $(seq 1 60); do
    curl -sf http://127.0.0.1:18080/health > /dev/null 2>&1 && break
    sleep 1
done
echo "HEALTH: $(curl -sf http://127.0.0.1:18080/health || true)"
echo "PAGE: $(curl -sf -H 'Accept: text/html' http://127.0.0.1:18080/ | tr '\n' ' ' || true)"
tail -n 5 /tmp/app.log
