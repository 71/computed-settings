import * as vscode from "vscode";

import { CONFIG_SECTION } from "./constants";
import {
  joinMixed,
  parseUri,
  readFile,
  registerForAllSettingsValues,
  registerForJsonDocuments,
  resolveExtensionPath,
  writeFile,
} from "./utils";

import vscodeConfigSchema from "./vscode-config-schema/1.77.json";

const MK_JSON_SCHEMA_COMMAND_ID = `${CONFIG_SECTION}.mkJsonSchema`;
const JSON_SCHEMA_FILE_NAME = `${CONFIG_SECTION}.schema.json`;

/**
 * Registers extension points related to JSON schemas.
 */
export function registerJsonSchemaIntelligence(
  context: vscode.ExtensionContext,
): void {
  // Add completions: when the user starts typing "$schema" in a JSON file,
  // suggest creating the schema.
  const completionItemProvider: vscode.CompletionItemProvider = {
    provideCompletionItems(document, position, _token, _context) {
      const textStartRange = document.positionAt(
        Math.max(document.offsetAt(position) - 10, 0),
      );
      const textBefore = document.getText(
        new vscode.Range(textStartRange, position),
      );
      const textAfter = document.getText(
        new vscode.Range(position, position.translate(undefined, 1)),
      );
      const quote = (s: string) => s === '"' ? "" : '"';
      const lastQuote = quote(textAfter);
      const completionItem = new vscode.CompletionItem(
        '"$schema": "..."',
        vscode.CompletionItemKind.Reference,
      );
      let match: RegExpExecArray | null;

      if (match = /"\$schema"(:? *)$/.exec(textBefore)) {
        completionItem.insertText = `${
          match[1].startsWith(":") ? "" : ": "
        }"./.${JSON_SCHEMA_FILE_NAME}${lastQuote}`;
      } else if (match = /^\s*{\s*(")?$/.exec(textBefore)) {
        completionItem.insertText = `${
          quote(match[1])
        }$schema": "./.${JSON_SCHEMA_FILE_NAME}${lastQuote}`;
      } else {
        return [];
      }

      const targetPath = vscode.Uri.joinPath(
        document.uri,
        "..",
        `.${JSON_SCHEMA_FILE_NAME}`,
      );

      completionItem.command = {
        command: MK_JSON_SCHEMA_COMMAND_ID,
        title: "Generate schema",
        arguments: [{ path: targetPath }],
      };

      return [completionItem];
    },
  };

  registerForJsonDocuments(
    context,
    (documentSelector) =>
      vscode.languages.registerCompletionItemProvider(
        documentSelector,
        completionItemProvider,
        '"',
        ":",
        " ",
      ),
  );

  // Add code action: when the user selects the generated schema, suggest
  // updating it.
  const codeActionProvider: vscode.CodeActionProvider = {
    provideCodeActions(document, range, context, _token) {
      if (
        context.only !== undefined &&
        !context.only.contains(vscode.CodeActionKind.QuickFix)
      ) {
        return;
      }

      if (document.fileName.endsWith(JSON_SCHEMA_FILE_NAME)) {
        // For generated files, allow any inline to trigger a quick-fix for a
        // refresh.
        return [
          {
            title: "Update generated schema",
            kind: vscode.CodeActionKind.QuickFix,
            command: {
              command: MK_JSON_SCHEMA_COMMAND_ID,
              title: "Update generated schema",
              arguments: [{ path: document.uri }],
            },
          },
        ];
      }

      let text = "";

      for (let line = range.start.line; line <= range.end.line; line++) {
        text += document.lineAt(line).text + "\n";
      }

      const schemaLine = /"\$schema"\s*:\s*("[^"\n]+")/.exec(text);

      if (schemaLine === null) {
        return;
      }

      const schemaPath = JSON.parse(schemaLine[1]) as string;

      if (!schemaPath.endsWith(JSON_SCHEMA_FILE_NAME)) {
        return;
      }

      const targetPath = joinMixed(document.uri, "..", schemaPath);

      if (targetPath.scheme !== "file") {
        return;
      }

      return [
        {
          title: "Update generated schema",
          kind: vscode.CodeActionKind.QuickFix,
          command: {
            command: MK_JSON_SCHEMA_COMMAND_ID,
            title: "Update generated schema",
            arguments: [{ path: targetPath }],
          },
        },
      ];
    },
  };

  registerForJsonDocuments(
    context,
    (documentSelector) =>
      vscode.languages.registerCodeActionsProvider(
        documentSelector,
        codeActionProvider,
      ),
  );

  context.subscriptions.push(
    // Register the command that generates or updates schemas.
    vscode.commands.registerCommand(
      MK_JSON_SCHEMA_COMMAND_ID,
      async ({ path }: { path: vscode.Uri }) => {
        const schema = await getJsonSchema(context);
        const schemaString = JSON.stringify(schema, undefined, 2);

        const writeError = await writeFile(path, schemaString);

        if (writeError !== undefined) {
          console.error(writeError);
        }
      },
    ),
    // Clear cache when an extension is added or removed, since the schema takes
    // extension settings into account.
    vscode.extensions.onDidChange(() => cachedJsonSchema = undefined),
  );

  // Watch `json.schemas` to know when generated schemas should be created.
  registerForAllSettingsValues(context, {
    ["json.schemas"](
      schemas: { url: string }[] | undefined,
      _: vscode.Uri,
      schemaResolutionUri?: vscode.Uri,
    ): void {
      if (!Array.isArray(schemas)) {
        return;
      }

      // Generate JSON schema if needed.
      //
      // Note that `json.schemas` resolves URIs from the workspace root.
      generateJsonSchemaForConfiguration(schemas, schemaResolutionUri);
    },
  });
}

/**
 * Generates JSON schemas mentioned in the configuration.
 */
function generateJsonSchemaForConfiguration(
  schemas: readonly { readonly url: string }[],
  schemaResolutionUri?: vscode.Uri,
): void {
  for (const { url } of schemas) {
    const schemaUri = schemaResolutionUri === undefined
      ? parseUri(url)
      : joinMixed(schemaResolutionUri, url);

    if (
      schemaUri.scheme === "file" &&
      schemaUri.path.endsWith(JSON_SCHEMA_FILE_NAME)
    ) {
      vscode.commands.executeCommand(MK_JSON_SCHEMA_COMMAND_ID, {
        path: schemaUri,
      });
    }
  }
}

let cachedVscodeConfigProperties: undefined | Promise<Record<string, object>>;
let cachedJsonSchema: undefined | Promise<object>;

/**
 * Returns the current JSON schema.
 */
async function getJsonSchema(
  context: vscode.ExtensionContext,
): Promise<object> {
  if (cachedJsonSchema === undefined) {
    cachedJsonSchema = getVscodeConfigProperties(context)?.then(
      (vscodeProperties) => {
        const schema = {
          $schema: "https://json-schema.org/draft/2020-12/schema",
          title: "Settings",
          type: "object",
          properties: {},
        };

        for (const extension of vscode.extensions.all) {
          const properties = extension.packageJSON?.contributes?.configuration;

          if (properties === undefined) {
            continue;
          }

          const propertiesAsArray = Array.isArray(properties)
            ? properties
            : [properties];

          for (const extensionSchema of propertiesAsArray) {
            Object.assign(schema.properties, extensionSchema["properties"]);
          }
        }

        Object.assign(schema.properties, vscodeProperties["properties"]);

        return schema;
      },
    );
  }

  return await cachedJsonSchema;
}

/**
 * Returns the dictionary of properties of the built-in VS Code configuration.
 */
async function getVscodeConfigProperties(
  context: vscode.ExtensionContext,
): Promise<Record<string, object>> {
  if (cachedVscodeConfigProperties === undefined) {
    const vscodeConfigSchemaPath = resolveExtensionPath(
      context,
      vscodeConfigSchema,
    );

    cachedVscodeConfigProperties = readFile(vscodeConfigSchemaPath)
      .then((contents) => {
        if (contents instanceof Error) {
          throw new Error(
            `cannot open ${vscodeConfigSchemaPath}: ${contents.message}`,
          );
        }

        return JSON.parse(contents);
      });
  }

  return cachedVscodeConfigProperties;
}
