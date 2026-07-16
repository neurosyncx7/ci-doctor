class SearchSession {
  constructor() {
    this.latestResult = null;
  }

  async search(query, fetchResults) {
    const result = await fetchResults(query);
    this.latestResult = result;
    return result;
  }
}

module.exports = { SearchSession };

