import { AqlQuery } from 'arangojs/aql';
import { Expr, From, LimitStatement, nil, OrderByStatement, parse, SelectedColumn } from 'pgsql-ast-parser';

interface AqlContext {
  docRef: string;
  collectMap?: Record<string, string>;
  bindVars: Record<string, any>;
  bindIndex: number;
}

const functionMap: Record<string, string> = {
  count: 'COUNT',
  countDistinct: 'COUNT_DISTINCT',
  min: 'MIN',
  max: 'MAX',
  sum: 'SUM',
  avg: 'AVG'
};

const operatorMap: Record<string, string> = {
  '=': '==',
  ILIKE: 'LIKE',
  'NOT ILIKE': 'NOT LIKE'
};

const indentMap: Record<number, string> = {};

export function indent(level: number, size = 2) {
  if (indentMap[level] === undefined) {
    indentMap[level] = ' '.repeat(level * size);
  }

  return indentMap[level];
}

export function isNumeric(val: any): boolean {
  // // See also: https://github.com/angular/angular/blob/c1052cf7a77e0bf2a4ec14f9dd5abc92034cfd2e/packages/common/src/pipes/number_pipe.ts#L289C7-L289C77
  // typeof value === 'string' && !isNaN(Number(value) - parseFloat(value))
  return !(val instanceof Array) && (val - parseFloat(val) + 1) >= 0;
}

export function capitalizeFirstLetter(string: string): string {
  return string ? string[0].toUpperCase() + string.slice(1) : '';
}

export function hasCalculatedColumns(columns: SelectedColumn[]): boolean {
  for (const col of columns) {
    if (col.expr.type === 'call') {
      return true;
    }
  }

  return false;
}

/**
 * Registers a value as an AQL bind parameter and returns the placeholder that
 * references it (e.g. `@p0`). Binding values instead of interpolating them into
 * the query string prevents AQL injection through user-provided data.
 */
function addBindVar(ctx: AqlContext, value: unknown): string {
  const key = `p${ctx.bindIndex}`;
  ctx.bindIndex += 1;
  ctx.bindVars[key] = value;

  return `@${key}`;
}

export function mapFromStatment(fromAst: From[], ctx: AqlContext) {
  if (fromAst.length !== 1) {
    throw new Error(`Invalid from ast! ${fromAst.length} statement(s)`);
  }

  return `FOR ${ctx.docRef} IN ${(fromAst[0] as any).name.name}`;
}

function mapOpStat(expr: Expr, params: unknown[], ctx: AqlContext, deep = 0): string {
  switch (expr.type) {
    case 'ref': {
      return `${ctx.docRef}.${expr.name}`;
    }

    case 'parameter': {
      if (expr.name[0] === '$') {
        // SQL positional parameter, e.g. {"type":"parameter","name":"$1"}
        // Remove leading $, convert to numeric (+), adjust to zero-based index (-1).
        const position = +expr.name.substring(1) - 1;
        const value: any = params[position];

        if (isNumeric(value)) {
          return addBindVar(ctx, +value);
        }

        return addBindVar(ctx, value);
      } else {
        throw Error(`Unsupported parameter ${JSON.stringify(params)}`);
      }
    }

    case 'boolean':
    case 'integer':
    case 'numeric':
    case 'string':
      return addBindVar(ctx, expr.value);

    case 'unary': {
      // Extract operand value by recursive call to current function.
      const operand = mapOpStat(expr.operand, params, ctx);

      switch (expr.op) {
        case 'IS NULL':
          return `${operand} == null`;
        case 'IS NOT NULL':
          return `${operand} != null`;
        default:
          throw Error(`Unsupported operator ${expr.op}!`);
      }
    }

    case 'binary': {
      // Extract operator value with substitution.
      const op = operatorMap[expr.op] || expr.op;
      // Extract operands' values by recursive call to current function.
      const lhs = mapOpStat(expr.left, params, ctx);
      const rhs = mapOpStat(expr.right, params, ctx);

      if (op === '||') {
        // lhs or rhs is a wildcard literal ('%') to append for searching with LIKE.
        return `CONCAT(${lhs}, ${rhs})`;
      }

      return deep > 0 ? `(${lhs} ${op} ${rhs})` : `${lhs} ${op} ${rhs}`;
    }

    default:
      throw Error(`Unsupported where expr type ${expr.type}!`);
  }
}

export function mapWhereStatement(whereAst: Expr, params: unknown[], ctx: AqlContext): string {
  const filterStr = mapOpStat(whereAst, params, ctx);

  if (filterStr) {
    return `FILTER ${filterStr}`;
  }

  throw Error(`Unsupported filter string ${JSON.stringify(whereAst)}`);
}

function columnName(col: SelectedColumn): string {
  const name = col.alias?.name ?? (col.expr as any).name;

  if (!name) {
    throw Error(`Unable to resolve column name for expr type ${col.expr.type}!`);
  }

  return name;
}

export function mapGroupByStatement(groupByAsts: Expr[] | nil, columns: SelectedColumn[], ctx: AqlContext) {
  const collectArr: string[] = [];
  ctx.collectMap = {};

  if (groupByAsts) {
    // Transpile GROUP BY SQL columns to COLLECT and RETURN AQL columns. RETURN columns are passed via collectMap.
    for (const groupByAst of groupByAsts) {
      switch (groupByAst.type) {
        case 'integer': {
          const groupCol = columns[groupByAst.value - 1];
          const alias = columnName(groupCol);
          const collectEl = `${alias} = ${ctx.docRef}.${(groupCol.expr as any).name}`;
          ctx.collectMap[alias] = collectEl;
          collectArr.push(collectEl);
          break;
        }

        default:
          throw Error(`Unsupported groupBy expr type ${groupByAst.type}!`);
      }
    }
  }

  // Return one of the following:
  // - COLLECT followed by columns if there are GROUP BY in SQL.
  // - COLLECT statement if there are only calculated columns for further representation by AGGREGATE AQL.
  return `COLLECT ${collectArr.join(',')}`;
}

