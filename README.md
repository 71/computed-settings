# `computed-settings`

_Computed_ settings in [VS Code](https://code.visualstudio.com).

> This is a work in progress. Configuration files may be lost, so please make
> sure to back them up.

## Features

### Configuration imports

A configuration file (such as `.vscode/settings.json` or the user's preferences)
may import other configuration files using the `imports` option as follows:

```jsonc
{
  "computed-settings.imports": [
    "./foo.jsonc"
  ],

  "editor.tabSize": 3
}
```

The imported files will then be resolved relatively to the configuration file,
and their configuration will be flattened. Assuming that `foo.jsonc` contains
the following:

```jsonc
{
  "editor.minimap.enabled": true,
  "editor.tabSize": 5
}
```

Then the initial file will be updated like this:

```jsonc
{
  "computed-settings.imports": [
    "./foo.jsonc"
  ],

  "editor.tabSize": 3,

  // #region Generated by https://github.com/71/computed-settings
  "editor.minimap.enabled": true
  // #endregion Generated by https://github.com/71/computed-settings
}
```

Please note:

1. The current configuration takes precedence over imported configurations; i.e.
   `editor.tabSize` is not replaced by the imported value.
2. Configurations are imported recursively, i.e. `foo.jsonc` may also have
   imports above.
3. If multiple imports are specified, they are merged as follows:
   - Arrays are merged shallowly, i.e. only top-level arrays are merged.
   - Latter imports take precedence over former ones when a choice must be made,
     i.e. when a property is not assigned to an array.

### JSON Schema generation

Note: I wrote this not knowing that settings schemas can be used directly from
arbitrary JSON files, so the section below is mostly useless. When editing
settings, use one of the following schemas:

- `vscode://schemas/settings/folder`
- `vscode://schemas/keybindings`

Other schemas are also available, and listed in the "Feature contributions" tab
of the "Configuration Editing" built-in extension
(`vscode.configuration-editing`).

<details>

<summary>Old documentation</summary>

[JSON Schemas](https://json-schema.org) corresponding to the possible
configuration values can be generated and written to the disk.

There are two ways to generate the configuration on disk:

1. In a JSON file, start typing `"$schema":` at the start of the file (after
   `{`); a completion `"$schema": "..."` will be made available. If you select
   it, the schema will be generated in the same directory under the name
   `.computed-settings.schema.json`.
   - After generating this line, a quick-fix will also be available on this line
     to update the generated file.
2. In `settings.json`, add a `json.schemas` with an entry whose file name ends
   with `computed-settings.schema.json`, e.g.
   ```jsonc
   {
     "json.schemas": [
       {
         "fileMatch": [
           "*.jsonc"
         ],
         "url": ".vscode/.computed-settings.schema.json"
       }
     ]
   }
   ```
   When this option is present, a schema will automatically be generated. Note
   that the `url` is resolved relatively to the workspace root.

> Note: these schemas are generated using the configuration options of VS Code
> at a given version (as of now, [1.77](src/vscode-config-schema/1.77.json)),
> and combining them with the configuration options provided by the currently
> loaded extensions. If extensions change or if the included VS Code config
> schema is out of date, the generated schema may not entirely be accurate.

</details>

## Partial features

The following features are partially implemented, with possible errors and poor
diagnostics.

### Nickel support

To provide more power to computed settings, [Nickel](https://nickel-lang.org)
file may also be imported.

Features:

- [x] Nickel files can be imported, and may import other Nickel files
- [ ] Errors are reported as diagnostics in VS Code
- [ ] Schema generation for Nickel files
- [ ] Using schema information to allow dotted properties

To import Nickel files, simply specify a `.ncl` extension when importing a file:

```jsonc
{
  "computed-settings.imports": [
    "./foo.ncl",
    "./bar.json"
  ]
}
```

### Imports into other files

Since files other than `settings.json` may benefit from being cut into multiple
files, an `importInto` option is provided as well:

```jsonc
{
  "computed-settings.importInto": {
    "tasks.json": [
      "./shared-tasks.json"
    ],
    "keybindings.json": [
      "../shared-keybindings.json"
    ]
  }
}
```

This will perform the same import process as `imports`, but the computed
configuration will be appended to the specified files.

## Planned features

1. Tests:
   1. Import tests.
   2. Import-into tests.
   3. Schema generation tests.
   4. Array-merging tests.
   5. Ensuring that it works in VSCodium.
   6. Ensuring that it works in remote contexts and in the browser.
   7. Gotchas:
      1. Recursive imports
      2. Shared imports
      3. Non-relative imports
2. Computation in JSON strings:
   1. Evaluation of `${env:...}` / `${workspaceFolder}` interpolations
   2. Conditionals
   3. Special `${import:}` interpolations
3. More languages:
   1. YAML
   2. TOML
   3. (Maybe) Jsonnet, Cue, Dhall
4. Other merging strategies:
   1. (Maybe) Merge up to a specified depth
   2. (Maybe) Merge using schema information
5. Schema generation:
   1. Show quick-fix in `settings.json` under `json.schemas` to refresh the
      generated schema
   2. Detect whether the generated schema is out-of-date and only display a
      quick-fix if it is
   3. Support for other files:
      1. `keybindings.json`
      2. `tasks.json`
      3. `launch.json`
