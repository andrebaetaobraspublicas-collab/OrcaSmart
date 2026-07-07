const repo = require('../repositories/adminRepository');

async function listUsers(master) {
  return repo.listUsers(master);
}

module.exports = { listUsers };
