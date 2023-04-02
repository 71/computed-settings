import * as vscode from "vscode";

import { registerImportSystem } from "./import-system";
import { registerJsonSchemaIntelligence } from "./schema";

export function activate(context: vscode.ExtensionContext): void {
  registerImportSystem(context);
  registerJsonSchemaIntelligence(context);
}

export function deactivate(): void {
  // No-op; handled by subscriptions.
}
