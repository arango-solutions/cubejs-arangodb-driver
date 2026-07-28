import { capitalizeFirstLetter, isNumeric, sql2aql } from './sql-utils';

const sqls = [
  'SELECT * FROM "Order"',
  "SELECT \"customer\".code \"customer__code\" FROM main.\"Customer\" AS \"customer\" GROUP BY 1 ORDER BY 1 ASC LIMIT 10000",
  "SELECT \"customer\".code \"customer__code\", \"customer\".name \"customer__name\" FROM main.\"Customer\" AS \"customer\" GROUP BY 1, 2 ORDER BY 1 ASC LIMIT 10000",
  "SELECT \"customer\".\"countryOfDestination\" \"customer__country_of_destination\", count(\"customer\".id) \"customer__count\" FROM main.\"Customer\" AS \"customer\" GROUP BY 1 ORDER BY 2 DESC LIMIT 10000",
  `SELECT * FROM "Order" WHERE id = '1'`,
  `SELECT * FROM "Order" WHERE amount > 2000`,
  `SELECT * FROM "Order" WHERE amount > $1`,
  `SELECT * FROM "Order" WHERE id IS NOT NULL`,
  `SELECT * FROM "Order" WHERE id LIKE '%abc%'`,
  `SELECT * FROM "Order" WHERE id LIKE '%' || $1 || '%'`,
];

const aqls = [
  `
FOR doc IN Order
  RETURN doc
`,
  `
FOR doc IN Customer
  COLLECT customer__code = doc.code
  SORT customer__code ASC
  LIMIT 10000
  RETURN {customer__code}
`,
  `
FOR doc IN Customer
  COLLECT customer__code = doc.code,customer__name = doc.name
  SORT customer__code ASC
  LIMIT 10000
  RETURN {customer__code,customer__name}`,
  `
FOR doc IN Customer
  COLLECT customer__country_of_destination = doc.countryOfDestination
  AGGREGATE customer__count = COUNT(doc.id)
  SORT customer__count DESC
  LIMIT 10000
  RETURN {customer__country_of_destination,customer__count}`,
  `
FOR doc IN Order
  FILTER doc.id == @p0
  RETURN doc
`,
  `
FOR doc IN Order
  FILTER doc.amount > @p0
  RETURN doc
`,
  `
FOR doc IN Order
  FILTER doc.amount > @p0
  RETURN doc
`,
  `
FOR doc IN Order
  FILTER doc.id != null
  RETURN doc
`,
  `
FOR doc IN Order
  FILTER doc.id LIKE @p0
  RETURN doc
`,
  `
FOR doc IN Order
  FILTER doc.id LIKE CONCAT(CONCAT(@p0, @p1), @p2)
  RETURN doc
`,
];

const bindVarsList: Record<string, any>[] = [
  {},
  {},
  {},
  {},
  { p0: '1' },
  { p0: 2000 },
  { p0: 2000 },
  {},
  { p0: '%abc%' },
  { p0: '%', p1: 'abc', p2: '%' },
];

