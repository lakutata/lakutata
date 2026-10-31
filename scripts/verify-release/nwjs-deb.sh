#!/bin/sh
# Install the deb of an NW.js application in a clean Debian (with its dependencies) and start it in a virtual display, as
# a user: the normal flavor of NW.js has no DevTools to read its page, so its log tells that it runs (STARTED: …)
set -e
DEB="$1"
apt-get update -qq > /dev/null
apt-get install -y -qq --no-install-recommends "$DEB" xvfb xauth > /dev/null 2>&1 || apt-get install -y --no-install-recommends "$DEB" xvfb xauth
PACKAGE="$(dpkg-deb -f "$DEB" Package)"
# The command of its desktop entry
EXECUTABLE="$(sed -n 's/^Exec="\{0,1\}\([^" ]*\)"\{0,1\}.*/\1/p' "/usr/share/applications/$PACKAGE.desktop" | head -n 1)"
echo "installed $PACKAGE: $EXECUTABLE"
useradd -m tester
su tester -c "cd ~ && xvfb-run -a '$EXECUTABLE' > /tmp/app.log 2>&1" &
RUN=$!
for i in $(seq 1 60); do
    grep -q "started in production mode" /tmp/app.log 2>/dev/null && break
    sleep 1
done
sleep 5
echo "STARTED: $(grep -o '[^)]*): .*started in production mode' /tmp/app.log | head -n 1)"
echo "RUNNING: $(kill -0 "$RUN" 2> /dev/null && echo yes || echo no)"
tail -n 5 /tmp/app.log
