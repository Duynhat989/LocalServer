const { getModels } = require('../models');

const DAY_MS = 24 * 60 * 60 * 1000;
const DAY_WINDOW = 14;
const MONTH_WINDOW = 6;

function pad(value) {
  return String(value).padStart(2, '0');
}

function dayKey(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function monthKey(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
}

function dayLabel(key) {
  const [, month, day] = String(key).split('-');
  return `${day}/${month}`;
}

function monthLabel(key) {
  const [year, month] = String(key).split('-');
  return `${month}/${year}`;
}

function rowsToMap(rows, valueKey) {
  const map = new Map();
  for (const row of rows) {
    const key = String(row.bucket || '');
    if (!key) continue;
    map.set(key, Number(row[valueKey]) || 0);
  }
  return map;
}

async function queryBuckets(sequelize, sql) {
  const rows = await sequelize.query(sql, { type: sequelize.QueryTypes.SELECT });
  return rows;
}

async function homeStats(_req, res, next) {
  try {
    const { sequelize } = getModels();
    const dayExpr = `date(scanned_at / 1000, 'unixepoch', 'localtime')`;
    const monthExpr = `strftime('%Y-%m', scanned_at / 1000, 'unixepoch', 'localtime')`;

    const [postDays, phoneDays, groupDays, postMonths, phoneMonths, groupMonths] =
      await Promise.all([
        queryBuckets(
          sequelize,
          `SELECT ${dayExpr} AS bucket, COUNT(*) AS posts
           FROM posts
           WHERE scanned_at IS NOT NULL
           GROUP BY bucket`
        ),
        queryBuckets(
          sequelize,
          `SELECT bucket, COUNT(*) AS phones
           FROM (
             SELECT TRIM(phone) AS phone, date(MIN(scanned_at) / 1000, 'unixepoch', 'localtime') AS bucket
             FROM posts
             WHERE scanned_at IS NOT NULL
               AND phone IS NOT NULL
               AND TRIM(phone) != ''
             GROUP BY TRIM(phone)
           )
           GROUP BY bucket`
        ),
        queryBuckets(
          sequelize,
          `SELECT ${dayExpr} AS bucket, COUNT(*) AS groups
           FROM groups
           WHERE scanned_at IS NOT NULL
           GROUP BY bucket`
        ),
        queryBuckets(
          sequelize,
          `SELECT ${monthExpr} AS bucket, COUNT(*) AS posts
           FROM posts
           WHERE scanned_at IS NOT NULL
           GROUP BY bucket`
        ),
        queryBuckets(
          sequelize,
          `SELECT bucket, COUNT(*) AS phones
           FROM (
             SELECT TRIM(phone) AS phone, strftime('%Y-%m', MIN(scanned_at) / 1000, 'unixepoch', 'localtime') AS bucket
             FROM posts
             WHERE scanned_at IS NOT NULL
               AND phone IS NOT NULL
               AND TRIM(phone) != ''
             GROUP BY TRIM(phone)
           )
           GROUP BY bucket`
        ),
        queryBuckets(
          sequelize,
          `SELECT ${monthExpr} AS bucket, COUNT(*) AS groups
           FROM groups
           WHERE scanned_at IS NOT NULL
           GROUP BY bucket`
        ),
      ]);

    const postDayMap = rowsToMap(postDays, 'posts');
    const phoneDayMap = rowsToMap(phoneDays, 'phones');
    const groupDayMap = rowsToMap(groupDays, 'groups');
    const postMonthMap = rowsToMap(postMonths, 'posts');
    const phoneMonthMap = rowsToMap(phoneMonths, 'phones');
    const groupMonthMap = rowsToMap(groupMonths, 'groups');

    const now = new Date();
    const today = dayKey(now);
    const thisMonth = monthKey(now);

    const days = [];
    for (let i = DAY_WINDOW - 1; i >= 0; i -= 1) {
      const date = new Date(now.getTime() - i * DAY_MS);
      const key = dayKey(date);
      days.push({
        key,
        label: dayLabel(key),
        posts: postDayMap.get(key) || 0,
        phones: phoneDayMap.get(key) || 0,
        groups: groupDayMap.get(key) || 0,
      });
    }

    const months = [];
    for (let i = MONTH_WINDOW - 1; i >= 0; i -= 1) {
      const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = monthKey(date);
      months.push({
        key,
        label: monthLabel(key),
        posts: postMonthMap.get(key) || 0,
        phones: phoneMonthMap.get(key) || 0,
        groups: groupMonthMap.get(key) || 0,
      });
    }

    const todayRow = days[days.length - 1] || { posts: 0, phones: 0, groups: 0 };
    const monthRow = months[months.length - 1] || { posts: 0, phones: 0, groups: 0 };

    res.json({
      ok: true,
      today: {
        key: today,
        label: dayLabel(today),
        posts: todayRow.posts,
        phones: todayRow.phones,
        groups: todayRow.groups,
      },
      month: {
        key: thisMonth,
        label: monthLabel(thisMonth),
        posts: monthRow.posts,
        phones: monthRow.phones,
        groups: monthRow.groups,
      },
      days,
      months,
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  homeStats,
};
