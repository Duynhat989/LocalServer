const { literal } = require('sequelize');
const { toKeyword } = require('./text');

function ftsPhrase(needle) {
  return `"${String(needle).replace(/"/g, '""')}"`;
}

function escapeMysqlBooleanToken(token) {
  return String(token).replace(/[+\-><()~*"@]+/g, ' ').trim();
}

function mysqlBooleanMatch(needles) {
  const parts = [];
  for (const needle of needles) {
    const norm = escapeMysqlBooleanToken(needle);
    if (!norm) continue;
    const words = norm.split(/\s+/).filter(Boolean);
    if (words.length > 1) {
      parts.push(`+"${words.join(' ')}"`);
    } else {
      parts.push(`+${words[0]}`);
    }
  }
  return parts.join(' ');
}

function keywordContainsSubstr(sequelize, needle) {
  return `INSTR(IFNULL(keyword, ''), ${sequelize.escape(needle)}) > 0`;
}

function keywordExcludesSubstr(sequelize, needle) {
  return `INSTR(IFNULL(keyword, ''), ${sequelize.escape(needle)}) = 0`;
}

/**
 * @param {'fulltext'|'substr'} keywordMatch — substr tránh lỗi FTS cache khi từ quá rộng
 */
function keywordPathsWhere(paths, sequelize, keywordMatch = 'fulltext') {
  const dialect = sequelize.getDialect();
  const useSubstr = dialect === 'mysql' && keywordMatch === 'substr';
  const groups = [];

  for (const path of paths) {
    const include = Array.isArray(path) ? path : path.include || [];
    const exclude = Array.isArray(path) ? [] : path.exclude || [];
    const phrases = [];
    const scans = [];

    for (const keyword of include) {
      const needle = toKeyword(keyword);
      if (!needle) continue;
      if (needle.length >= 3) phrases.push(needle);
      else scans.push(keywordContainsSubstr(sequelize, needle));
    }

    const and = [];

    if (phrases.length) {
      if (useSubstr) {
        for (const needle of phrases) {
          and.push(keywordContainsSubstr(sequelize, needle));
        }
      } else if (dialect === 'mysql') {
        const against = mysqlBooleanMatch(phrases);
        and.push(`MATCH(keyword) AGAINST(${sequelize.escape(against)} IN BOOLEAN MODE)`);
      } else {
        const ftsParts = phrases.map((n) => ftsPhrase(n));
        const match = ftsParts.length === 1 ? ftsParts[0] : `(${ftsParts.join(' AND ')})`;
        and.push(
          `id IN (SELECT rowid FROM post_keyword_fts WHERE post_keyword_fts MATCH ${sequelize.escape(match)})`
        );
      }
    }

    and.push(...scans);

    for (const keyword of exclude) {
      const needle = toKeyword(keyword);
      if (!needle) continue;
      // MySQL: loại trừ bằng INSTR — NOT MATCH dễ vượt innodb_ft_result_cache_limit
      if (dialect === 'mysql' || needle.length < 3) {
        and.push(keywordExcludesSubstr(sequelize, needle));
      } else {
        and.push(
          `id NOT IN (SELECT rowid FROM post_keyword_fts WHERE post_keyword_fts MATCH ${sequelize.escape(ftsPhrase(needle))})`
        );
      }
    }

    if (and.length) groups.push(and.length === 1 ? and[0] : `(${and.join(' AND ')})`);
  }

  if (!groups.length) return null;
  return literal(groups.join(' OR '));
}

function isFtsResultCacheError(err) {
  const parent = err?.parent || err?.original || err;
  return (
    parent?.errno === 188 ||
    parent?.code === 'HA_ERR_FTS_EXCEED_RESULT_CACHE_LIMIT' ||
    /FTS query exceeds result cache limit/i.test(String(parent?.message || err?.message || ''))
  );
}

function parseDateOnly(value) {
  const raw = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  return raw;
}

/**
 * Chọn FULLTEXT vs INSTR trước khi query — bộ lọc có exclude/OR thường nhanh hơn với INSTR
 * khi đã có group_id / ngày / SĐT; không thu hẹp thì tránh MATCH quá rộng.
 */
function resolveKeywordMatch(paths, query = {}, dialect) {
  if (dialect !== 'mysql' || !paths?.length) return 'fulltext';

  const hasGroup = Boolean(String(query.groupId || '').trim());
  const hasDate =
    parseDateOnly(query.pushedFrom || query.from) || parseDateOnly(query.pushedTo || query.to);
  const hasPhone = Boolean(
    String(query.phoneExact || query.phone || '').trim()
  );

  let excludeCount = 0;
  let includeCount = 0;
  for (const path of paths) {
    excludeCount += (path.exclude || []).length;
    includeCount += (path.include || []).length;
  }

  if (excludeCount > 0) return 'substr';
  if (paths.length > 1) return 'substr';

  const narrowed = hasGroup || hasDate || hasPhone;
  if (!narrowed) {
    if (includeCount !== 1) return 'substr';
    const needle = toKeyword((paths[0].include || [])[0] || '');
    if (needle.length <= 5) return 'substr';
  }

  return 'fulltext';
}

module.exports = {
  keywordPathsWhere,
  isFtsResultCacheError,
  resolveKeywordMatch,
};
