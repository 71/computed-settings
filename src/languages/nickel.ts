import * as vscode from "vscode";

import { joinMixed, parseUri, readFile, resolveExtensionPath } from "../utils";
import init, { load_nickel_file } from "../../out/nickel_js";

// @ts-expect-error: TypeScript doesn't know that esbuild replaces this with a
//   string
import nickelWasm from "../../out/nickel_js_bg.wasm";

let isWasmInitialized: boolean | Promise<void> = false;

/**
 * Returns whether the given URI points to a Nickel file.
 */
export function isNickel(uri: vscode.Uri): boolean {
  return uri.path.endsWith(".ncl");
}

/**
 * Loads a Nickel file, returning it as an object.
 */
export async function loadNickelFile(
  context: vscode.ExtensionContext,
  uri: vscode.Uri,
  saveImport: (uri: vscode.Uri, range: vscode.Range) => void,
  token: vscode.CancellationToken,
): Promise<Record<string, unknown> | unknown[]> {
  if (!isWasmInitialized) {
    isWasmInitialized = (async () => {
      const wasmUri = resolveExtensionPath(context, nickelWasm);
      const buffer = await vscode.workspace.fs.readFile(wasmUri);

      await init(buffer);

      isWasmInitialized = true;
    })();
  }

  await isWasmInitialized;

  const resolver = {
    resolve(
      path: string,
      startLine: number,
      startChar: number,
      endLine: number,
      endChar: number,
      basePath?: string,
    ): string {
      const targetUri = basePath === undefined
        ? parseUri(path)
        : joinMixed(vscode.Uri.file(basePath), "..", path);

      if (targetUri.scheme !== "file") {
        throw new Error("cannot resolve import");
      }

      const range = new vscode.Range(startLine, startChar, endLine, endChar);

      saveImport(targetUri, range);

      return targetUri.fsPath;
    },
    async getText(path: string): Promise<string> {
      const result = await readFile(vscode.Uri.file(path));

      if (token.isCancellationRequested) {
        throw new Error("cancel");
      }

      if (result instanceof Error) {
        throw result;
      }

      return result;
    },
    addDiagnostic(
      message: string,
      path: string,
      startLine: number,
      startChar: number,
      endLine: number,
      endChar: number,
    ): void {
      const uri = vscode.Uri.file(path);
      const range = new vscode.Range(startLine, startChar, endLine, endChar);
      const diagnostic = new vscode.Diagnostic(range, message);

      // TODO: do something with diagnostic
    },
  };

  const result = await load_nickel_file(resolver, uri.fsPath);

  if (typeof result !== "object" || result === null) {
    throw new Error("invalid file");
  }

  return result;
}
