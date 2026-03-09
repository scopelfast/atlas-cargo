// Compatibilidade: o backend usa PostgreSQL (pg). Código que chama
// pool.request().input('x', sql.Decimal(15,0), value) ignora o tipo;
// este módulo evita require('mssql') e mantém as chamadas .input() funcionando.
module.exports = {
  Decimal: function () { return null; },
  Float: function () { return null; },
  Int: function () { return null; },
  SmallInt: function () { return null; },
  DateTime2: function () { return null; },
  Bit: function () { return null; },
  Char: function () { return null; },
  VarChar: function () { return null; },
  NVarChar: function () { return null; },
  VarBinary: function () { return null; },
  MAX: 2147483647,
};
