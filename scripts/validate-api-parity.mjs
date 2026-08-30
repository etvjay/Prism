#!/usr/bin/env node
import fs from "node:fs";
const pkg = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const openapi = fs.readFileSync(new URL("../docs/api/openapi.yaml", import.meta.url), "utf8");
const match = openapi.match(/^  version:\s*([^\s#]+)/m);
if (!match) throw new Error("OpenAPI info.version is missing");
if (match[1] !== pkg.version) throw new Error(`REST/OpenAPI version mismatch: package=${pkg.version} openapi=${match[1]}`);
const operationIds = [...openapi.matchAll(/^      operationId:\s*([^\s#]+)/gm)].map((m) => m[1]);
if (new Set(operationIds).size !== operationIds.length) throw new Error("OpenAPI operationId values must be unique");
if (operationIds.length === 0) throw new Error("OpenAPI has no operationIds");
console.log(`API parity validation passed: version=${pkg.version}, operationIds=${operationIds.length}`);
