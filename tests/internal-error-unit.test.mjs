import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import ts from "typescript";

const sourcePath = "src/index.ts";
const tempDir = ".tmp-test";
const tempFile = `${tempDir}/index.mjs`;

function assertNoExtraKeys(value, expected) {
  assert.deepEqual(Object.keys(value).sort(), [...expected].sort());
}

function assertErrorResult(result, expectedKeys) {
  assert.equal(result.isError, true);
  assertNoExtraKeys(result.structuredContent, expectedKeys);
  assert.equal(result.structuredContent.status, "error");
  assert.equal(result.structuredContent.errors.length, 1);
  assertNoExtraKeys(result.structuredContent.errors[0], ["code", "message", "field"]);
  assert.equal(result.structuredContent.errors[0].code, "internal_error");
  assert.equal(result.structuredContent.errors[0].field, "");
  assert.equal(typeof result.structuredContent.errors[0].message, "string");
  assert.ok(result.structuredContent.errors[0].message.length > 0);
  assert.doesNotMatch(JSON.stringify(result.structuredContent), /stack|src\\|src\/|index\.ts|Error:|sensitive internal detail|private|incident-worker/i);
}

await mkdir(tempDir, { recursive: true });
const source = (await readFile(sourcePath, "utf8")).replace(
  /import .* from "\.\/pages\/.*\.html";\n/g,
  ""
);
const transpiled = ts.transpileModule(source, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ES2022
  }
}).outputText;

await writeFile(tempFile, transpiled);
const module = await import(`../${tempFile}?cacheBust=${Date.now()}`);

function throwingOperation() {
  throw new Error("sensitive internal detail C:\\private\\incident-worker\\src\\index.ts /private/incident-worker/src/index.ts");
}

for (const [toolName, expectedKeys] of [
  ["extract_incident_timeline", ["status", "events", "impact_statements", "source_label", "errors"]],
  ["extract_postmortem_actions", ["status", "actions", "source_label", "errors"]],
  ["check_postmortem_completeness", ["status", "is_complete", "checked_items", "present_items", "missing_items", "source_label", "errors"]]
]) {
  let operationExecuted = false;
  const result = module.executeWithInternalErrorBoundary(toolName, () => {
    operationExecuted = true;
    return throwingOperation();
  });
  assert.equal(operationExecuted, true);
  assertErrorResult(result, expectedKeys);
}

await rm(tempDir, { recursive: true, force: true });

console.log("Internal Error Unit Cases: 3");
console.log("Passed Cases: 3");
console.log("Failed Cases: 0");
