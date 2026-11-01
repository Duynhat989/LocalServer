function scannedDayBucketExpr(dialect, column = 'scanned_at') {
  if (dialect === 'mysql') {
    return `DATE(FROM_UNIXTIME(FLOOR(${column} / 1000)))`;
  }
  return `date(${column} / 1000, 'unixepoch', 'localtime')`;
}

function scannedMonthBucketExpr(dialect, column = 'scanned_at') {
  if (dialect === 'mysql') {
    return `DATE_FORMAT(FROM_UNIXTIME(FLOOR(${column} / 1000)), '%Y-%m')`;
  }
  return `strftime('%Y-%m', ${column} / 1000, 'unixepoch', 'localtime')`;
}

function phoneFirstScanDaySubquery(dialect) {
  const bucket = scannedDayBucketExpr(dialect, 'MIN(scanned_at)');
  return `SELECT TRIM(phone) AS phone, ${bucket} AS bucket
     FROM posts
     WHERE scanned_at IS NOT NULL
       AND phone IS NOT NULL
       AND TRIM(phone) != ''
     GROUP BY TRIM(phone)`;
}

function phoneFirstScanMonthSubquery(dialect) {
  const bucket = scannedMonthBucketExpr(dialect, 'MIN(scanned_at)');
  return `SELECT TRIM(phone) AS phone, ${bucket} AS bucket
     FROM posts
     WHERE scanned_at IS NOT NULL
       AND phone IS NOT NULL
       AND TRIM(phone) != ''
     GROUP BY TRIM(phone)`;
}

module.exports = {
  scannedDayBucketExpr,
  scannedMonthBucketExpr,
  phoneFirstScanDaySubquery,
  phoneFirstScanMonthSubquery,
};
