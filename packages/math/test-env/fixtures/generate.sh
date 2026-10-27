#!/bin/sh
# The expected results of the fixtures (expected/*.json), generated in a container of node:24-alpine: SymPy, NumPy and
# SciPy from the packages of Alpine (reference.py, linalg.py, stats.py), mathjs and nerdamer installed in the container only
# (engines.mjs). The results are committed; the tests of the package read them and never run SymPy, NumPy, SciPy,
# mathjs or nerdamer.
#
# Run: sh test-env/fixtures/generate.sh (Docker is needed)
set -e
cd "$(dirname "$0")"
docker run --rm -v "$PWD:/fixtures" -w /fixtures node:24-alpine sh -c '
    set -e
    apk add --no-cache python3 py3-sympy py3-numpy py3-scipy > /dev/null
    mkdir -p /engines && cd /engines && npm init -y > /dev/null
    npm install --no-audit --no-fund mathjs@15.2.0 nerdamer@1.1.13 > /dev/null 2>&1
    cd /fixtures
    python3 reference.py
    python3 linalg.py
    python3 stats.py
    ENGINES=/engines node engines.mjs
'
