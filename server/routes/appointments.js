const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');
const { getLagosDateString, getLagosCurrentTime } = require('../utils/timezone');

// Helper to format HH:MM:SS to 12-hour AM/PM label
function formatTime12h(timeStr) {
  if (!timeStr) return '';
  const [h, m] = timeStr.split(':').map(Number);
  const period = h >= 12 ? 'PM' : 'AM';
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  const padMin = String(m).padStart(2, '0');
  return `${String(hour12).padStart(2, '0')}:${padMin} ${period}`;
}

// Helper to convert time string to minutes
function timeToMinutes(timeStr) {
  if (!timeStr) return 0;
  const [h, m] = timeStr.split(':').map(Number);
  return h * 60 + (m || 0);
}

// How long a consultation lasts before the visit is completed automatically.
// Change this one number (e.g. to 30) to change the session length.
const CONSULTATION_MINUTES = 45;

// Auto-complete visits once the consultation time has elapsed
async function autoCompleteConsultations() {
  try {
    // COALESCE: patients moved to "In Consultation" before the timer column existed
    // (no start time saved) fall back to their last update time
    const [staleRows] = await pool.query(
      `SELECT appointment_id, status 
       FROM appointments 
       WHERE status = 'In Consultation' 
         AND TIMESTAMPDIFF(MINUTE, COALESCE(consultation_started_at, updated_at), NOW()) >= ?`,
      [CONSULTATION_MINUTES]
    );

    for (const appt of staleRows) {
      await pool.query(
        `UPDATE appointments 
         SET status = 'Completed', updated_at = NOW() 
         WHERE appointment_id = ? AND status = 'In Consultation'`,
        [appt.appointment_id]
      );

      await pool.query(
        `INSERT INTO appointment_status_history (appointment_id, previous_status, new_status, remarks) 
         VALUES (?, 'In Consultation', 'Completed', ?)`,
        [appt.appointment_id, `Automatically marked as Completed after ${CONSULTATION_MINUTES} minutes in consultation`]
      );
    }

    return staleRows.length;
  } catch (error) {
    console.error('Error auto-completing consultations:', error);
    return 0;
  }
}

// Background auto-completion check every 60 seconds
setInterval(autoCompleteConsultations, 60000);

// Endpoint to trigger auto-completion manually
router.post('/auto-complete', async (req, res) => {
  const completedCount = await autoCompleteConsultations();
  res.json({
    success: true,
    message: `Auto-completion check processed. Completed ${completedCount} consultation(s).`,
    completed_count: completedCount
  });
});

// 1. GET /api/appointments - List appointments with filters
router.get('/', async (req, res) => {
  try {
    // Run auto-complete check so returned data is always up to date
    await autoCompleteConsultations();

    const { date, doctor_id, status, patient_id, limit = 100 } = req.query;

    let query = `
      SELECT 
        a.appointment_id,
        a.patient_id,
        CONCAT(p.first_name, ' ', p.last_name) AS patient_name,
        p.phone AS patient_phone,
        p.email AS patient_email,
        a.doctor_id,
        CONCAT('Dr. ', d.first_name, ' ', d.last_name) AS doctor_name,
        d.specialty AS doctor_specialty,
        a.appointment_date,
        a.start_time,
        a.end_time,
        a.reason,
        a.status,
        a.checked_in_at,
        a.consultation_started_at,
        a.notes,
        a.created_at,
        a.updated_at
      FROM appointments a
      INNER JOIN patients p ON a.patient_id = p.patient_id
      INNER JOIN doctors d ON a.doctor_id = d.doctor_id
      WHERE 1=1
    `;
    const params = [];

    if (date) {
      query += ` AND a.appointment_date = ?`;
      params.push(date);
    }

    if (doctor_id) {
      query += ` AND a.doctor_id = ?`;
      params.push(doctor_id);
    }

    if (status) {
      query += ` AND a.status = ?`;
      params.push(status);
    }

    if (patient_id) {
      query += ` AND a.patient_id = ?`;
      params.push(patient_id);
    }

    query += ` ORDER BY a.appointment_date DESC, a.start_time ASC LIMIT ?`;
    params.push(parseInt(limit, 10));

    const [rows] = await pool.query(query, params);

    const formatted = rows.map(row => ({
      ...row,
      start_time_label: formatTime12h(row.start_time),
      end_time_label: formatTime12h(row.end_time)
    }));

    res.json({ success: true, count: formatted.length, data: formatted });
  } catch (error) {
    console.error('Error fetching appointments:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch appointments. Please try again.' });
  }
});

