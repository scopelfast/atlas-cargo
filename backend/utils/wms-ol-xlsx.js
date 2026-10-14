'use strict';

const XLSX = require('xlsx');

function parseOlXlsxBuffer(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const sheet = wb.SheetNames.includes('Exportar Planilha') ? 'Exportar Planilha' : wb.SheetNames[0];
  return XLSX.utils.sheet_to_json(wb.Sheets[sheet], { defval: '' });
}

module.exports = { parseOlXlsxBuffer };
