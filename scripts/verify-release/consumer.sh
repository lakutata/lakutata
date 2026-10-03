#!/usr/bin/env bash
# The side of the users, in a clean node container whose registry is the one of the verification (npm_config_registry):
# the tool is run with npx, the projects are created from the published templates, installed, built and tested, as a user
# does. The results are written to /work/results.txt, the output of each step to /work/logs.
set -u

TAG="${VERIFY_TAG:-verify}"
TEMPLATES="${VERIFY_TEMPLATES:-default cli service web-react web-vue web-next web-nuxt electron-react electron-vue}"
# The templates created with their installer feature (their Dockerfile.installer, made into packages by verify.mjs)
INSTALLERS="${VERIFY_INSTALLERS:-cli service web-react web-vue web-next web-nuxt}"
RESULTS=/work/results.txt
LOGS=/work/logs
PROJECTS=/work/projects
mkdir -p "$LOGS" "$PROJECTS"
: > "$RESULTS"
export CI=1 NEXT_TELEMETRY_DISABLED=1 NUXT_TELEMETRY_DISABLED=1 npm_config_update_notifier=false npm_config_fund=false npm_config_audit=false

# Run a step: its output goes to its log, its result to the results (the output is shown when it fails)
step() {
    local name="$1"
    shift
    local log="$LOGS/$(echo "$name" | tr ' /@' '___').log"
    echo "› $name"
    local started=$SECONDS
    if ("$@") > "$log" 2>&1; then
        echo "PASS $name ($((SECONDS - started))s)" | tee -a "$RESULTS"
        return 0
    fi
    echo "FAIL $name ($((SECONDS - started))s)" | tee -a "$RESULTS"
    tail -n 40 "$log" | sed 's/^/    /'
    return 1
}

# The output of a step must match a pattern
expect() {
    local pattern="$1"
    shift
    local output
    output="$("$@" 2>&1)" || { echo "$output"; return 1; }
    echo "$output"
    echo "$output" | grep -Eq "$pattern" || { echo "expected: $pattern"; return 1; }
}

echo "Node.js $(node --version), npm $(npm --version), registry $(npm config get registry)"
step "tool: version" expect "^3\." npx -y "@lakutata/cli@$TAG" --version
step "tool: templates" expect "web-nuxt" npx -y "@lakutata/cli@$TAG" templates
step "tool: info" npx -y "@lakutata/cli@$TAG" info

# The framework installed alone, by the ES modules and the CommonJS modules
consumer() {
    local directory="$PROJECTS/consumer"
    rm -rf "$directory" && mkdir -p "$directory" && cd "$directory" || return 1
    npm init -y > /dev/null && npm install "lakutata@$TAG" || return 1
    cat > esm.mjs <<'SOURCE'
import {Application, DTO, Time} from 'lakutata'
const schema = DTO.Object({name: DTO.String().required()})
await DTO.validateAsync({name: 'esm'}, schema)
console.log('esm', typeof Application.run, new Time('2024-01-01T00:00:00Z').timezone('UTC').format('YYYY-MM-DD'))
SOURCE
    cat > cjs.cjs <<'SOURCE'
const {Application, DTO, Time} = require('lakutata')
DTO.validateAsync({name: 'cjs'}, DTO.Object({name: DTO.String().required()})).then(() => console.log('cjs', typeof Application.run, new Time('2024-01-01T00:00:00Z').timezone('UTC').format('YYYY-MM-DD')))
SOURCE
    node esm.mjs && node cjs.cjs
}
step "framework: ESM and CommonJS" expect "cjs function 2024-01-01" consumer

for template in $TEMPLATES; do
    name="verify-$template"
    directory="$PROJECTS/$name"
    rm -rf "$directory"
    features=""
    case " $INSTALLERS " in *" $template "*) features="--with installer" ;; esac
    # shellcheck disable=SC2086
    step "$template: create" npx -y "@lakutata/cli@$TAG" create --name "$name" --template "$template" --path "$PROJECTS" $features --yes || continue
    step "$template: build" bash -c "cd '$directory' && npm run build"
    step "$template: test" bash -c "cd '$directory' && npm test"
    if [ "$template" = "cli" ]; then
        # The executable runs without node_modules and without Node.js
        step "cli: package:exe" bash -c "cd '$directory' && npm run package:exe"
        step "cli: executable" expect "^Hello, executable!$" bash -c "cp '$directory/dist/$name' /tmp/ && cd / && env PATH= /tmp/$name greet --name executable"
    fi
done
echo "Done"
