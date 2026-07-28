import { Database } from 'arangojs';
import { GenericContainer, StartedTestContainer, Wait } from 'testcontainers';
import { ArangoDbDriver } from '../../src';

const ARANGODB_VERSION = process.env.TEST_ARANGODB_VERSION || '3.12';
const ROOT_PASSWORD = 'dev';

describe('ArangoDbDriver (integration)', () => {
  let container: StartedTestContainer;
  let driver: ArangoDbDriver;

  beforeAll(async () => {
    container = await new GenericContainer(`arangodb/arangodb:${ARANGODB_VERSION}`)
      .withEnvironment({ ARANGO_ROOT_PASSWORD: ROOT_PASSWORD })
      .withExposedPorts(8529)
      // ArangoDB returns 401 on /_api/version without auth, so an HTTP wait
      // strategy is unreliable; wait for the readiness log line instead.
      .withWaitStrategy(Wait.forLogMessage(/is ready for business/i))
      .withStartupTimeout(120000)
      .start();

    const url = `http://${container.getHost()}:${container.getMappedPort(8529)}`;

    // Seed fixtures using arangojs directly.
    const seedDb = new Database({
      url,
      databaseName: '_system',
      auth: { username: 'root', password: ROOT_PASSWORD },
    });

    const customer = await seedDb.createCollection('Customer');
    await customer.saveAll([
      { code: 'C1', name: 'Alice', countryOfDestination: 'US', active: true },
      { code: 'C2', name: 'Bob', countryOfDestination: 'US', active: false },
      { code: 'C3', name: 'Carol', countryOfDestination: 'UK', active: true },
    ]);

    const order = await seedDb.createCollection('Order');
    await order.saveAll([
      { amount: 50, status: 'open', active: true },
      { amount: 150, status: 'closed', active: false },
      { amount: 2500, status: 'open', active: true },
    ]);

    seedDb.close();

    driver = new ArangoDbDriver({
      url,
      databaseName: '_system',
      auth: { username: 'root', password: ROOT_PASSWORD },
    });
  });

  afterAll(async () => {
    if (driver) {
      await driver.release();
    }
    if (container) {
      await container.stop();
    }
  });

  it('is read-only', () => {
    expect(driver.readOnly()).toBe(true);
  });

  it('connects to the database', async () => {
    await expect(driver.testConnection()).resolves.toBeUndefined();
  });

  it('runs a query with a positional parameter', async () => {
    const rows = await driver.query<{ amount: number }>('SELECT * FROM "Order" WHERE amount > $1', [100]);

    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.amount > 100)).toBe(true);
  });

  it('binds string values safely', async () => {
    const rows = await driver.query<{ name: string }>('SELECT * FROM "Customer" WHERE name = $1', ['Alice']);

    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('Alice');
  });

  it('lists document collections and their columns via tablesSchema', async () => {
    const schema = await driver.tablesSchema();

    expect(Object.keys(schema)).toContain('_system');
    expect(Object.keys(schema._system).sort()).toEqual(['Customer', 'Order']);
    const customerColumns = schema._system.Customer.map((c) => c.name);
    expect(customerColumns).toContain('name');
    expect(customerColumns).toContain('code');
  });

  it('returns column types for a collection', async () => {
    const columns = await driver.tableColumnTypes('Order');
    const byName = Object.fromEntries(columns.map((c) => [c.name, c.type]));

    expect(byName.amount).toBe('number');
    expect(byName.active).toBe('bool');
  });

  it('downloads query results with inferred types including booleans', async () => {
    const { rows, types } = await driver.downloadQueryResults('SELECT * FROM "Order"', [], {} as any);

    expect(rows.length).toBe(3);
    const byName = Object.fromEntries(types.map((t) => [t.name, t.type]));
    expect(byName.amount).toBe('double');
    expect(byName.active).toBe('boolean');
    expect(byName.status).toBe('text');
  });

  it('downloads an empty result set without throwing', async () => {
    const { rows, types } = await driver.downloadQueryResults(
      'SELECT * FROM "Order" WHERE amount > $1',
      [999999],
      {} as any
    );

    expect(rows).toEqual([]);
    expect(types).toEqual([]);
  });

  it('reports the configured database as the only schema', async () => {
    expect(await driver.getSchemas()).toEqual([{ schema_name: '_system' }]);
  });

  it('lists tables for the configured schema', async () => {
    const tables = await driver.getTablesForSpecificSchemas([{ schema_name: '_system' }]);
    const names = tables.map((t) => t.table_name).sort();

    expect(names).toEqual(['Customer', 'Order']);
  });
});
