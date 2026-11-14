# Lakutata Command Line

The command-line adapter turns controller actions marked with `@CLIAction` into the commands of a command-line tool. It
is built on [Commander](https://github.com/tj/commander.js). Install `commander` (version 12 to 15) next to `lakutata`,
and `@inquirer/prompts` (version 7 or 8) if the tool should prompt for missing values:

```bash
npm install commander @inquirer/prompts
```

## 1. A first tool

```typescript
import {Application, DTO} from 'lakutata'
import {buildEntrypoints, Controller} from 'lakutata/com/entrypoint'
import {CLIAction} from 'lakutata/decorator/ctrl'
import {Expect} from 'lakutata/decorator/dto'
import {commanderCLIEntrypoint} from 'lakutata/adapter/commander'

class GreetDTO extends DTO {
    @Expect(DTO.String().required().description('The name to greet'))
    public name: string

    @Expect(DTO.Number().integer().min(1).default(1).description('How many times'))
    public times: number

    @Expect(DTO.Boolean().default(false).description('Greet in capitals'))
    public loud: boolean
}

class ToolController extends Controller {
    @CLIAction('greet <name>', GreetDTO, {description: 'Greet someone'})
    public async greet(input: GreetDTO): Promise<string> {
        const text: string = `Hello, ${input.name}`
        return Array(input.times).fill(input.loud ? text.toUpperCase() : text).join('\n')
    }
}

Application.run(() => ({
    id: 'tool.app',
    name: 'Tool',
    components: {
        entrypoint: buildEntrypoints({
            controllers: [ToolController],
            cli: commanderCLIEntrypoint({bin: 'tool', description: 'A small tool', version: '1.0.0'})
        })
    },
    bootstrap: ['entrypoint']
}))
```

```text
$ node dist/index.js greet Ada --times 2 --loud
HELLO, ADA
HELLO, ADA
```

What happens:

1. The application launches. The entrypoint must be listed in `bootstrap`: otherwise nothing creates it and no command
   runs.
2. Once the application has launched (every object in `bootstrap` is created and the other adapters have started), the
   adapter reads the command line and runs the matching action.
3. The result goes to stdout, an error to stderr.
4. The application stops and the process exits with code 0 if the command succeeded, 1 if it failed.

`bin` is the program's name in the help. Without it, the adapter uses the script file's name, which is `index` for
`node dist/index.js`.

## 2. Commands and arguments

`@CLIAction(command, DTO?, options?)` (from `lakutata/decorator/ctrl`) declares a command. The `command` string is the
command's name followed by its arguments, in Commander's syntax:

| Syntax | Meaning |
|---|---|
| `<name>` | A required argument |
| `[name]` | An optional argument |
| `<files...>` | One or more arguments, collected in an array (`[files...]`: zero or more) |

Each argument goes to the DTO property with the same name, converted to the property's type. Extra arguments are an
error.

**Groups.** The words before the command's name are groups. `@CLIAction('file copy <files...>', CopyDTO)` is the `copy`
command in the `file` group, run as `tool file copy a.txt b.txt`. Groups can be nested (`'pack linux deb'`). The
adapter's `groups` option describes them in the help, and `tool file --help` lists a group's commands. The help of a
tool with the `greet` command and the `file` group:

```text
$ tool --help
Usage: tool [options] [command]

A small tool

Options:
  -V, --version           output the version number
  -h, --help              display help for command

Commands:
  greet [options] <name>  Greet someone
  file                    Work on files
  help [command]          display help for command
```

**Help text.** The `description` action option is the command's line in the help. Without it, the help shows the
action's name (`ToolController:greet`).

**Prefixes.** `@Prefix({command: 'user'})` on a controller joins the prefix to each of its commands with a colon:
`@CLIAction('get <id>')` becomes `tool user:get 42`. The prefix is part of the command's name, not a group.

## 3. Options

The DTO's other properties are options. An option is named after its property in kebab case (`keepTimes` becomes
`--keep-times`), and the property's type determines its form:

| Property type | Option | Example |
|---|---|---|
| boolean | A flag | `--loud` |
| boolean whose default is `true` | A flag and its negation | `--keep-times`, `--no-keep-times` |
| `DTO.Alternatives(DTO.Boolean(), …)` | A flag with an optional value | `--color`, `--color always` |
| number | A number | `--times 2` |
| array | One or more values, also collected from repeated options | `--ports 80 443` |
| object | A JSON value | `--filter '{"active":true}'` |
| anything else | A string | `--mode fast` |

The help shows each property's `.description()`, default and allowed values (`.valid()`). A value outside the allowed
list, or text where a number is expected, is refused before the action runs:

```text
$ tool file copy --help
Usage: tool file copy [options] <files...>

Copy files

Options:
  --mode <value>       The copy mode (choices: "fast", "safe", default: "safe")
  --keep-times         Keep the timestamps (default: true)
  --no-keep-times      Turn off --keep-times
  --ports <values...>  The ports
  -h, --help           display help for command

$ tool file copy a.txt --mode slow
error: option '--mode <value>' argument 'slow' is invalid. Allowed choices are "fast", "safe".
```

- A required property without a default must be provided, unless the tool prompts for it (see section 5).
- Options have no short form such as `-m`.
- A command without a DTO accepts no options, and its arguments reach the action as strings.

