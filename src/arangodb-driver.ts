import {
  BaseDriver,
  DatabaseStructure,
  DownloadQueryResultsOptions,
  DownloadQueryResultsResult,
  QueryColumnsResult,
  QueryOptions,
  QuerySchemasResult,
  QueryTablesResult,
  Row,
  TableColumn,
  TableQueryResult,
  TableStructure,
} from '@cubejs-backend/base-driver';
import { Database } from 'arangojs';
import { CollectionType } from 'arangojs/collections';
import { ConfigOptions } from 'arangojs/configuration';
import { sql2aql } from './sql-utils';

/**
 * Maps ArangoDB `TYPENAME()` results (AQL vocabulary) to Cube generic types.
 */
const ArangoToGenericType: Record<string, string> = {
  number: 'double',
  string: 'text',
  bool: 'boolean',
};

/**
 * Maps JavaScript `typeof` results to Cube generic types. Used when inferring
 * column types from actual query result values.
 */
const JsTypeToGenericType: Record<string, string> = {
  number: 'double',
  string: 'text',
  boolean: 'boolean',
  bigint: 'bigint',
};

const sortByKeys = <T extends Record<string, unknown>>(unordered: T): T => {
  const ordered = {} as T;

  (Object.keys(unordered) as (keyof T)[]).sort().forEach((key) => {
    ordered[key] = unordered[key];
  });

  return ordered;
};

export type ArangoDbDriverConfig = Partial<ConfigOptions> & {
  /**
   * Time to wait for a response from a connection after validation
   * request before determining it as not valid. Default - 60000 ms.
   */
  testConnectionTimeout?: number,
};

export class ArangoDbDriver extends BaseDriver {
  /**
   * Returns default concurrency value.
   * @return {number}
   */
  public static getDefaultConcurrency(): number {
    return 2;
  }

  /**
   * Cube resolves the SQL dialect for a driver via `dialectClass()`. This
   * driver transpiles PostgreSQL to AQL, so it reuses Cube's Postgres dialect.
   * Loaded lazily so `@cubejs-backend/schema-compiler` stays an optional peer.
   */
  public static dialectClass() {
    // eslint-disable-next-line global-require, import/no-extraneous-dependencies
    const { PostgresQuery } = require('@cubejs-backend/schema-compiler');
    return PostgresQuery;
  }

  public static driverEnvVariables() {
    return [
      'CUBEJS_DB_URL',
    ];
  }

  private config: ArangoDbDriverConfig;

  private databaseName: string;

  private client: Database;

  public constructor(config: ArangoDbDriverConfig = {}) {
    super({
      testConnectionTimeout: config.testConnectionTimeout || 60000,
    });

    const auth = {
      username: process.env.CUBEJS_DB_USER || 'root',
      password: process.env.CUBEJS_DB_PASS || '',
    };

    this.config = {
      url: process.env.CUBEJS_DB_URL,
      databaseName: process.env.CUBEJS_DB_NAME,
      auth,
      ...config,
    };

    this.databaseName = this.config.databaseName || '_system';

    this.client = new Database({
      url: this.config.url,
      databaseName: this.databaseName,
      auth: this.config.auth,
    });
  }

  public async testConnection(): Promise<void> {
    const cursor = await this.client.query({
      query: 'RETURN @value',
      bindVars: { value: Date.now() },
    });

    await cursor.next();
    await cursor.kill();
  }

  public async query<R = unknown>(query: string, values?: unknown[], _options?: QueryOptions): Promise<R[]> {
    const aqlQuery = sql2aql(query, values);
    const cursor = await this.client.query<R>(aqlQuery);
    const result = await cursor.all();

    await cursor.kill();

    return result;
  }

  public async downloadQueryResults(
    query: string,
    values: unknown[],
    _options: DownloadQueryResultsOptions
  ): Promise<DownloadQueryResultsResult> {
    const rows = await this.query<Row>(query, values);
    const columnTypes: TableStructure = [];

    if (rows.length > 0) {
      Object.entries(rows[0]).forEach(([column, value]) => {
        const type = typeof value;
        const genericType = JsTypeToGenericType[type];

        if (!genericType) {
          throw new Error(`Unable to translate type for column "${column}" with type: ${type}`);
        }

        columnTypes.push({ name: column, type: genericType });
      });
    }

    return {
      rows,
      types: columnTypes,
    };
  }

