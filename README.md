<p align="center"><a href="https://cube.dev"><img src="https://i.imgur.com/zYHXm4o.png" alt="Cube.js" width="300px"></a></p>

[Website](https://cube.dev) • [Docs](https://cube.dev/docs) • [Blog](https://cube.dev/blog) • [Slack](https://slack.cube.dev) • [Discourse](https://forum.cube.dev/) • [Twitter](https://twitter.com/thecubejs)

[![npm version](https://badge.fury.io/js/arangodb-cubejs-driver.svg)](https://badge.fury.io/js/arangodb-cubejs-driver)
[![Test CI](https://github.com/panoti/cubejs-arangodb-driver/actions/workflows/test.yml/badge.svg)](https://github.com/panoti/cubejs-arangodb-driver/actions/workflows/test.yml)

# Cube.js Arango Database Driver

**Project is WIP. We've already used in our production but some Postgresql do not transpile to AQL**
because we don't use all of SQL statements in our product now.

```
npm i --save arangodb-cubejs-driver
```

### Requirements

* Node.js `>=20`
* Cube `1.x` (`@cubejs-backend/base-driver` `^1.4.4`)
* ArangoDB `3.11`+ (tested against `3.12`)
* arangojs `10`

### What's in this repository

* ArangoDB driver in Typescript :heart:. Postgresql parser with [pgsql-ast-parser](https://github.com/oguimbal/pgsql-ast-parser).
* Docker image `ghcr.io/panoti/cube:main`. This is a custom image of `cubejs/cube:v1.4.4` with `arangodb-cubejs-driver` 

### Usage

#### For Docker

Create custom image with `Dockerfile`

```Dockerfile
FROM cubejs/cube:v1.4.4

RUN cd /cube/conf \
    && npm init -y \
    && npm install --no-save arangodb-cubejs-driver
```

Package `arangodb-cubejs-driver` installs into the `/cube/conf/node_modules`
directory, which is on Cube's `NODE_PATH`, so Cube loads the driver
automatically. The minimal `package.json` keeps the driver and its dependencies
isolated from Cube's own `/cube/node_modules`.

**Note**: This driver isn't supported by the front-end, so you can not use the
connection wizard to configure an ArangoDB data source. You must select it with
the `CUBEJS_DB_TYPE=arangodb` **environment variable** — Cube's config-file
`dbType` only accepts built-in database types, so a config-file value will not
resolve a community driver.

```yaml
environment:
  - CUBEJS_DB_URL=http://localhost:8529
  - CUBEJS_DB_NAME=test
  - CUBEJS_DB_USER=test
  - CUBEJS_DB_PASS=test
  - CUBEJS_DB_TYPE=arangodb
```

**ArangoDB attribute names are case-sensitive.** As in PostgreSQL, an unquoted
identifier folds to lowercase, so reference camelCase attributes with quotes in
your cube model, e.g. `sql: '{CUBE}."countryOfDestination"'`.

[Learn more](https://github.com/cube-js/cube.js#getting-started)

**Other community drivers** can find here [@cubejs-driver](https://github.com/search?p=1&q=cubejs-driver&type=Repositories)

### Development

Install dependencies and build:

```
npm ci
npm run build
```

### Testing

The project has three test layers:

```
npm test              # unit tests (SQL-to-AQL transpiler, type mapping)
npm run test:integration  # driver against a real ArangoDB (testcontainers)
npm run test:e2e          # full Cube server + ArangoDB via docker-compose.e2e.yml
npm run test:all          # all of the above
```

The integration and e2e suites require a running Docker daemon. If your Docker
socket is non-standard (for example Rancher Desktop), point testcontainers at
it, e.g. `export DOCKER_HOST="unix://$HOME/.rd/docker.sock"`.

### License

Cube.js Arango driver is [MIT licensed](./LICENSE).
