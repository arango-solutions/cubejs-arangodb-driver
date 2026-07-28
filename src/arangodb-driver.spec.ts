import { ArangoDbDriver } from './arangodb-driver';

describe('ArangoDbDriver (unit)', () => {
  const createDriver = () => new ArangoDbDriver({ url: 'http://localhost:8529', databaseName: 'test' });

  it('exposes a Postgres-compatible dialect class', () => {
    const dialect = ArangoDbDriver.dialectClass();
    expect(dialect).toBeDefined();
    expect(dialect.name).toBe('PostgresQuery');
  });

  it('reports read-only', () => {
    expect(createDriver().readOnly()).toBe(true);
  });

  describe('toGenericType', () => {
    const driver = createDriver();

    it('maps ArangoDB TYPENAME values to generic types', () => {
      expect(driver.toGenericType('bool')).toBe('boolean');
      expect(driver.toGenericType('number')).toBe('double');
      expect(driver.toGenericType('string')).toBe('text');
    });

    it('is case-insensitive', () => {
      expect(driver.toGenericType('BOOL')).toBe('boolean');
    });

    it('falls through to the base mapping for unknown types', () => {
      expect(typeof driver.toGenericType('varchar')).toBe('string');
    });
  });

  describe('downloadQueryResults', () => {
    it('maps boolean columns (regression: typeof === "boolean")', async () => {
      const driver = createDriver();
      jest.spyOn(driver, 'query').mockResolvedValue([
        { name: 'Alice', active: true, score: 42 },
      ]);

      const { rows, types } = await driver.downloadQueryResults('SELECT * FROM "Customer"', [], {} as any);

      expect(rows).toHaveLength(1);
      expect(types).toEqual([
        { name: 'name', type: 'text' },
        { name: 'active', type: 'boolean' },
        { name: 'score', type: 'double' },
      ]);
    });

    it('handles an empty result set without throwing', async () => {
      const driver = createDriver();
      jest.spyOn(driver, 'query').mockResolvedValue([]);

      const { rows, types } = await driver.downloadQueryResults('SELECT * FROM "Customer"', [], {} as any);

      expect(rows).toEqual([]);
      expect(types).toEqual([]);
    });

    it('throws for untranslatable column types', async () => {
      const driver = createDriver();
      jest.spyOn(driver, 'query').mockResolvedValue([{ payload: { nested: true } }]);

      await expect(
        driver.downloadQueryResults('SELECT * FROM "Customer"', [], {} as any)
      ).rejects.toThrow(/Unable to translate type/);
    });
  });

  describe('queryColumnTypes', () => {
    it('infers types from the first row', async () => {
      const driver = createDriver();
      jest.spyOn(driver, 'query').mockResolvedValue([{ id: 'x', qty: 3, active: false }]);

      const types = await driver.queryColumnTypes('SELECT * FROM "Order"', []);

      expect(types).toEqual([
        { name: 'id', type: 'text' },
        { name: 'qty', type: 'double' },
        { name: 'active', type: 'boolean' },
      ]);
    });

    it('returns an empty array for empty results', async () => {
      const driver = createDriver();
      jest.spyOn(driver, 'query').mockResolvedValue([]);

      expect(await driver.queryColumnTypes('SELECT * FROM "Order"', [])).toEqual([]);
    });
  });

  describe('getSchemas', () => {
    it('returns the configured database as the only schema', async () => {
      const driver = createDriver();
      expect(await driver.getSchemas()).toEqual([{ schema_name: 'test' }]);
    });
  });
});
