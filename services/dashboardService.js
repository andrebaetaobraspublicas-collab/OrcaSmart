const repo = require('../repositories/dashboardRepository');

async function stats(db, options = {}) {
  return repo.stats(db, options);
}

module.exports = { stats };
