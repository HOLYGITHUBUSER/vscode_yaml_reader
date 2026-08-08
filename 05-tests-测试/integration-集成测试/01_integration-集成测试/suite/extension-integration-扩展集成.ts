import assert from "node:assert/strict";
import * as vscode from "vscode";

const EXTENSION_ID = "yaml-reader.yaml-reader";
const OPEN_COMMAND = "yamlReader.openPreview";
const OPEN_WORKBENCH_COMMAND = "yamlReader.openWorkbench";
const VIEW_TYPE = "yamlReader.preview";
const WORKBENCH_VIEW_TYPE = "yamlReader.workbench";
const WAIT_TIMEOUT_MS = 10_000;

export async function run(): Promise<void> {
  const extension = vscode.extensions.getExtension(EXTENSION_ID);
  assert.ok(extension, `Extension ${EXTENSION_ID} must be discoverable`);
  await extension.activate();
  assert.equal(extension.isActive, true, "Extension must activate");

  const commands = await vscode.commands.getCommands(true);
  assert.ok(
    commands.includes(OPEN_COMMAND),
    `${OPEN_COMMAND} must be registered`
  );
  assert.ok(
    commands.includes(OPEN_WORKBENCH_COMMAND),
    `${OPEN_WORKBENCH_COMMAND} must be registered`
  );

  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  assert.ok(workspaceFolder, "Integration workspace must be open");
  const fixtureUri = vscode.Uri.joinPath(
    workspaceFolder.uri,
    "sample.yaml"
  );
  const before = await vscode.workspace.fs.readFile(fixtureUri);

  await vscode.commands.executeCommand(OPEN_COMMAND, fixtureUri);
  const customTab = await waitForCustomEditor();
  assert.equal(
    customTab.input instanceof vscode.TabInputCustom,
    true,
    "Active tab must be a custom editor"
  );
  if (customTab.input instanceof vscode.TabInputCustom) {
    assert.equal(customTab.input.viewType, VIEW_TYPE);
    assert.equal(customTab.input.uri.toString(), fixtureUri.toString());
  }

  await delay(750);
  const after = await vscode.workspace.fs.readFile(fixtureUri);
  assert.deepEqual(
    [...after],
    [...before],
    "Opening YAML Reader must not change source bytes"
  );
  const sourceDocument = vscode.workspace.textDocuments.find(
    (document) => document.uri.toString() === fixtureUri.toString()
  );
  assert.equal(
    sourceDocument?.isDirty ?? false,
    false,
    "Source document must remain clean"
  );

  const configuration = vscode.workspace.getConfiguration(
    "yamlReader",
    fixtureUri
  );
  assert.equal(configuration.get("defaultExpandDepth"), 1);
  assert.equal(configuration.get("rememberExpansion"), true);

  await vscode.commands.executeCommand("workbench.action.closeActiveEditor");

  await vscode.commands.executeCommand(OPEN_WORKBENCH_COMMAND, fixtureUri);
  const workbenchTab = await waitForCustomEditor(WORKBENCH_VIEW_TYPE);
  assert.equal(
    workbenchTab.input instanceof vscode.TabInputCustom,
    true,
    "Active tab must be the YAML Workbench custom editor"
  );
  if (workbenchTab.input instanceof vscode.TabInputCustom) {
    assert.equal(workbenchTab.input.viewType, WORKBENCH_VIEW_TYPE);
    assert.equal(workbenchTab.input.uri.toString(), fixtureUri.toString());
  }
  const workbenchOpenBytes = await vscode.workspace.fs.readFile(fixtureUri);
  assert.deepEqual([...workbenchOpenBytes], [...before], "Opening Workbench must not write source bytes");
  await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
}

async function waitForCustomEditor(expectedViewType = VIEW_TYPE): Promise<vscode.Tab> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < WAIT_TIMEOUT_MS) {
    const activeTab = vscode.window.tabGroups.activeTabGroup.activeTab;
    if (
      activeTab?.input instanceof vscode.TabInputCustom &&
      activeTab.input.viewType === expectedViewType
    ) {
      return activeTab;
    }
    await delay(100);
  }
  throw new Error("Timed out waiting for YAML Reader custom editor");
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}