The DTO then validates the input as for any action: its defaults are applied and unknown keys are removed (see
[DTO Validation](DTOValidation.md)).

## 4. Output and exit codes

The action's return value is written to stdout:

| Value returned | Output |
|---|---|
| A string | The string, with a final line break added if it has none |
| `null`, `undefined` | Nothing |
| A `Uint8Array` (a `Buffer`) | The bytes, unchanged |
| Any other value | Indented JSON |
| `Result.file(path)` (or a `Buffer`, or a stream) | The file's content |
| `Result.events(producer)` | Each event's data, as it is sent |
| `Result.status(status, data)` | The data only |

`Result` comes from `lakutata/com/entrypoint`. The `format` option replaces this formatting: it receives each result
(and each event) and returns a string, bytes, or `undefined` to write nothing.

Where the messages go, and the exit code:

| Situation | Output | Exit code |
|---|---|---|
| The command succeeded | The result, on stdout | 0 |
| The action, a middleware, validation or access control failed | `error: <message>` on stderr | 1 |
| An unknown command, a missing argument, an invalid value, extra arguments | Commander's message on stderr | 1 |
| `--help`, `--version` | stdout | 0 |
| No command at all | The help on stderr | 1 |

```text
$ tool greet
error: missing required argument 'name'
$ tool greet Ada --times x
error: option '--times <value>' argument 'x' is invalid. Not a number.
```

Inside the action, `this.context` is a `CLIContext`: its `command` is the command as declared, with its prefix
(`'user:get <id>'`), and its `data` holds the arguments and options read from the command line, before validation.

## 5. Prompts

When the tool runs in a terminal and `@inquirer/prompts` is installed, it prompts for missing values instead of failing.
It prompts for each required property that has no value and no default, one after another. A missing required argument
(`<name>`) is not prompted for: it is an error.

| Property | Prompt |
|---|---|
| boolean | Yes or no |
| With allowed values (`.valid()`) | A list to choose from |
| An array of allowed values | A list of check boxes |
| number | A number |
| Named like a password, a secret, a token, an API key or a credential | A hidden input, shown as `*` |
| Anything else | Text input; an array as comma-separated values, an object as JSON |

Each answer is checked against its property's schema immediately: an invalid answer shows the error and the question is
asked again. The question is the property's `.description()`, followed by its name.

The `interactive` option determines when the tool prompts:

- `'auto'` (the default): when stdin and stdout are both terminals. When the input or output is piped, as in a script, a
  missing value is an error instead of a prompt.
- `true`: always, as long as `@inquirer/prompts` is installed.
- `false`: never.

## 6. The options of the adapter

| Option | Default | Meaning |
|---|---|---|
| `bin` | The script file's name | The program's name in the help |
| `description` | | The program's description in the help |
| `version` | | Adds `-V, --version`, which prints it |
| `groups` | | Group descriptions: `{file: 'Work on files', 'pack linux': 'Linux packages'}` |
| `argv` | `process.argv.slice(2)` | The arguments to read |
| `interactive` | `'auto'` | When to prompt for missing values (see section 5) |
| `stdin`, `stdout`, `stderr` | The process's streams | Where prompts read from, and where results and errors are written |
| `format` | See section 4 | Turns a result into the text or bytes to write |
| `noCommand` | `'help'` | Without arguments: `'help'` writes the help and exits with code 1, `'ignore'` runs nothing and leaves the application running |
| `exit` | `'application'` | After the command: `'application'` stops the application and exits with the command's exit code, `'process'` only sets `process.exitCode`, `'none'` does nothing, and a function receives the code |
| `configure` | | `(program) => void`, called with the Commander program once the commands are added, before the arguments are read: global options, hooks |
| `translate` | | Translates the help and the prompts (see [Internationalization (i18n)](I18n.md#help-and-prompts-of-a-command-line-tool)) |
| `middlewares` | | Middlewares for this adapter's commands, run after the entrypoint's |
| `name` | | The adapter's name, to distinguish several adapters |

## 7. Commands in a server application

An application can serve HTTP and also provide commands. By default, however, the command-line adapter stops the
application after its command, and without arguments it writes the help and exits. To start the server when the
application runs without arguments, and to run a command otherwise, set `noCommand: 'ignore'`:

```typescript
import {Application} from 'lakutata'
import {buildEntrypoints, Controller} from 'lakutata/com/entrypoint'
import {CLIAction, GET} from 'lakutata/decorator/ctrl'
import {commanderCLIEntrypoint} from 'lakutata/adapter/commander'
import {expressHTTPEntrypoint} from 'lakutata/adapter/express'

class AppController extends Controller {
    @GET('/hello')
    public async hello(): Promise<string> {
        return 'Hello'
    }

    @CLIAction('migrate', {description: 'Migrate the database'})
    public async migrate(): Promise<string> {
        return 'Migrated'
    }
}

Application.run(() => ({
    id: 'shop.app',
    name: 'Shop',
    components: {
        entrypoint: buildEntrypoints({
            controllers: [AppController],
            cli: commanderCLIEntrypoint({bin: 'shop', noCommand: 'ignore'}),
            http: expressHTTPEntrypoint({port: 8080})
        })
    },
    bootstrap: ['entrypoint']
}))
```

`node dist/index.js` starts the server and keeps running. `node dist/index.js migrate` runs the command once the server
has started, then stops the application.
