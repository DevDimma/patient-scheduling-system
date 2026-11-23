const mysql = require('mysql2/promise');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const dbHost = process.env.DB_HOST || 'localhost';
const isRemoteDb = dbHost !== 'localhost' && dbHost !== '127.0.0.1';

const pool = mysql.createPool({
  host: dbHost,
  port: parseInt(process.env.DB_PORT, 10) || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'hospital_management',
  ssl: isRemoteDb ? { rejectUnauthorized: false } : undefined,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  dateStrings: true // Return date and datetime as strings to avoid timezone shift
});

// Test connection helper
async function testConnection() {
  try {
    const connection = await pool.getConnection();
    connection.release();
    return { connected: true, message: 'Connected to MySQL successfully' };
  } catch (error) {
    return { connected: false, message: error.message };
  }
}

module.exports = {
  pool,
  testConnection
};