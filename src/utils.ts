import * as vscode from "vscode";

import { TextDecoder, TextEncoder } from "util";
import {
  CANNOT_READ_FILE_ERROR,
  CANNOT_WRITE_FILE_ERROR,
  FILE_IS_NOT_UTF8_ERROR,
} from "./constants";

const os = globalThis?.process?.platform,
  seemsLikeAbsoluteFilePath = os === "win32"
    ? (value: string) => /^([/\\]|[A-Za-z]:)/.test(value)
    : (value: string) => value[0] === "/";

/**
 * Joins a URI to some segments; segments may be absolute URIs to resources with
 * _different_ schemes.
 *
 * @see {@link vscode.Uri.joinPath()}
 */
export function joinMixed(
  base: vscode.Uri,
  ...segments: readonly string[]
): vscode.Uri {
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];

    if (seemsLikeAbsoluteFilePath(segment)) {
      base = vscode.Uri.file(segment);
    } else if (/^[a-z]+:/.test(segment)) {
      base = vscode.Uri.parse(segment);
    } else {
      continue;
    }

    segments = segments.slice(i + 1);
    i = 0;
  }

  return vscode.Uri.joinPath(base, ...segments);
}

/**
 * Parses an absolute URI, preferring file URIs.
 *
 * @see {@link vscode.Uri.parse()}
 */
export function parseUri(value: string): vscode.Uri {
  if (seemsLikeAbsoluteFilePath(value)) {
    return vscode.Uri.file(value);
  }

  return vscode.Uri.parse(value);
}

/**
 * Resolves the URI to an extension resource.
 */
export function resolveExtensionPath(
  context: vscode.ExtensionContext,
  path: string,
): vscode.Uri {
  return DEV
    ? vscode.Uri.joinPath(context.extensionUri, "out", path)
    : vscode.Uri.joinPath(context.extensionUri, path);
}

/**
 * Reads the file at `uri` into a string, assuming that its contents are valid
 * UTF-8.
 */
export async function readFile(uri: vscode.Uri): Promise<string | Error> {
  let bytes: Uint8Array;

  try {
    bytes = await vscode.workspace.fs.readFile(uri);
  } catch {
    return new Error(CANNOT_READ_FILE_ERROR);
  }

  try {
    return new TextDecoder("utf-8", { ignoreBOM: true, fatal: true }).decode(
      bytes,
    );
  } catch {
    return new Error(FILE_IS_NOT_UTF8_ERROR);
  }
}

/**
 * Reads the file at `uri` into a string, assuming that its contents are valid
 * UTF-8.
 */
export async function writeFile(
  uri: vscode.Uri,
  text: string,
): Promise<undefined | Error> {
  // Write configuration text to file.
  try {
    await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(text));

    return;
  } catch {
    return new Error(CANNOT_WRITE_FILE_ERROR);
  }
}

/**
 * Calls `f` for all setting values in the
 */
function forAllSettingValues<T>(
  context: vscode.ExtensionContext,
  section: string,
  property: string,
  f: (
    value: T | undefined,
    configFileUri: vscode.Uri,
    resolutionBaseUri: vscode.Uri | undefined,
  ) => void,
): void {
  // This should work for all platforms:
  //   https://code.visualstudio.com/docs/getstarted/settings#_settings-file-locations
  //
  // `.../Code/User/globalStorage/extension.id`
  //   ↓
  // `.../Code/User/settings.json`
  const userSettingsPath = vscode.Uri.joinPath(
    context.globalStorageUri,
    "..",
    "..",
    "settings.json",
  );

  // Note that relative schemas are not supported for the global config.
  const config = vscode.workspace.getConfiguration(section).inspect<T>(
    property,
  );

  f(config?.globalValue, userSettingsPath, undefined);

  if (vscode.workspace.isTrusted) {
    const { workspaceFile, workspaceFolders } = vscode.workspace;

    if (workspaceFile !== undefined) {
      f(
        config?.workspaceValue,
        workspaceFile,
        vscode.Uri.joinPath(workspaceFile, ".."),
      );
    } else if (workspaceFolders?.length === 1) {
      const workspaceFolder = workspaceFolders[0];
      const workspaceSettingsPath = vscode.Uri.joinPath(
        workspaceFolder.uri,
        ".vscode",
        "settings.json",
      );

      f(config?.workspaceValue, workspaceSettingsPath, workspaceFolder.uri);
    } else if (workspaceFolders?.length ?? 0 > 1) {
      for (const workspaceFolder of workspaceFolders!) {
        const workspaceSettingsPath = vscode.Uri.joinPath(
          workspaceFolder.uri,
          ".vscode",
          "settings.json",
        );
        const config = vscode.workspace.getConfiguration(
          section,
          workspaceFolder.uri,
        );

        f(config.get(property), workspaceSettingsPath, workspaceFolder.uri);
      }
    }
  }
}

/**
 * Runs {@link forAllSettingValues()} now and whenever the requested settings
 * may have changed.
 */
export function registerForAllSettingsValues<
  KV extends Record<`${string}.${string}`, any>,
>(
  context: vscode.ExtensionContext,
  watchers: {
    readonly [PropertyAndSection in keyof KV]: (
      value: KV[PropertyAndSection] | undefined,
      configFileUri: vscode.Uri,
      resolutionBaseUri: vscode.Uri | undefined,
    ) => void;
  },
): void {
  const parsedWatchers: [string, string, (typeof watchers)[any]][] = [];

  for (const [propertyAndSection, handler] of Object.entries(watchers)) {
    const dotIndex = propertyAndSection.lastIndexOf(".");
    const section = propertyAndSection.slice(0, dotIndex);
    const property = propertyAndSection.slice(dotIndex + 1);

    parsedWatchers.push([section, property, handler]);
  }

  const callWatchers = () => {
    for (const [section, property, handler] of parsedWatchers) {
      forAllSettingValues(context, section, property, handler);
    }
  };

  callWatchers();

  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      if (!vscode.workspace.isTrusted) {
        return;
      }

      callWatchers();
    }),
    vscode.workspace.onDidGrantWorkspaceTrust(callWatchers),
    vscode.workspace.onDidChangeConfiguration((e) => {
      for (const [section, property, handler] of parsedWatchers) {
        if (e.affectsConfiguration(`${section}.${property}`)) {
          forAllSettingValues(context, section, property, handler);
        }
      }
    }),
  );
}

/**
 * Calls `register` with {@link vscode.DocumentSelector document selectors} that
 * match JSON documents.
 */
export function registerForJsonDocuments(
  context: vscode.ExtensionContext,
  register: (selector: vscode.DocumentSelector) => vscode.Disposable,
) {
  for (const scheme of ["file", "vscode-userdata"]) {
    for (const language of ["json", "jsonc"]) {
      context.subscriptions.push(register({ scheme, language }));
    }
  }
}
