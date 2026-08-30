# Production operations contracts

`src/application/production-ops.ts` contains framework-neutral hooks for the production boundary:

- `trustedRateLimitIdentity` keys authenticated traffic only by the verified session subject. Unauthenticated traffic uses the transport peer; `X-Forwarded-For` is considered only when the caller has explicitly established a trusted proxy boundary.
- `FixedWindowLimiter` is a shared limiter interface with injectable storage, clock, and decision telemetry. The default store is process-local and is **not** production infrastructure evidence; deployments must provide a shared store.
- `assertAuditRetentionPolicy` and `assertStructuredAuditEvent` define explicit retention, immutability, redaction-version, identity, and outcome contracts. They do not claim archival durability.
- `productionObservabilityConfig` exposes explicit metrics, tracing, alerting, and service-name hooks from environment configuration. Enabling a flag does not prove a collector or alert route exists.

`npm run validate:api-parity` fail-closes if the OpenAPI version diverges from `package.json`, operation IDs are duplicated, or the REST document has no operations. SDK/MCP adapters remain thin and must call the same REST/application boundary.
