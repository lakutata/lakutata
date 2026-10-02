# @lakutata/templates

The catalog of the official templates of the [lakutata](https://github.com/lakutata/lakutata) projects: the
`lakutata.templates` field of its `package.json` lists them. `lakutata templates` reads the latest version of this package
from the npm registry, so a template is added by publishing its package and a new version of the catalog, without
releasing the command line tool.

Each template is a package `@lakutata/template-<name>` whose files are in its `template/` directory. An entry of the catalog has the
name, the description and the package of the template, and the names of its optional features (`features`, enabled
by `lakutata create --with <features>`; the files of a feature are in the `features/<name>/` directory of its package).