// 2. POST /api/appointments - Book new appointment with row-locking transaction and conflict check
router.post('/', async (req, res) => {
  let connection;
  try {
    const {
      patient_id,
      doctor_id,
      appointment_date,
      start_time,
      end_time,
      reason,
      notes
    } = req.body;

    // Validation
    if (!patient_id || !doctor_id || !appointment_date || !start_time) {
      return res.status(400).json({
        success: false,
        error: 'Patient, Doctor, Appointment Date, and Start Time are required.'
      });
    }

    // Lagos timezone checks: block past dates and past times today
    const lagosToday = getLagosDateString();
    if (appointment_date < lagosToday) {
      return res.status(400).json({
        success: false,
        error: 'Cannot book appointments in the past.',
        message: `The selected date (${appointment_date}) has already passed (Today: ${lagosToday}).`
      });
    }

    const [h, m] = start_time.split(':').map(Number);
    const startMins = h * 60 + (m || 0);

    if (appointment_date === lagosToday) {
      const lagosNow = getLagosCurrentTime();
      if (startMins <= lagosNow.minutesFromMidnight) {
        return res.status(400).json({
          success: false,
          error: 'Cannot book past time slots for today.',
          message: `The selected time slot has already passed in Lagos WAT time (${lagosNow.timeStr.substring(0, 5)}).`
        });
      }
    }

    // Determine end_time if omitted (default +45 mins)
    let calculatedEndTime = end_time;
    if (!calculatedEndTime) {
      const endMins = startMins + 45;
      const eh = Math.floor(endMins / 60);
      const em = endMins % 60;
      calculatedEndTime = `${String(eh).padStart(2, '0')}:${String(em).padStart(2, '0')}:00`;
    }

    const normalizedStart = start_time.length === 5 ? `${start_time}:00` : start_time;
    const normalizedEnd = calculatedEndTime.length === 5 ? `${calculatedEndTime}:00` : calculatedEndTime;

    // Acquire connection for transaction with row-level locking
    connection = await pool.getConnection();
    await connection.beginTransaction();

    // 1. Lock and verify doctor is active
    const [doctorRows] = await connection.query(
      'SELECT doctor_id, is_active, first_name, last_name FROM doctors WHERE doctor_id = ? FOR UPDATE',
      [doctor_id]
    );

    if (doctorRows.length === 0 || !doctorRows[0].is_active) {
      await connection.rollback();
      return res.status(400).json({
        success: false,
        error: 'Inactive Doctor Selected',
        message: 'This doctor is currently inactive / off duty and cannot accept new bookings.'
      });
    }

    // 2. Verify doctor is scheduled and available on this day of week
    const [dayResult] = await connection.query('SELECT DAYOFWEEK(?) AS day_of_week', [appointment_date]);
    const dayOfWeek = dayResult[0]?.day_of_week;

    const [schedules] = await connection.query(
      `SELECT start_time, end_time, is_available 
       FROM doctor_schedules 
       WHERE doctor_id = ? AND day_of_week = ?`,
      [doctor_id, dayOfWeek]
    );

    if (schedules.length === 0 || !schedules[0].is_available) {
      await connection.rollback();
      return res.status(400).json({
        success: false,
        error: 'Doctor Off Duty',
        message: 'The selected doctor does not have available working hours scheduled for this day of the week.'
      });
    }

    const sched = schedules[0];
    const schedStartMins = timeToMinutes(sched.start_time);
    const schedEndMins = timeToMinutes(sched.end_time);
    const endMins = timeToMinutes(normalizedEnd);

    if (startMins < schedStartMins || endMins > schedEndMins) {
      await connection.rollback();
      return res.status(400).json({
        success: false,
        error: 'Outside Working Hours',
        message: `The selected slot is outside the doctor's scheduled hours (${formatTime12h(sched.start_time)} - ${formatTime12h(sched.end_time)}).`
      });
    }

    // 3. Double-booking check with row locking (SELECT ... FOR UPDATE)
    const [conflicts] = await connection.query(
      `SELECT appointment_id, start_time, end_time, status 
       FROM appointments 
       WHERE doctor_id = ? 
         AND appointment_date = ? 
         AND status NOT IN ('Cancelled', 'No-Show')
         AND start_time < ? 
         AND end_time > ?
       FOR UPDATE`,
      [doctor_id, appointment_date, normalizedEnd, normalizedStart]
    );

    if (conflicts.length > 0) {
      const conflict = conflicts[0];
      await connection.rollback();
      return res.status(409).json({
        success: false,
        error: 'Double-Booking Conflict Detected',
        message: `This doctor already has an active appointment scheduled between ${formatTime12h(conflict.start_time)} and ${formatTime12h(conflict.end_time)} on ${appointment_date}. Please select an alternative time slot.`
      });
    }

    // 4. Insert appointment inside transaction
    const [insertResult] = await connection.query(
      `INSERT INTO appointments (patient_id, doctor_id, appointment_date, start_time, end_time, reason, status, notes) 
       VALUES (?, ?, ?, ?, ?, ?, 'Scheduled', ?)`,
      [
        patient_id,
        doctor_id,
        appointment_date,
        normalizedStart,
        normalizedEnd,
        reason || 'Consultation',
        notes || null
      ]
    );

    const newAppointmentId = insertResult.insertId;

    // Record initial status history
    await connection.query(
      `INSERT INTO appointment_status_history (appointment_id, previous_status, new_status, remarks) 
       VALUES (?, NULL, 'Scheduled', 'Initial appointment booked')`,
      [newAppointmentId]
    );

    await connection.commit();

    // Retrieve inserted record
    const [createdRows] = await pool.query(
      `SELECT 
        a.appointment_id,
        a.patient_id,
        CONCAT(p.first_name, ' ', p.last_name) AS patient_name,
        p.phone AS patient_phone,
        a.doctor_id,
        CONCAT('Dr. ', d.first_name, ' ', d.last_name) AS doctor_name,
        d.specialty AS doctor_specialty,
        a.appointment_date,
        a.start_time,
        a.end_time,
        a.reason,
        a.status,
        a.notes,
        a.created_at
      FROM appointments a
      INNER JOIN patients p ON a.patient_id = p.patient_id
      INNER JOIN doctors d ON a.doctor_id = d.doctor_id
      WHERE a.appointment_id = ?`,
      [newAppointmentId]
    );

    const created = createdRows[0];
    res.status(201).json({
      success: true,
      message: 'Appointment booked successfully',
      data: {
        ...created,
        start_time_label: formatTime12h(created.start_time),
        end_time_label: formatTime12h(created.end_time)
      }
    });
  } catch (error) {
    if (connection) {
      try { await connection.rollback(); } catch (_) { }
    }
    console.error('Error booking appointment:', error);
    res.status(500).json({ success: false, error: 'Failed to book appointment. Please try again.' });
  } finally {
    if (connection) connection.release();
  }
});

