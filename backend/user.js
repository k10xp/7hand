// user.js - Handles user creation and management

const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcrypt');
const { getPool } = require('./db');
const { validateUsername, validateDisplayName } = require('./profanity-filter');

class User {
  constructor(data) {
    this.id = data.id || uuidv4();
    this.username = data.username;
    this.displayName = data.displayName || data.username;
    this.email = data.email || null;

    // Password data: plain text only on creation/update; hash for storage
    this.password = data.password || null;
    this.passwordHash = data.passwordHash || null;

    this.lobbyId = data.lobbyId || null;
    const now = new Date();

    this.createdAt = data.createdAt || now;
    this.updatedAt = data.updatedAt || now;
    this.lastActive = data.lastActive || now;

    this.coins = data.coins ?? 0;
    this.stats = data.stats || {
      gamesPlayed: 0,
      gamesWon: 0,
      gamesLost: 0,
    };
  }

  /**
   * Validates user data
   * @returns {Object} { valid: boolean, errors: string[] }
   */
  validate() {
    const errors = [];

    // Username validation
    if (!this.username || typeof this.username !== 'string') {
      errors.push('Username is required and must be a string');
    } else if (this.username.length < 3 || this.username.length > 20) {
      errors.push('Username must be between 3 and 20 characters');
    } else if (!/^[a-zA-Z0-9_-]+$/.test(this.username)) {
      errors.push('Username can only contain letters, numbers, hyphens, and underscores');
    } else {
      const profanityCheck = validateUsername(this.username);
      if (!profanityCheck.valid) errors.push(profanityCheck.error);
    }

    // Display name validation
    if (this.displayName) {
      if (this.displayName.length > 30) {
        errors.push('Display name must be 30 characters or less');
      } else {
        const profanityCheck = validateDisplayName(this.displayName);
        if (!profanityCheck.valid) errors.push(profanityCheck.error);
      }
    }

    // Email validation (safe regex)
    if (this.email && !/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(this.email)) {
      errors.push('Invalid email format');
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * Updates the last active timestamp
   */
  updateActivity() {
    const now = new Date();
    this.lastActive = now;
    this.updatedAt = now;
  }

  /**
   * Updates user stats
   * @param {Object} stats - Stats to update
   */
  updateStats(stats) {
    this.stats = { ...this.stats, ...stats };
    this.updatedAt = new Date();
  }

  /**
   * Hashes the password
   * @returns {Promise<void>}
   */
  async hashPassword() {
    if (this.password) {
      this.passwordHash = await bcrypt.hash(this.password, 10);
      this.password = null;
    }
  }

  /**
   * Verifies password against stored hash
   * @param {string} password - Plain text password to verify
   * @returns {Promise<boolean>}
   */
  async verifyPassword(password) {
    if (!this.passwordHash) return false;
    return bcrypt.compare(password, this.passwordHash);
  }

  /**
   * Converts user to a safe object (removes sensitive data)
   * @returns {Object}
   */
  toSafeObject() {
    return {
      id: this.id,
      username: this.username,
      displayName: this.displayName,
      coins: this.coins,
      stats: this.stats,
      createdAt: this.createdAt,
      lastActive: this.lastActive,
    };
  }
}

class UserManager {
  constructor() {
    this.users = new Map();
  }

  /**
   * Creates a new user
   * @param {Object} userData - User data
   * @returns {User}
   */
  createUser(userData) {
    const user = new User(userData);
    const { valid, errors } = user.validate();

    if (!valid) throw new Error(`User validation failed: ${errors.join(', ')}`);

    this.users.set(user.id, user);
    return user;
  }

  /**
   * Gets a user by ID
   * @param {string} userId
   * @returns {User|undefined}
   */
  getUser(userId) {
    return this.users.get(userId);
  }

  /**
   * Gets a user by username
   * @param {string} username
   * @returns {User|undefined}
   */
  getUserByUsername(username) {
    return [...this.users.values()].find((user) => user.username === username);
  }

  /**
   * Updates a user
   * @param {string} userId
   * @param {Object} updates
   * @returns {User|null}
   */
  updateUser(userId, updates) {
    const user = this.users.get(userId);
    if (!user) return null;

    const allowedFields = ['displayName', 'email', 'stats', 'coins'];
    for (const key of allowedFields) {
      if (updates[key] !== undefined) {
        key === 'stats' ? user.updateStats(updates.stats) : (user[key] = updates[key]);
      }
    }

    user.updatedAt = new Date();

    const { valid, errors } = user.validate();
    if (!valid) throw new Error(`User validation failed: ${errors.join(', ')}`);

    return user;
  }

  /**
   * Removes a user
   * @param {string} userId
   */
  removeUser(userId) {
    this.users.delete(userId);
  }
}

/**
 * Saves a user to the database
 * @param {User} user
 */
async function saveUserToDb(user) {
  const pool = getPool();
  const now = new Date();

  if (user.password) await user.hashPassword();

  await pool.query(
    `INSERT INTO users (id, username, display_name, email, created_at, updated_at, last_active, coins, stats, password_hash)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (id) DO UPDATE SET
       username = EXCLUDED.username,
       display_name = EXCLUDED.display_name,
       email = EXCLUDED.email,
       updated_at = EXCLUDED.updated_at,
       last_active = EXCLUDED.last_active,
       coins = EXCLUDED.coins,
       stats = EXCLUDED.stats,
       password_hash = EXCLUDED.password_hash`,
    [
      user.id,
      user.username,
      user.displayName,
      user.email,
      user.createdAt || now,
      user.updatedAt || now,
      user.lastActive || now,
      user.coins,
      JSON.stringify(user.stats),
      user.passwordHash,
    ]
  );
}

/**
 * Removes a user from the database
 * @param {string} userId
 */
async function removeUserFromDb(userId) {
  const pool = getPool();
  await pool.query('DELETE FROM users WHERE id = $1', [userId]);
}

/**
 * Loads a user from the database
 * @param {string} userId
 * @returns {Object|null}
 */
async function loadUserFromDb(userId) {
  const pool = getPool();
  const result = await pool.query('SELECT * FROM users WHERE id = $1', [userId]);
  return result.rows[0] || null;
}

/**
 * Loads a user by username from the database
 * @param {string} username
 * @returns {Object|null}
 */
async function loadUserByUsernameFromDb(username) {
  const pool = getPool();
  const result = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
  return result.rows[0] || null;
}

/**
 * Loads all users from the database
 * @returns {Array}
 */
async function loadAllUsersFromDb() {
  const pool = getPool();
  const result = await pool.query('SELECT * FROM users ORDER BY created_at DESC');
  return result.rows;
}

/**
 * Updates user activity timestamp
 * @param {string} userId
 */
async function updateUserActivity(userId) {
  const pool = getPool();
  const now = new Date();
  await pool.query('UPDATE users SET last_active = $1, updated_at = $1 WHERE id = $2', [
    now,
    userId,
  ]);
}

module.exports = {
  User,
  UserManager,
  saveUserToDb,
  removeUserFromDb,
  loadUserFromDb,
  loadUserByUsernameFromDb,
  loadAllUsersFromDb,
  updateUserActivity,
};
