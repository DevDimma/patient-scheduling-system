const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');
const { getLagosDateString, getLagosCurrentTime } = require('../utils/timezone');

// Helper to format HH:MM:SS to 12-hour AM/PM label
function formatTime12h(timeStr) {
  const [h, m] = timeStr.split(':').map(Number);
  const period = h >= 12 ? 'PM' : 'AM';
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  const padMin = String(m).padStart(2, '0');
  return `${String(hour12).padStart(2, '0')}:${padMin} ${period}`;
}

// Helper to convert HH:MM:SS to minutes from midnight
function timeToMinutes(timeStr) {
  const [h, m] = timeStr.split(':').map(Number);
  return h * 60 + m;
}

// Helper to convert minutes from midnight to HH:MM:SS
function minutesToTime(mins) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`;
}

// 1. GET /api/doctors - List doctors (supports ?includeInactive=true)
router.get('/', async (req, res) => {
  try {
    const { includeInactive } = req.query;
    let query = `
      SELECT doctor_id, first_name, last_name, specialty, phone, email, is_active, created_at 
      FROM doctors
    `;

    if (includeInactive === 'true' || includeInactive === '1') {
      query += ` ORDER BY is_active DESC, specialty ASC, first_name ASC`;
    } else {
      query += ` WHERE is_active = TRUE ORDER BY specialty ASC, first_name ASC`;
    }

    const [rows] = await pool.query(query);
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('Error fetching doctors:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch doctors list. Please try again.' });
  }
});

// 2. POST /api/doctors - Add a new doctor
router.post('/', async (req, res) => {
  try {
    const { first_name, last_name, specialty, phone, email, is_active = 1 } = req.body;

    if (!first_name || !last_name || !specialty || !phone || !email) {
      return res.status(400).json({
        success: false,
        error: 'First name, last name, specialty, phone number, and email are all required.'
      });
    }

    const [result] = await pool.query(
      `INSERT INTO doctors (first_name, last_name, specialty, phone, email, is_active) 
       VALUES (?, ?, ?, ?, ?, ?)`,
      [first_name.trim(), last_name.trim(), specialty.trim(), phone.trim(), email.trim().toLowerCase(), is_active ? 1 : 0]
    );

    const newDoctorId = result.insertId;

    // Create standard default schedule: Monday to Friday (days 2 to 6), 09:00 - 17:00, 45-min slots
    const defaultSchedules = [
      [newDoctorId, 2, '09:00:00', '17:00:00', 45, 1], // Mon
      [newDoctorId, 3, '09:00:00', '17:00:00', 45, 1], // Tue
      [newDoctorId, 4, '09:00:00', '17:00:00', 45, 1], // Wed
      [newDoctorId, 5, '09:00:00', '17:00:00', 45, 1], // Thu
      [newDoctorId, 6, '09:00:00', '17:00:00', 45, 1], // Fri
      [newDoctorId, 7, '09:00:00', '13:00:00', 45, 0], // Sat (off by default)
      [newDoctorId, 1, '09:00:00', '13:00:00', 45, 0]  // Sun (off by default)
    ];

    await pool.query(
      `INSERT INTO doctor_schedules (doctor_id, day_of_week, start_time, end_time, slot_duration_minutes, is_available) 
       VALUES ?`,
      [defaultSchedules]
    );

    res.status(201).json({
      success: true,
      message: `Dr. ${first_name} ${last_name} added successfully with default weekly schedule.`,
      doctor_id: newDoctorId
    });
  } catch (error) {
    console.error('Error creating doctor:', error);
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({ success: false, error: 'A doctor with this email already exists.' });
    }
    res.status(500).json({ success: false, error: 'Failed to create doctor. Please try again.' });
  }
});

// 3. PATCH /api/doctors/:id/toggle-active - Toggle active status
router.patch('/:id/toggle-active', async (req, res) => {
  try {
    const doctorId = req.params.id;
    const [existing] = await pool.query('SELECT doctor_id, first_name, last_name, is_active FROM doctors WHERE doctor_id = ?', [doctorId]);
    if (existing.length === 0) {
      return res.status(404).json({ success: false, error: 'Doctor not found.' });
    }

    const newStatus = existing[0].is_active ? 0 : 1;
    await pool.query('UPDATE doctors SET is_active = ? WHERE doctor_id = ?', [newStatus, doctorId]);

    res.json({
      success: true,
      message: `Dr. ${existing[0].first_name} ${existing[0].last_name} is now ${newStatus ? 'Active' : 'Inactive / Off Duty'}.`,
      is_active: newStatus
    });
  } catch (error) {
    console.error('Error toggling doctor status:', error);
    res.status(500).json({ success: false, error: 'Failed to update doctor status.' });
  }
});

// 4. GET /api/doctors/:id/schedules - Get schedule for a specific doctor
router.get('/:id/schedules', async (req, res) => {
  try {
    const doctorId = req.params.id;
    const [schedules] = await pool.query(
      `SELECT schedule_id, doctor_id, day_of_week, start_time, end_time, slot_duration_minutes, is_available 
       FROM doctor_schedules 
       WHERE doctor_id = ? 
       ORDER BY day_of_week ASC, start_time ASC`,
      [doctorId]
    );
    res.json({ success: true, data: schedules });
  } catch (error) {
    console.error('Error fetching doctor schedules:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch doctor schedules. Please try again.' });
  }
});

// 5. PUT /api/doctors/:id/schedules - Update weekly schedules for a doctor
router.put('/:id/schedules', async (req, res) => {
  try {
    const doctorId = req.params.id;
    const { schedules } = req.body;

    if (!Array.isArray(schedules) || schedules.length === 0) {
      return res.status(400).json({ success: false, error: 'Schedules array is required.' });
    }

    // Delete existing schedules for this doctor and insert updated ones
    await pool.query('DELETE FROM doctor_schedules WHERE doctor_id = ?', [doctorId]);

    const insertValues = schedules.map(s => [
      doctorId,
      s.day_of_week,
      s.start_time || '09:00:00',
      s.end_time || '17:00:00',
      s.slot_duration_minutes || 45,
      s.is_available ? 1 : 0
    ]);

    await pool.query(
      `INSERT INTO doctor_schedules (doctor_id, day_of_week, start_time, end_time, slot_duration_minutes, is_available) 
       VALUES ?`,
      [insertValues]
    );

    res.json({
      success: true,
      message: 'Doctor weekly working schedule updated successfully.'
    });
  } catch (error) {
    console.error('Error updating doctor schedules:', error);
    res.status(500).json({ success: false, error: 'Failed to update doctor schedule. Please try again.' });
  }
});

// 6. GET /api/doctors/:id/slots?date=YYYY-MM-DD - Get available appointment slots
router.get('/:id/slots', async (req, res) => {
  try {
    const doctorId = req.params.id;
    const { date } = req.query;

    if (!date) {
      return res.status(400).json({ success: false, error: 'Query parameter "date" (YYYY-MM-DD) is required' });
    }

    // Check if selected date is in the past according to Lagos timezone
    const lagosToday = getLagosDateString();
    if (date < lagosToday) {
      return res.json({
        success: true,
        data: {
          doctor_id: Number(doctorId),
          date,
          day_of_week: null,
          slot_duration_minutes: 45,
          is_past_date: true,
          message: 'Cannot schedule appointments for past dates.',
          slots: []
        }
      });
    }

    // Check if doctor exists and is active
    const [docCheck] = await pool.query('SELECT is_active, first_name, last_name FROM doctors WHERE doctor_id = ?', [doctorId]);
    if (docCheck.length === 0 || !docCheck[0].is_active) {
      return res.status(400).json({
        success: false,
        error: 'Selected doctor is currently inactive / off duty and unavailable for bookings.'
      });
    }

    // Determine Day of Week (1=Sunday, 2=Monday, ..., 7=Saturday in MySQL)
    const [dayResult] = await pool.query('SELECT DAYOFWEEK(?) AS day_of_week', [date]);
    const dayOfWeek = dayResult[0]?.day_of_week;

    // Check doctor schedules: strictly respect days off and is_available
    const [schedules] = await pool.query(
      `SELECT start_time, end_time, slot_duration_minutes, is_available 
       FROM doctor_schedules 
       WHERE doctor_id = ? AND day_of_week = ?`,
      [doctorId, dayOfWeek]
    );

    // If no schedule exists or is_available is false, doctor is off duty on this day
    if (schedules.length === 0 || !schedules[0].is_available) {
      return res.json({
        success: true,
        data: {
          doctor_id: Number(doctorId),
          date,
          day_of_week: dayOfWeek,
          is_day_off: true,
          message: `Dr. ${docCheck[0].first_name} ${docCheck[0].last_name} is off duty on this day.`,
          slots: []
        }
      });
    }

    const activeSchedule = schedules[0];
    const slotDuration = activeSchedule.slot_duration_minutes || 45;
    const startMins = timeToMinutes(activeSchedule.start_time);
    const endMins = timeToMinutes(activeSchedule.end_time);

    // Fetch existing booked appointments on this date
    const [bookedAppointments] = await pool.query(
      `SELECT start_time, end_time, status 
       FROM appointments 
       WHERE doctor_id = ? AND appointment_date = ? AND status NOT IN ('Cancelled', 'No-Show')`,
      [doctorId, date]
    );

    // Get current time in Lagos to block slots that have already passed today
    const isToday = (date === lagosToday);
    const lagosNow = isToday ? getLagosCurrentTime() : null;

    const slots = [];
    for (let currentMins = startMins; currentMins + slotDuration <= endMins; currentMins += slotDuration) {
      const slotStart = minutesToTime(currentMins);
      const slotEnd = minutesToTime(currentMins + slotDuration);

      // Check overlap with any existing appointment
      const isBooked = bookedAppointments.some(appt => {
        const apptStartMins = timeToMinutes(appt.start_time);
        const apptEndMins = timeToMinutes(appt.end_time);
        return currentMins < apptEndMins && (currentMins + slotDuration) > apptStartMins;
      });

      // Check if slot has already passed in Lagos WAT time
      const isPastSlot = isToday && currentMins <= lagosNow.minutesFromMidnight;

      slots.push({
        start_time: slotStart,
        end_time: slotEnd,
        label: `${formatTime12h(slotStart)} - ${formatTime12h(slotEnd)}`,
        is_available: !isBooked && !isPastSlot,
        is_past: isPastSlot,
        is_booked: isBooked
      });
    }

    res.json({
      success: true,
      data: {
        doctor_id: Number(doctorId),
        date,
        day_of_week: dayOfWeek,
        slot_duration_minutes: slotDuration,
        is_day_off: false,
        slots
      }
    });
  } catch (error) {
    console.error('Error generating slots:', error);
    res.status(500).json({ success: false, error: 'Failed to generate available appointment slots. Please try again.' });
  }
});

module.exports = router;