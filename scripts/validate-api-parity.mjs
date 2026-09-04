#!/usr/bin/env node
// API parity: the OpenAPI spec must cover every served route, and every spec
// operation must carry a unique operationId. Version must match package.json.
// This is a coverage gate, not just a shape check: an undocumented route fails.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const failures = [];

// 1. Version match
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const openapi = fs.readFileSync(path.join(root, "docs/api/openapi.yaml"), "utf8");
const versionMatch = openapi.match(/^  version:\s*([^\s#]+)/m);
if (!versionMatch) failures.push("OpenAPI info.version is missing");
else if (versionMatch[1] !== pkg.version) {
  failures.push(`REST/OpenAPI version mismatch: package=${pkg.version} openapi=${versionMatch[1]}`);
}

// 2. operationId uniqueness + presence on every operation
const operationIds = [...openapi.matchAll(/^      operationId:\s*([^\s#]+)/gm)].map((m) => m[1]);
if (operationIds.length === 0) failures.push("OpenAPI has no operationIds");
if (new Set(operationIds).size !== operationIds.length) {
  failures.push("OpenAPI operationId values must be unique");
}
const operationsWithoutId = [...openapi.matchAll(/^    (get|post|put|patch|delete):\s*$/gm)].length - operationIds.length;
if (operationsWithoutId > 0) {
  failures.push(`${operationsWithoutId} operation(s) missing operationId`);
}

// 3. Every served route.ts must have a spec path (Next.js [param] -> {param})
const apiDir = path.join(root, "src/app/api/v1");
const routeFiles = [];
(function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.name === "route.ts") routeFiles.push(full);
  }
})(apiDir);
const specPaths = new Set(
  [...openapi.matchAll(/^  (\/v1\/[^:]+):\s*$/gm)].map((m) => m[1].replace(/\{([^}]+)\}/g, "[$1]")),
);
for (const file of routeFiles.sort()) {
  const rel = path.relative(apiDir, path.dirname(file)); // e.g. gifts/[claimId]
  const specForm = `/v1/${rel}`;
  if (!specPaths.has(specForm)) failures.push(`served route lacks spec entry: ${specForm} (${path.relative(root, file)})`);
}

// 4. Every spec path must map to a served route (no vaporware in the contract)
for (const spec of [...specPaths].sort()) {
  const dirForm = spec.replace(/\[([^/[\]]+)\]/g, "[$1]");
  const exists = routeFiles.some((f) => `/v1/${path.relative(apiDir, path.dirname(f))}` === dirForm);
  if (!exists) failures.push(`spec path has no served route: ${spec}`);
}

if (failures.length > 0) {
  console.error(`API parity FAILED (${failures.length}):\n- ${failures.join("\n- ")}`);
  process.exit(1);
}
console.log(
  `API parity passed: version=${pkg.version}, routes=${routeFiles.length}, specPaths=${specPaths.size}, operationIds=${operationIds.length}`,
);
