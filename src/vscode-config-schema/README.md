This directory contains JSON schemas for the built-in VS Code configuration
values.

You can create one of these files by opening the devtools in VS Code
(`Developer: Toggle Developer Tools`) and executing the following code in the
console.

```js
(() => {
  const { nameLong, version } = _VSCODE_PRODUCT_JSON;
  const { Extensions } = require(
    "vs/platform/configuration/common/configurationRegistry",
  );
  const { Registry } = require("vs/platform/registry/common/platform");

  const configurationRegistry = Registry.as(Extensions.Configuration);
  const builtInConfigurations = configurationRegistry.getConfigurations()
    .filter((x) => x.extensionInfo === undefined);

  const mergedProperties = {};

  for (const { properties } of builtInConfigurations) {
    for (const property in properties) {
      if (property[0] !== "[") {
        mergedProperties[property] = properties[property];
      }
    }
  }

  return JSON.stringify({
    $schema: "https://json-schema.org/draft/2020-12/schema",
    title: `${nameLong} ${version} configuration`,
    type: "object",
    properties: mergedProperties,
  });
})();
```
