const express = require('express');
const router = express.Router();
const { pool, testConnection } = require('../config/db');
const { getLagosDateString } = require('../utils/timezone');

router.get('/dashboard', async (req, res) => {
  try {
    const dbStatus = await testConnection();
    if (!dbStatus.connected) {
      return res.json({
        success: false,
        db_connected: false,
        error: 'Database connection is currently unavailable.',
        counts: { total_scheduled: 0, total_patients: 0, total_doctors: 0, today_scheduled: 0 },
        visit_flow: [],
        specialty_distribution: []
      });
    }

    // Today's date YYYY-MM-DD in Lagos timezone
    const today = getLagosDateString();

    // Counts
    const [[{ total_scheduled }]] = await pool.query(
      `SELECT COUNT(*) AS total_scheduled FROM appointments WHERE status NOT IN ('Cancelled', 'No-Show')`
    );

    const [[{ today_scheduled }]] = await pool.query(
      `SELECT COUNT(*) AS today_scheduled FROM appointments WHERE appointment_date = ? AND status NOT IN ('Cancelled', 'No-Show')`,
      [today]
    );

    const [[{ total_patients }]] = await pool.query(`SELECT COUNT(*) AS total_patients FROM patients`);
    const [[{ total_doctors }]] = await pool.query(`SELECT COUNT(*) AS total_doctors FROM doctors WHERE is_active = TRUE`);

    // Status breakdown for Visit Flow
    const [statusBreakdown] = await pool.query(`
      SELECT status, COUNT(*) AS count 
      FROM appointments 
      GROUP BY status
    `);

    // Dynamic appointments count by doctor's specialty
    const [specialtyCounts] = await pool.query(`
      SELECT 
        d.specialty,
        COUNT(a.appointment_id) AS appointment_count,
        COUNT(DISTINCT d.doctor_id) AS doctor_count
      FROM doctors d
      LEFT JOIN appointments a ON d.doctor_id = a.doctor_id AND a.status NOT IN ('Cancelled')
      WHERE d.is_active = TRUE
      GROUP BY d.specialty
      ORDER BY appointment_count DESC, d.specialty ASC
    `);

    res.json({
      success: true,
      db_connected: true,
      engine: 'MySQL',
      database: process.env.DB_NAME || 'hospital_management',
      lagos_date: today,
      counts: {
        total_scheduled,
        today_scheduled,
        total_patients,
        total_doctors
      },
      visit_flow: statusBreakdown,
      specialty_distribution: specialtyCounts.map(s => ({
        specialty: s.specialty,
        count: Number(s.appointment_count) || 0,
        doctor_count: Number(s.doctor_count) || 0
      }))
    });
  } catch (error) {
    console.error('Error fetching dashboard stats:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch dashboard statistics. Please try again.' });
  }
});

module.exports = router;
