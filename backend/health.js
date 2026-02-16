// Handles all health check logic for the backend
const { getPool } = require('./db');

async function getHealthStatus(logger) {
  const status = {
    api: 'up',
    apiVersion: process.env.npm_package_version || '1.0.0',
    db: 'down',
    dbVersion: null,
  };

  try {
    const { rows } = await getPool().query('SELECT version()');
    status.db = 'up';
    status.dbVersion = rows[0]?.version ?? null;
  } catch (error) {
    logger?.error?.('DB health check failed:', error);
  }

  return status;
}

module.exports = { getHealthStatus };