// Allowed status transitions
const ALLOWED_TRANSITIONS = {
  'Scheduled': ['Checked-In', 'No-Show', 'Cancelled'],
  'Checked-In': ['In Consultation', 'Cancelled'],
  'In Consultation': ['Completed', 'Cancelled'],
  'Completed': [],
  'No-Show': [],
  'Cancelled': []
};

// 3. PATCH /api/appointments/:id/status - Update appointment status with transition guards
router.patch('/:id/status', async (req, res) => {
  try {
    const appointmentId = req.params.id;
    const { status, remarks } = req.body;

    const validStatuses = ['Scheduled', 'Checked-In', 'In Consultation', 'Completed', 'Cancelled', 'No-Show'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        error: `Invalid status. Must be one of: ${validStatuses.join(', ')}`
      });
    }

    // Cancellation requires mandatory reason
    if (status === 'Cancelled' && (!remarks || !remarks.trim())) {
      return res.status(400).json({
        success: false,
        error: 'A mandatory reason is required to cancel this appointment.'
      });
    }

    const [existing] = await pool.query(
      'SELECT status, checked_in_at, consultation_started_at, notes FROM appointments WHERE appointment_id = ?',
      [appointmentId]
    );
    if (existing.length === 0) {
      return res.status(404).json({ success: false, error: 'Appointment not found' });
    }

    const previousStatus = existing[0].status;

    if (previousStatus === status) {
      return res.json({
        success: true,
        message: `Appointment is already ${status}`,
        appointment_id: Number(appointmentId),
        previous_status: previousStatus,
        new_status: status
      });
    }

    const allowed = ALLOWED_TRANSITIONS[previousStatus] || [];
    if (!allowed.includes(status)) {
      return res.status(400).json({
        success: false,
        error: `Invalid status transition from "${previousStatus}" to "${status}". Allowed transitions: ${allowed.length ? allowed.join(', ') : 'None (Terminal state)'}.`
      });
    }

    let updateQuery = 'UPDATE appointments SET status = ?';
    const updateParams = [status];

    if (status === 'Checked-In' && !existing[0].checked_in_at) {
      updateQuery += ', checked_in_at = NOW()';
    }

    if (status === 'In Consultation') {
      updateQuery += ', consultation_started_at = NOW()';
    }

    if (status === 'Cancelled' && remarks) {
      const updatedNotes = existing[0].notes
        ? `${existing[0].notes}\nCancellation Reason: ${remarks.trim()}`
        : `Cancellation Reason: ${remarks.trim()}`;
      updateQuery += ', notes = ?';
      updateParams.push(updatedNotes);
    }

    updateQuery += ', updated_at = NOW() WHERE appointment_id = ?';
    updateParams.push(appointmentId);

    await pool.query(updateQuery, updateParams);

    const historyRemarks = remarks && remarks.trim()
      ? remarks.trim()
      : `Status transitioned from ${previousStatus} to ${status}`;

    await pool.query(
      `INSERT INTO appointment_status_history (appointment_id, previous_status, new_status, remarks) 
       VALUES (?, ?, ?, ?)`,
      [appointmentId, previousStatus, status, historyRemarks]
    );

    res.json({
      success: true,
      message: `Appointment status updated to ${status}`,
      appointment_id: Number(appointmentId),
      previous_status: previousStatus,
      new_status: status
    });
  } catch (error) {
    console.error('Error updating status:', error);
    res.status(500).json({ success: false, error: 'Failed to update appointment status. Please try again.' });
  }
});

