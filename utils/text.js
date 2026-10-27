function removeDiacritics(input) {
  return String(input || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D');
}

function toKeyword(input) {
  return removeDiacritics(input).toLowerCase();
}

function buildPostKeyword({ postMessage } = {}) {
  return toKeyword(postMessage || '');
}

module.exports = {
  removeDiacritics,
  toKeyword,
  buildPostKeyword,
};
