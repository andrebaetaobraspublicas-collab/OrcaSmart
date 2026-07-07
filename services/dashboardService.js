const repo = require('../repositories/dashboardRepository');

async function stats(db) {
  return repo.stats(db);
}

module.exports = { stats };