// Also support PUT /api/appointments/:id/status
router.put('/:id/status', async (req, res) => {
  req.url = `/${req.params.id}/status`;
  return router.handle(req, res);
});

// 4. POST /api/appointments/:id/reschedule - Reschedule appointment with mandatory reason and slot validation
router.post('/:id/reschedule', async (req, res) => {
  let connection;
  try {
    const appointmentId = req.params.id;
    const { doctor_id, appointment_date, start_time, reason } = req.body;

    if (!reason || !reason.trim()) {
      return res.status(400).json({
        success: false,
        error: 'A mandatory reason is required to reschedule this appointment.'
      });
    }

    if (!doctor_id || !appointment_date || !start_time) {
      return res.status(400).json({
        success: false,
        error: 'Doctor, new appointment date, and start time are all required.'
      });
    }

    const lagosToday = getLagosDateString();
    if (appointment_date < lagosToday) {
      return res.status(400).json({
        success: false,
        error: 'Cannot reschedule appointments to past dates.'
      });
    }

    const [h, m] = start_time.split(':').map(Number);
    const startMins = h * 60 + (m || 0);

    if (appointment_date === lagosToday) {
      const lagosNow = getLagosCurrentTime();
      if (startMins <= lagosNow.minutesFromMidnight) {
        return res.status(400).json({
          success: false,
          error: 'Cannot reschedule to a past time slot for today.'
        });
      }
    }

    const endMins = startMins + 45;
    const eh = Math.floor(endMins / 60);
    const em = endMins % 60;
    const normalizedStart = start_time.length === 5 ? `${start_time}:00` : start_time;
    const normalizedEnd = `${String(eh).padStart(2, '0')}:${String(em).padStart(2, '0')}:00`;

    connection = await pool.getConnection();
    await connection.beginTransaction();

    // Check existing appointment
    const [existing] = await connection.query(
      'SELECT appointment_id, status, notes FROM appointments WHERE appointment_id = ? FOR UPDATE',
      [appointmentId]
    );

    if (existing.length === 0) {
      await connection.rollback();
      return res.status(404).json({ success: false, error: 'Appointment not found.' });
    }

    const previousStatus = existing[0].status;
    if (['Completed', 'Cancelled'].includes(previousStatus)) {
      await connection.rollback();
      return res.status(400).json({
        success: false,
        error: `Cannot reschedule a ${previousStatus} appointment.`
      });
    }

    // Verify doctor is active
    const [doctorRows] = await connection.query(
      'SELECT doctor_id, is_active FROM doctors WHERE doctor_id = ? FOR UPDATE',
      [doctor_id]
    );

    if (doctorRows.length === 0 || !doctorRows[0].is_active) {
      await connection.rollback();
      return res.status(400).json({
        success: false,
        error: 'Selected doctor is currently inactive / off duty.'
      });
    }

    // Verify doctor schedule
    const [dayResult] = await connection.query('SELECT DAYOFWEEK(?) AS day_of_week', [appointment_date]);
    const dayOfWeek = dayResult[0]?.day_of_week;

    const [schedules] = await connection.query(
      `SELECT start_time, end_time, is_available 
       FROM doctor_schedules 
       WHERE doctor_id = ? AND day_of_week = ?`,
      [doctor_id, dayOfWeek]
    );

    if (schedules.length === 0 || !schedules[0].is_available) {
      await connection.rollback();
      return res.status(400).json({
        success: false,
        error: 'Doctor is off duty on the selected day of week.'
      });
    }

    const sched = schedules[0];
    const schedStartMins = timeToMinutes(sched.start_time);
    const schedEndMins = timeToMinutes(sched.end_time);

    if (startMins < schedStartMins || endMins > schedEndMins) {
      await connection.rollback();
      return res.status(400).json({
        success: false,
        error: `Selected slot is outside doctor's hours (${formatTime12h(sched.start_time)} - ${formatTime12h(sched.end_time)}).`
      });
    }

    // Double-booking check excluding this appointment itself
    const [conflicts] = await connection.query(
      `SELECT appointment_id, start_time, end_time 
       FROM appointments 
       WHERE doctor_id = ? 
         AND appointment_date = ? 
         AND appointment_id != ?
         AND status NOT IN ('Cancelled', 'No-Show')
         AND start_time < ? 
         AND end_time > ?
       FOR UPDATE`,
      [doctor_id, appointment_date, appointmentId, normalizedEnd, normalizedStart]
    );

    if (conflicts.length > 0) {
      await connection.rollback();
      return res.status(409).json({
        success: false,
        error: `Slot conflict: This doctor already has an active appointment between ${formatTime12h(conflicts[0].start_time)} and ${formatTime12h(conflicts[0].end_time)}.`
      });
    }

    const rescheduleNote = `Rescheduled to ${appointment_date} (${formatTime12h(normalizedStart)} - ${formatTime12h(normalizedEnd)}). Reason: ${reason.trim()}`;
    const updatedNotes = existing[0].notes ? `${existing[0].notes}\n${rescheduleNote}` : rescheduleNote;

    // Update appointment
    await connection.query(
      `UPDATE appointments 
       SET doctor_id = ?, appointment_date = ?, start_time = ?, end_time = ?, 
           status = 'Scheduled', checked_in_at = NULL, consultation_started_at = NULL, 
           notes = ?, updated_at = NOW() 
       WHERE appointment_id = ?`,
      [doctor_id, appointment_date, normalizedStart, normalizedEnd, updatedNotes, appointmentId]
    );

    // Record status history
    await connection.query(
      `INSERT INTO appointment_status_history (appointment_id, previous_status, new_status, remarks) 
       VALUES (?, ?, 'Scheduled', ?)`,
      [appointmentId, previousStatus, rescheduleNote]
    );

    await connection.commit();

    res.json({
      success: true,
      message: 'Appointment rescheduled successfully.',
      appointment_id: Number(appointmentId),
      new_date: appointment_date,
      new_time: `${formatTime12h(normalizedStart)} - ${formatTime12h(normalizedEnd)}`
    });
  } catch (error) {
    if (connection) {
      try { await connection.rollback(); } catch (_) { }
    }
    console.error('Error rescheduling appointment:', error);
    res.status(500).json({ success: false, error: 'Failed to reschedule appointment. Please try again.' });
  } finally {
    if (connection) connection.release();
  }
});

// 5. GET /api/appointments/:id/history - Get status audit history
router.get('/:id/history', async (req, res) => {
  try {
    const [history] = await pool.query(
      `SELECT history_id, appointment_id, previous_status, new_status, changed_at, remarks 
       FROM appointment_status_history 
       WHERE appointment_id = ? 
       ORDER BY changed_at ASC`,
      [req.params.id]
    );
    res.json({ success: true, data: history });
  } catch (error) {
    console.error('Error fetching history:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch status history. Please try again.' });
  }
});

module.exports = router;