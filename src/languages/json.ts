import * as vscode from "vscode";

import {
  findNodeAtOffset,
  Node,
  ParseError,
  parseTree,
} from "jsonc-parser/lib/esm/main";

/**
 * Returns whether the given URI points to a JSON file.
 */
export function isJson(uri: vscode.Uri): boolean {
  return /\.json[c5]?$/.test(uri.path);
}

/**
 * Parses a JSONC configuration file, returning its root {@link Node}, as well
 * as its diagnostics.
 */
export function parseJsonConfig(
  text: string,
): [Node | undefined, vscode.Diagnostic[]] {
  const errors: ParseError[] = [];
  const node = parseTree(text, errors, { allowTrailingComma: true });
  const diagnostics = errors.map((error) =>
    new vscode.Diagnostic(
      convertRange(text, error.offset, error.length),
      error.error.toString(),
    )
  );

  if (
    node === undefined || node.type !== "object" || diagnostics.length !== 0
  ) {
    return [undefined, diagnostics];
  }

  return [node, diagnostics];
}

/**
 * Returns the imports in the given array as a list of `import, range` pairs.
 */
export function getJsonImports(
  text: string,
  arrayNode: Node,
): [string, vscode.Range][] {
  const imports: [string, vscode.Range][] = [];

  if (arrayNode.type === "array") {
    for (const child of arrayNode.children!) {
      if (child.type === "string") {
        imports.push([
          child.value as string,
          convertRange(text, child.offset, child.length),
        ]);
      }
    }
  }

  return imports;
}

/**
 * If a comma must be inserted in order to insert a sibling at the end of the
 * given string, returns its position. Otherwise, returns -1.
 */
export function commaInsertionOffset(text: string): number {
  for (;;) {
    // Skip whitespace.
    const ws = /\s*$/.exec(text)![0].length;

    text = text.slice(0, text.length - ws);

    // Skip block comments.
    if (text[text.length - 1] === "/" && text[text.length - 2] === "*") {
      // Note: we don't need to do any error handling here since the JSON file
      // was already parsed.
      const until = text.lastIndexOf("/*", text.length - 2);

      text = text.slice(0, until);

      continue;
    }

    // Skip line comment.
    const lineStart = text.lastIndexOf("\n") + 1; // Also handles -1.
    const line = text.slice(lineStart);

    if (/^\s*\/\//.test(line)) {
      text = text.slice(0, lineStart);

      continue;
    }

    // Nothing to skip; get insertion position.
    break;
  }

  const needsComma = /["}\]el\d]$/.test(text);

  if (!needsComma) {
    return -1;
  }

  return text.length; // To account for first char.
}

/**
 * Converts a range based on absolute offsets to a {@link vscode.Range} based on
 * positions.
 */
export function convertRange(
  text: string,
  offset: number,
  length: number,
): vscode.Range {
  let line = 0;
  let col = 0;

  for (let i = 0; i < offset; i++) {
    if (text[i] === "\n") {
      line++;
      col = 0;
    } else if (text[i] !== "\r") {
      col++;
    }
  }

  const start = new vscode.Position(line, col);

  for (let i = 0; i < length; i++) {
    if (text[offset + i] === "\n") {
      line++;
      col = 0;
    } else if (text[offset + i] !== "\r") {
      col++;
    }
  }

  const end = new vscode.Position(line, col);

  return new vscode.Range(start, end);
}
