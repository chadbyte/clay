import { z } from 'zod';
import { Catalog, createFunctionImplementation } from '@a2ui/web_core';
import { basicCatalog } from '@a2ui/web_core/catalogs/basic/v1';
import { catalogId, componentNames } from './contract.mjs';
function fn(name, shape, execute, type) {
  var resolved = z.object(shape).strict();
  var dynamic = {};
  Object.keys(shape).forEach(function (key) { dynamic[key] = z.any(); });
  return createFunctionImplementation({ name: name, returnType: type || 'string', allowedCallers: 'rendererOnly', schema: z.object(dynamic).strict() }, function (args) { return execute(resolved.parse(args)); });
}
function scalar(value) { return value === null || value === undefined ? '' : String(value); }
var functions = [
  fn('lookup', { table: z.record(z.any()), keys: z.array(z.union([z.string(), z.number(), z.boolean()])).max(8), fallback: z.any().optional() }, function (args) {
    var key = args.keys.map(scalar).join('|');
    return Object.prototype.hasOwnProperty.call(args.table, key) ? args.table[key] : (args.fallback === undefined ? '' : args.fallback);
  }, 'any'),
  fn('choose', { condition: z.boolean(), yes: z.any(), no: z.any() }, function (args) { return args.condition ? args.yes : args.no; }, 'any'),
  fn('join', { values: z.array(z.union([z.string(), z.number(), z.boolean()])).max(30), separator: z.string().max(100).optional() }, function (args) { return args.values.map(scalar).join(args.separator || ''); }),
  fn('calculate', { operation: z.enum(['add', 'subtract', 'multiply', 'divide', 'min', 'max']), values: z.array(z.number().finite()).min(1).max(30) }, function (args) {
    var values = args.values;
    var result = values.slice(1).reduce(function (a, b) {
      switch (args.operation) {
        case 'add': return a + b;
        case 'subtract': return a - b;
        case 'multiply': return a * b;
        case 'divide': return b === 0 ? NaN : a / b;
        case 'min': return Math.min(a, b);
        case 'max': return Math.max(a, b);
      }
    }, values[0]);
    if (!Number.isFinite(result)) throw new Error('Calculation has no finite result.');
    return result;
  }, 'number'),
  fn('number', { value: z.number().finite(), digits: z.number().int().min(0).max(6).optional(), currency: z.string().regex(/^[A-Z]{3}$/).optional() }, function (args) {
    var options = { maximumFractionDigits: args.digits === undefined ? 2 : args.digits };
    if (args.currency) { options.style = 'currency'; options.currency = args.currency; }
    return new Intl.NumberFormat('en', options).format(args.value);
  }),
];
export var explorationCatalog = new Catalog(catalogId, '1.0', componentNames.map(function (name) { return basicCatalog.components.get(name); }), functions);