  public async release(): Promise<void> {
    await this.client.close();
  }

  public readOnly(): boolean {
    // ArangoDb don't support table creation
    return true;
  }

  public async tablesSchema(): Promise<DatabaseStructure> {
    const result: DatabaseStructure = {};
    const collections = await this.client.listCollections();

    let schema: Record<string, TableColumn[]> = result[this.databaseName] || {};

    for (const collection of collections) {
      if (collection.type === CollectionType.DOCUMENT_COLLECTION) {
        schema[collection.name] = await this.tableColumnTypes(collection.name);
      }
    }

    schema = sortByKeys(schema);
    result[this.databaseName] = schema;

    return result;
  }

  public async tableColumnTypes(table: string): Promise<TableStructure> {
    const columns: TableStructure = [];
    // TODO: can optimize by schema registry or swagger json schema
    const attrMap = await this.aggrAttrs(table);
    const attrNames = Object.keys(attrMap);

    for (const attrName of attrNames) {
      const attrType = attrMap[attrName];

      if (this.toGenericType(attrType)) {
        columns.push({ name: attrName, type: attrType, attributes: [] });
      }
    }

    return columns.sort((a, b) => a.name.localeCompare(b.name));
  }

  public async getSchemas(): Promise<QuerySchemasResult[]> {
    return [{ schema_name: this.databaseName }];
  }

  public async getTablesForSpecificSchemas(schemas: QuerySchemasResult[]): Promise<QueryTablesResult[]> {
    const schemaNames = new Set(schemas.map((s) => s.schema_name));

    if (!schemaNames.has(this.databaseName)) {
      return [];
    }

    const collections = await this.client.listCollections();

    return collections
      .filter((collection) => collection.type === CollectionType.DOCUMENT_COLLECTION)
      .map((collection) => ({
        schema_name: this.databaseName,
        table_name: collection.name,
      }));
  }

  public async getColumnsForSpecificTables(tables: QueryTablesResult[]): Promise<QueryColumnsResult[]> {
    const result: QueryColumnsResult[] = [];

    for (const table of tables) {
      const columns = await this.tableColumnTypes(table.table_name);

      for (const column of columns) {
        result.push({
          schema_name: table.schema_name,
          table_name: table.table_name,
          column_name: column.name,
          data_type: column.type,
        });
      }
    }

    return result;
  }

  public async getTablesQuery(schemaName: string): Promise<TableQueryResult[]> {
    if (schemaName !== this.databaseName) {
      return [];
    }

    const collections = await this.client.listCollections();

    return collections
      .filter((collection) => collection.type === CollectionType.DOCUMENT_COLLECTION)
      .map((collection) => ({ table_name: collection.name }));
  }

  public async queryColumnTypes(sql: string, params: unknown[]): Promise<{ name: any; type: string }[]> {
    const rows = await this.query<Row>(sql, params);

    if (rows.length === 0) {
      return [];
    }

    return Object.entries(rows[0]).map(([column, value]) => {
      const genericType = JsTypeToGenericType[typeof value] || 'text';

      return { name: column, type: genericType };
    });
  }

  public toGenericType(columnType: string): string {
    const normalized = columnType.toLowerCase();

    if (normalized in ArangoToGenericType) {
      return ArangoToGenericType[normalized];
    }

    return super.toGenericType(normalized);
  }

  private async aggrAttrs(collectionName: string): Promise<Record<string, string>> {
    const cursor = await this.client.query<Record<string, string>>({
      query: `
FOR i IN [1]
  LET attrMaps = (
    FOR doc IN @@collection
      LET attributes = (
        FOR name IN ATTRIBUTES(doc, true)
          RETURN {
            name: name,
            type: TYPENAME(doc[name])
          }
      )
      RETURN ZIP(attributes[*].name, attributes[*].type)
  )
  RETURN MERGE(attrMaps)`,
      bindVars: { '@collection': collectionName },
    });
    let result: Record<string, string> = { id: 'string' };

    if (cursor.hasNext) {
      result = {
        ...result,
        ...await cursor.next(),
      };
    }

    await cursor.kill();
    return result;
  }
}