export function mapAggrStatement(columns: SelectedColumn[], ctx: AqlContext) {
  const aggArr: string[] = [];

  for (const col of columns) {
    if (col.expr.type === 'call') {
      const aqlFunc = functionMap[col.expr.function.name + capitalizeFirstLetter(col.expr.distinct as string)];
      if (aqlFunc) {
        const alias = columnName(col);
        const aggrEl = `${alias} = ${aqlFunc}(${col.expr.args.map((expr) => `${ctx.docRef}.${(expr as any).name}`).join(',')})`;
        if (ctx.collectMap) {
          ctx.collectMap[alias] = aggrEl;
        }
        aggArr.push(aggrEl);
      } else {
        throw Error(`AQL mapping is missing for SQL function ${col.expr.function.name}`);
      }
    }
  }

  if (aggArr.length) {
    return `AGGREGATE ${aggArr.join(',')}`;
  }

  return undefined;
}

export function mapOrderByStatement(orderByAsts: OrderByStatement[], columns: SelectedColumn[], _ctx: AqlContext) {
  const orderByArr: string[] = [];

  for (const orderByAst of orderByAsts) {
    switch (orderByAst.by.type) {
      case 'integer': {
        const orderCol = columns[orderByAst.by.value - 1];
        const orderByEl = `${columnName(orderCol)} ${orderByAst.order || 'ASC'}`;
        orderByArr.push(orderByEl);
        break;
      }

      default:
        throw Error(`Unsupported orderBy by type ${orderByAst.by.type}!`);
    }
  }

  return `SORT ${orderByArr.join(',')}`;
}

export function mapLimitStatement(limitAst: LimitStatement) {
  let limitStr = '';
  let offsetStr = '';

  if (limitAst.limit) {
    switch (limitAst.limit.type) {
      case 'integer':
        limitStr = `${limitAst.limit.value}`;
        break;

      default:
        throw Error(`Unsupported limit type ${limitAst.limit.type}!`);
    }
  }

  if (limitAst.offset) {
    switch (limitAst.offset.type) {
      case 'integer':
        offsetStr = `${limitAst.offset.value}`;
        break;

      default:
        throw Error(`Unsupported offset type ${limitAst.offset.type}!`);
    }
  }

  // AQL LIMIT accepts either `LIMIT count` or `LIMIT offset, count`.
  return offsetStr ? `LIMIT ${offsetStr},${limitStr}` : `LIMIT ${limitStr}`;
}

export function mapProjectStatement(columns: SelectedColumn[], ctx: AqlContext) {
  if (columns.length === 1 && columns[0].expr.type === 'ref' && columns[0].expr.name === '*') {
    return `RETURN ${ctx.docRef}`;
  }

  const returnArr: string[] = [];

  for (const col of columns) {
    if (ctx.collectMap && col.alias && ctx.collectMap[col.alias.name]) {
      returnArr.push(`${col.alias.name}`);
    } else {
      switch (col.expr.type) {
        case 'ref': {
          const name = col.alias?.name ?? col.expr.name;
          returnArr.push(`${name}:${ctx.docRef}.${col.expr.name}`);
          break;
        }
        case 'call':
          // Handled in COLLECT and AGGREGATE AQL transpilers of mapGroupByStatement() and mapAggrStatement().
          break;
        default:
          throw Error(`Unsupported projection expr type ${col.expr.type}!`);
      }
    }
  }

  return `RETURN {${returnArr.join(',')}}`;
}

export function sql2aql(sql: string, params: unknown[] = []): AqlQuery {
  const ast = parse(sql);
  const firstAst = ast[0];
  const ctx: AqlContext = { docRef: 'doc', bindVars: {}, bindIndex: 0 };
  let query = '';

  if (firstAst.type === 'select') {
    query = `${mapFromStatment(firstAst.from as From[], ctx)}\n`;

    if (firstAst.where) {
      const filterStr = mapWhereStatement(firstAst.where, params, ctx);

      if (filterStr) {
        query += `${indent(1)}${filterStr}\n`;
      }
    }

    if (firstAst.groupBy || hasCalculatedColumns(firstAst.columns as SelectedColumn[])) {
      query += `${indent(1)}${mapGroupByStatement(firstAst.groupBy, firstAst.columns as SelectedColumn[], ctx)}\n`;

      const aggrStr = mapAggrStatement(firstAst.columns as SelectedColumn[], ctx);

      if (aggrStr) {
        query += `${indent(1)}${aggrStr}\n`;
      }
    }

    if (firstAst.orderBy) {
      query += `${indent(1)}${mapOrderByStatement(firstAst.orderBy, firstAst.columns as SelectedColumn[], ctx)}\n`;
    }

    if (firstAst.limit) {
      query += `${indent(1)}${mapLimitStatement(firstAst.limit)}\n`;
    }

    query += `${indent(1)}${mapProjectStatement(firstAst.columns as SelectedColumn[], ctx)}`;
  }

  return { query, bindVars: ctx.bindVars };
}
