#!/bin/sh
# The table of the units (src/lib/UnitTable.ts), generated in a container of node:24-alpine: the units of mathjs 15.2.0
# and the CODATA 2022 constants of SciPy (SciPy and mpmath from the packages of Alpine), installed in the container only. The table is
# committed; the package depends on neither.
#
# Run: sh scripts/units/import.sh (Docker is needed)
set -e
cd "$(dirname "$0")/../.."
docker run --rm -v "$PWD:/package" -w /package node:24-alpine sh -c '
    set -e
    apk add --no-cache python3 py3-scipy py3-mpmath > /dev/null
    mkdir -p /engines && cd /engines && npm init -y > /dev/null
    npm install --no-audit --no-fund mathjs@15.2.0 > /dev/null 2>&1
    cd /package
    python3 scripts/units/codata.py > /engines/codata.json
    ENGINES=/engines node scripts/units/import.mjs
'
