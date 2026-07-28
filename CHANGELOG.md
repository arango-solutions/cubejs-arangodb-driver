# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - 2026-07-28

This release realigns the driver with the modern Cube 1.x line and the current
arangojs 10 client, and hardens the SQL-to-AQL transpiler.

### Added

- `ArangoDbDriver.dialectClass()` returning Cube's `PostgresQuery` dialect, so
  Cube can generate SQL that the driver transpiles to AQL. Without this hook
  Cube could not build queries for `CUBEJS_DB_TYPE=arangodb`.
- Overrides for `getSchemas`, `getTablesForSpecificSchemas`,
  `getColumnsForSpecificTables` and `getTablesQuery` backed by ArangoDB
  collection metadata (the `BaseDriver` defaults emit `information_schema` SQL,
  which cannot be transpiled to AQL).
- A real testcontainers-based integration suite (`npm run test:integration`)
  that boots `arangodb/arangodb:3.12`, seeds fixtures and exercises the driver.
- A compose-based end-to-end suite (`npm run test:e2e`) that runs a full
  `cubejs/cube` server against ArangoDB and asserts against the Cube REST API
  (`/readyz`, `/cubejs-api/v1/meta`, `/cubejs-api/v1/load`).
- `CHANGELOG.md`.

### Changed

- **Breaking:** minimum Node.js version is now `>=20` (matching the Node 22
  runtime of the `cubejs/cube:v1.4.4` image and arangojs 10's `engines`).
- Upgraded `@cubejs-backend/base-driver` from `^0.33.41` to `^1.4.4`.
- Upgraded `arangojs` from `^8.4.0` to `^10.3.1`.
- Upgraded `pgsql-ast-parser` from `^11.1.0` to `^12.0.2`.
- Upgraded the toolchain: TypeScript `~5.9.3`, Jest `^30`, ts-jest `^29.4`,
  testcontainers `^12`, rimraf `^6`, `@cubejs-backend/linter` `^1.4.4`.
- **Breaking:** `sql2aql` now returns an arangojs `AqlQuery`
  (`{ query, bindVars }`) instead of a plain string. Values are passed as bind
  parameters rather than interpolated into the query text.
- Docker: `docker/Dockerfile` and `docker-compose.yml` now target
  `cubejs/cube:v1.4.4` and `arangodb/arangodb:3.12`; the driver version is a
  build `ARG`.
- CI: workflows updated to Node 20/22, `actions/*@v4`, split unit/integration/e2e
  jobs, npm publish provenance and multi-arch Docker builds.
- Re-enabled TypeScript `strict` mode for the driver sources.

### Fixed

- **Security:** the SQL-to-AQL transpiler no longer interpolates string values
  directly into the AQL query, preventing AQL injection through user-provided
  filter values. Values (and the collection name used for schema introspection)
  are now passed as bind parameters.
- `downloadQueryResults` no longer throws on boolean columns. The previous
  mapping keyed booleans as `bool`, but values are classified with JavaScript
  `typeof` (which yields `boolean`), so every boolean column raised
  `Unable to translate type ...`.
- `downloadQueryResults` no longer throws on an empty result set (it previously
  dereferenced `rows[0]`).
- `tableColumnTypes` now sorts columns by name (the previous `Array#sort()` on
  objects was a no-op).
- `mapLimitStatement` now honours SQL `OFFSET` (emitting `LIMIT offset, count`)
  instead of silently dropping it.
- `GROUP BY`/`ORDER BY` transpilation no longer crashes when a selected column
  has no explicit alias.

### Migration

- **Node.js:** ensure your runtime is Node 20 or newer.
- **arangojs imports:** if you imported arangojs internals, note the v10 module
  renames — `Config` from `arangojs/connection` is now `ConfigOptions` from
  `arangojs/configuration`, and `arangojs/collection` is now
  `arangojs/collections`.
- **`sql2aql` consumers:** the function now returns `{ query, bindVars }`. Pass
  the whole object to `db.query(...)` instead of the previous string.
- **Dialect peer dependency:** `@cubejs-backend/schema-compiler` is an optional
  peer dependency used only by `dialectClass()`. In the official Cube image it
  is already present at `/cube/node_modules`, so no action is needed there.
- **`CUBEJS_DB_TYPE`:** community drivers must be selected via the
  `CUBEJS_DB_TYPE=arangodb` environment variable. Cube's config-file `dbType`
  validation only accepts built-in database types.

## [0.1.0]

- Initial ArangoDB driver: PostgreSQL-to-AQL transpilation via
  `pgsql-ast-parser`, targeting Cube 0.33.

[0.2.0]: https://github.com/panoti/cubejs-arangodb-driver/releases/tag/v0.2.0
