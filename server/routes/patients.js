const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');

// 1. GET /api/patients - Search or list patients
router.get('/', async (req, res) => {
  try {
    const { q, limit = 50 } = req.query;
    let query = `
      SELECT patient_id, patient_code, first_name, last_name, phone, email, date_of_birth, gender, address, emergency_contact, created_at 
      FROM patients
    `;
    const params = [];

    if (q && q.trim()) {
      const searchTerm = `%${q.trim()}%`;
      query += ` WHERE patient_code LIKE ? OR first_name LIKE ? OR last_name LIKE ? OR phone LIKE ? OR email LIKE ?`;
      params.push(searchTerm, searchTerm, searchTerm, searchTerm, searchTerm);
    }

    query += ` ORDER BY patient_id DESC LIMIT ?`;
    params.push(parseInt(limit, 10));

    const [patients] = await pool.query(query, params);
    res.json({ success: true, count: patients.length, data: patients });
  } catch (error) {
    console.error('Error fetching patients:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch patients list. Please try again.' });
  }
});

// 2. GET /api/patients/:id - Get single patient by ID
router.get('/:id', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT patient_id, patient_code, first_name, last_name, phone, email, date_of_birth, gender, address, emergency_contact, created_at 
       FROM patients 
       WHERE patient_id = ?`,
      [req.params.id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Patient not found' });
    }

    res.json({ success: true, data: rows[0] });
  } catch (error) {
    console.error('Error fetching patient:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch patient details. Please try again.' });
  }
});

// 3. POST /api/patients - Register a new patient
router.post('/', async (req, res) => {
  try {
    const {
      first_name,
      last_name,
      phone,
      email,
      date_of_birth,
      gender,
      address,
      emergency_contact
    } = req.body;

    // Strict validation: every single field required
    const missing = [];
    if (!first_name || !first_name.trim()) missing.push('First Name');
    if (!last_name || !last_name.trim()) missing.push('Last Name');
    if (!phone || !phone.trim()) missing.push('Phone Number');
    if (!email || !email.trim()) missing.push('Email Address');
    if (!date_of_birth || !String(date_of_birth).trim()) missing.push('Date of Birth');
    if (!gender || !gender.trim()) missing.push('Gender');
    if (!address || !address.trim()) missing.push('Residential Address');
    if (!emergency_contact || !emergency_contact.trim()) missing.push('Emergency Contact');

    if (missing.length > 0) {
      return res.status(400).json({
        success: false,
        error: `All registration fields are strictly required. Missing: ${missing.join(', ')}.`
      });
    }

    // Insert first to obtain patient_id
    const [result] = await pool.query(
      `INSERT INTO patients (first_name, last_name, phone, email, date_of_birth, gender, address, emergency_contact) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        first_name.trim(),
        last_name.trim(),
        phone.trim(),
        email.trim(),
        date_of_birth,
        gender.trim(),
        address.trim(),
        emergency_contact.trim()
      ]
    );

    const newPatientId = result.insertId;
    const patientCode = `PT-${String(newPatientId).padStart(4, '0')}`;

    // Update with auto-generated sequential patient_code
    await pool.query('UPDATE patients SET patient_code = ? WHERE patient_id = ?', [patientCode, newPatientId]);

    const [createdRows] = await pool.query(
      `SELECT * FROM patients WHERE patient_id = ?`,
      [newPatientId]
    );

    res.status(201).json({
      success: true,
      message: `Patient ${createdRows[0].first_name} ${createdRows[0].last_name} registered successfully with ID ${patientCode}`,
      data: createdRows[0]
    });
  } catch (error) {
    console.error('Error creating patient:', error);
    res.status(500).json({ success: false, error: 'Failed to register patient. Please try again.' });
  }
});

// 4. PUT /api/patients/:id - Update patient details
router.put('/:id', async (req, res) => {
  try {
    const {
      first_name,
      last_name,
      phone,
      email,
      date_of_birth,
      gender,
      address,
      emergency_contact
    } = req.body;

    const missing = [];
    if (!first_name || !first_name.trim()) missing.push('First Name');
    if (!last_name || !last_name.trim()) missing.push('Last Name');
    if (!phone || !phone.trim()) missing.push('Phone Number');
    if (!email || !email.trim()) missing.push('Email Address');
    if (!date_of_birth || !String(date_of_birth).trim()) missing.push('Date of Birth');
    if (!gender || !gender.trim()) missing.push('Gender');
    if (!address || !address.trim()) missing.push('Residential Address');
    if (!emergency_contact || !emergency_contact.trim()) missing.push('Emergency Contact');

    if (missing.length > 0) {
      return res.status(400).json({
        success: false,
        error: `All fields are required to update patient profile. Missing: ${missing.join(', ')}.`
      });
    }

    const [existingPatient] = await pool.query(
      'SELECT patient_id, patient_code FROM patients WHERE patient_id = ?',
      [req.params.id]
    );

    if (existingPatient.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Patient not found'
      });
    }

    let code = existingPatient[0].patient_code;
    if (!code) {
      code = `PT-${String(req.params.id).padStart(4, '0')}`;
    }

    await pool.query(
      `UPDATE patients SET
        patient_code = ?,
        first_name = ?,
        last_name = ?,
        phone = ?,
        email = ?,
        date_of_birth = ?,
        gender = ?,
        address = ?,
        emergency_contact = ?
      WHERE patient_id = ?`,
      [
        code,
        first_name.trim(),
        last_name.trim(),
        phone.trim(),
        email.trim(),
        date_of_birth,
        gender.trim(),
        address.trim(),
        emergency_contact.trim(),
        req.params.id
      ]
    );

    const [updatedPatient] = await pool.query(
      'SELECT * FROM patients WHERE patient_id = ?',
      [req.params.id]
    );

    res.json({
      success: true,
      message: 'Patient details updated successfully',
      data: updatedPatient[0]
    });

  } catch (error) {
    console.error('Error updating patient:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update patient details. Please try again.'
    });
  }
});

module.exports = router;
