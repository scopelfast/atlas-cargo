'use strict';

/** @param {unknown} err */
function isMissingColumnError(err) {
  const msg = err && err.message ? String(err.message) : '';
  const num = err && err.number != null ? Number(err.number) : 0;
  return (
    !!err &&
    (err.code === '42P01' ||
      err.code === '42703' ||
      num === 207 ||
      /Invalid column name/i.test(msg) ||
      /column .* does not exist/i.test(msg))
  );
}

module.exports = { isMissingColumnError };
