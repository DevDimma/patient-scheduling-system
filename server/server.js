const express = require('express');
const cors = require('cors');
const path = require('path');
const { testConnection } = require('./config/db');

// Load environment variables
require('dotenv').config({ path: path.join(__dirname, '.env') });

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve frontend static files
app.use(express.static(path.join(__dirname, '..', 'public')));

// Health check endpoint
app.get('/api/health', async (req, res) => {
  const dbStatus = await testConnection();
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    database: {
      engine: 'MySQL',
      connected: dbStatus.connected,
      message: dbStatus.message
    }
  });
});

// API Routes
app.use('/api/doctors', require('./routes/doctors'));
app.use('/api/patients', require('./routes/patients'));
app.use('/api/appointments', require('./routes/appointments'));
app.use('/api/stats', require('./routes/stats'));

// SPA Fallback: send index.html for any unhandled non-API routes
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api')) {
    return next();
  }
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// Start Server
app.listen(PORT, async () => {
  console.log(`====================================================`);
  console.log(` Hospital Management System Server running on:`);
  console.log(` http://localhost:${PORT}`);
  console.log(`====================================================`);

  const dbStatus = await testConnection();
  if (dbStatus.connected) {
    console.log(` MySQL Database: CONNECTED (${process.env.DB_NAME || 'hospital_management'})`);
  } else {
    console.warn(`⚠️ MySQL Connection Warning: ${dbStatus.message}`);
    console.warn(` Ensure your local MySQL server is started and credentials in server/.env are set.`);
  }
});