describe('sql-untils', () => {
  it('Integer Literals', () => {
    const testCases = [
      { value: '-10', expectation: true },
      { value: '0', expectation: true },
      { value: '5', expectation: true },
      { value: -16, expectation: true },
      { value: 0, expectation: true },
      { value: 32, expectation: true },
      { value: '0o144', expectation: true }, // Octal integer literal string
      { value: 0o144, expectation: true }, // Octal integer literal
      { value: '0xFF', expectation: true }, // Hexadecimal integer literal string
      { value: 0xFFF, expectation: true }, // Hexadecimal integer literal
    ];

    for (const testCase of testCases) {
      expect(isNumeric(testCase.value)).toEqual(testCase.expectation);
    }
  });

  it('Foating-Point Literals', () => {
    const testCases = [
      { value: '-1.6', expectation: true },
      { value: '4.536', expectation: true },
      { value: -2.6, expectation: true },
      { value: 3.1415, expectation: true },
      { value: 8e5, expectation: true },
      { value: '123e-2', expectation: true },
    ];

    for (const testCase of testCases) {
      expect(isNumeric(testCase.value)).toEqual(testCase.expectation);
    }
  });

  it('Non-Numeric values', () => {
    const testCases = [
      { value: '', expectation: false },
      { value: ' ', expectation: false },
      { value: '\t\t', expectation: false },
      { value: 'abcdefghijklm1234567890', expectation: false },
      { value: 'xabcdefx', expectation: false },
      { value: true, expectation: false },
      { value: false, expectation: false },
      { value: 'bcfed5.2', expectation: false },
      { value: '7.2acdgs', expectation: false },
      { value: undefined, expectation: false },
      { value: null, expectation: false },
      { value: NaN, expectation: false },
      { value: Infinity, expectation: false },
      { value: Number.POSITIVE_INFINITY, expectation: false },
      { value: Number.NEGATIVE_INFINITY, expectation: false },
      { value: new Date(2009, 1, 1), expectation: false },
      { value: {}, expectation: false },
      { value: () => undefined, expectation: false },
      { value: [], expectation: false },
      { value: ['-10'], expectation: false },
      { value: ['0'], expectation: false },
      { value: ['5'], expectation: false },
      { value: [-16], expectation: false },
      { value: [0], expectation: false },
      { value: [32], expectation: false },
      { value: [1, 2], expectation: false },
    ];

    for (const testCase of testCases) {
      expect(isNumeric(testCase.value)).toEqual(testCase.expectation);
    }
  });

  it('Test capitalize first letter', () => {
    expect(capitalizeFirstLetter('abcdefghijklm1234567890')).toEqual('Abcdefghijklm1234567890');
    expect(capitalizeFirstLetter('Abcdefghijklm1234567890')).toEqual('Abcdefghijklm1234567890');
    expect(capitalizeFirstLetter('1234567890abcdefghijklm')).toEqual('1234567890abcdefghijklm');
  });

  it(sqls[0], () => {
    const aql = sql2aql(sqls[0]);
    expect(aql.query).toEqual(aqls[0].trim());
    expect(aql.bindVars).toEqual(bindVarsList[0]);
  });

  it(sqls[1], () => {
    const aql = sql2aql(sqls[1]);
    expect(aql.query).toEqual(aqls[1].trim());
    expect(aql.bindVars).toEqual(bindVarsList[1]);
  });

  it(sqls[2], () => {
    const aql = sql2aql(sqls[2]);
    expect(aql.query).toEqual(aqls[2].trim());
    expect(aql.bindVars).toEqual(bindVarsList[2]);
  });

  it(sqls[3], () => {
    const aql = sql2aql(sqls[3]);
    expect(aql.query).toEqual(aqls[3].trim());
    expect(aql.bindVars).toEqual(bindVarsList[3]);
  });

  it(sqls[4], () => {
    const aql = sql2aql(sqls[4]);
    expect(aql.query).toEqual(aqls[4].trim());
    expect(aql.bindVars).toEqual(bindVarsList[4]);
  });

  it(sqls[5], () => {
    const aql = sql2aql(sqls[5]);
    expect(aql.query).toEqual(aqls[5].trim());
    expect(aql.bindVars).toEqual(bindVarsList[5]);
  });

  it(sqls[6], () => {
    const aql = sql2aql(sqls[6], [2000]);
    expect(aql.query).toEqual(aqls[6].trim());
    expect(aql.bindVars).toEqual(bindVarsList[6]);
  });

  it(sqls[7], () => {
    const aql = sql2aql(sqls[7]);
    expect(aql.query).toEqual(aqls[7].trim());
    expect(aql.bindVars).toEqual(bindVarsList[7]);
  });

  it(sqls[8], () => {
    const aql = sql2aql(sqls[8]);
    expect(aql.query).toEqual(aqls[8].trim());
    expect(aql.bindVars).toEqual(bindVarsList[8]);
  });

  it(sqls[9], () => {
    const aql = sql2aql(sqls[9], ['abc']);
    expect(aql.query).toEqual(aqls[9].trim());
    expect(aql.bindVars).toEqual(bindVarsList[9]);
  });

  it('binds string values instead of interpolating them (injection safety)', () => {
    const aql = sql2aql(`SELECT * FROM "Order" WHERE id = $1`, [`x' || REMOVE doc IN Order || '`]);
    expect(aql.query).toEqual(`FOR doc IN Order\n  FILTER doc.id == @p0\n  RETURN doc`);
    expect(aql.bindVars).toEqual({ p0: `x' || REMOVE doc IN Order || '` });
  });

  it('supports LIMIT with OFFSET', () => {
    const aql = sql2aql(`SELECT * FROM "Order" LIMIT 10 OFFSET 5`);
    expect(aql.query).toContain('LIMIT 5,10');
  });
});
