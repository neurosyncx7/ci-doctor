function pageCount(totalItems, pageSize) {
  if (totalItems === 0) {
    return 0;
  }

  return Math.floor((totalItems - 1) / pageSize);
}

module.exports = { pageCount };

