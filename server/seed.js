const { pool, testConnection } = require('./config/db');

async function seed() {
  console.log('Connecting to MySQL...');
  const connStatus = await testConnection();
  if (!connStatus.connected) {
    console.error('Database connection failed:', connStatus.message);
    process.exit(1);
  }

  try {
    console.log('Resetting existing data safely (clearing tables)...');
    await pool.query('SET FOREIGN_KEY_CHECKS = 0');
    await pool.query('TRUNCATE TABLE appointment_status_history');
    await pool.query('TRUNCATE TABLE appointments');
    await pool.query('TRUNCATE TABLE doctor_schedules');
    await pool.query('TRUNCATE TABLE doctors');
    await pool.query('TRUNCATE TABLE patients');
    await pool.query('SET FOREIGN_KEY_CHECKS = 1');
    console.log('Tables cleared.');

    // 1. Seed Nigerian Doctors (5 Active + 2 Inactive)
    console.log('Seeding Nigerian doctors (both active and inactive)...');
    const doctors = [
      ['Adebayo', 'Ogunlesi', 'Cardiology', '+234 803 060 2201', 'a.ogunlesi@clinic.ng', true],
      ['Ngozi', 'Eze', 'General Practitioner', '+234 805 689 2202', 'n.eze@clinic.ng', true],
      ['Hauwa', 'Abdullahi', 'Pediatrics', '+234 809 987 2203', 'h.abdullahi@clinic.ng', true],
      ['Chukwuma', 'Nwosu', 'Orthopedics', '+234 812 453 2204', 'c.nwosu@clinic.ng', true],
      ['Folake', 'Adeyemi', 'Dermatology', '+234 818 111 2205', 'f.adeyemi@clinic.ng', true],
      ['Oluwaseun', 'Babalola', 'Neurology', '+234 802 333 4406', 'o.babalola@clinic.ng', false],
      ['Amaka', 'Obi', 'Endocrinology', '+234 806 777 8807', 'a.obi@clinic.ng', false]
    ];

    const insertedDoctors = [];
    for (const doc of doctors) {
      const [result] = await pool.query(
        `INSERT INTO doctors (first_name, last_name, specialty, phone, email, is_active) VALUES (?, ?, ?, ?, ?, ?)`,
        doc
      );
      insertedDoctors.push({ doctor_id: result.insertId, is_active: doc[5] });
    }
    console.log(`Seeded ${insertedDoctors.length} Nigerian doctors (5 active, 2 inactive).`);

    // 2. Seed Doctor Schedules (Monday to Friday, 09:00 - 17:00 for active doctors, 45m slots)
    console.log('Seeding active doctor schedules...');
    const activeDoctorIds = insertedDoctors.filter(d => d.is_active).map(d => d.doctor_id);
    for (const docId of activeDoctorIds) {
      for (let day = 2; day <= 6; day++) {
        await pool.query(
          `INSERT INTO doctor_schedules (doctor_id, day_of_week, start_time, end_time, slot_duration_minutes, is_available)
           VALUES (?, ?, '09:00:00', '17:00:00', 45, TRUE)`,
          [docId, day]
        );
      }
    }
    console.log('Seeded schedules for Monday-Friday across active doctors.');

    // 3. Seed Nigerian Patients with realistic personal emails (@gmail.com, @yahoo.com)
    console.log('Seeding Nigerian patients with personal email domains...');
    const patients = [
      [
        'Chidinma',
        'Okafor',
        '+234 803 456 7890',
        'chidinma.okafor@gmail.com',
        '1992-06-15',
        'Female',
        '14 Admiralty Way, Lekki Phase 1, Lagos',
        'Emeka Okafor (Spouse) - +234 802 345 6789'
      ],
      [
        'Tunde',
        'Bakare',
        '+234 802 567 8901',
        'tunde.bakare@yahoo.com',
        '1987-11-23',
        'Male',
        '28 Allen Avenue, Ikeja, Lagos',
        'Bisi Bakare (Sister) - +234 803 111 2233'
      ],
      [
        'Zainab',
        'Suleiman',
        '+234 809 678 9012',
        'zainab.suleiman@gmail.com',
        '1995-03-08',
        'Female',
        '5 Bourdillon Road, Ikoyi, Lagos',
        'Ibrahim Suleiman (Father) - +234 808 222 3344'
      ],
      [
        'Emeka',
        'Nwachukwu',
        '+234 813 789 0123',
        'emeka.nwachukwu@gmail.com',
        '1983-09-14',
        'Male',
        '19 Bode Thomas Street, Surulere, Lagos',
        'Chioma Nwachukwu (Wife) - +234 809 333 4455'
      ],
      [
        'Yetunde',
        'Balogun',
        '+234 817 890 1234',
        'yetunde.balogun@yahoo.com',
        '1990-12-01',
        'Female',
        '42 Awolowo Road, Victoria Island, Lagos',
        'Femi Balogun (Brother) - +234 812 444 5566'
      ]
    ];

    const insertedPatientIds = [];
    for (let i = 0; i < patients.length; i++) {
      const p = patients[i];
      const code = `PT-${String(i + 1).padStart(4, '0')}`;
      const [res] = await pool.query(
        `INSERT INTO patients (patient_code, first_name, last_name, phone, email, date_of_birth, gender, address, emergency_contact)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [code, ...p]
      );
      insertedPatientIds.push(res.insertId);
    }
    console.log(`Seeded ${insertedPatientIds.length} Nigerian patients with PT-XXXX codes.`);

    // 4. Seed Today's Sample Appointments & Status History
    console.log('Seeding today sample appointments...');
    const today = new Date().toISOString().split('T')[0];

    const sampleAppointments = [
      {
        patient_id: insertedPatientIds[0],
        doctor_id: activeDoctorIds[0],
        start_time: '09:00:00',
        end_time: '09:45:00',
        reason: 'Cardiology Review & ECG',
        status: 'Scheduled'
      },
      {
        patient_id: insertedPatientIds[1],
        doctor_id: activeDoctorIds[1],
        start_time: '10:00:00',
        end_time: '10:45:00',
        reason: 'General Medical Examination',
        status: 'Checked-In'
      },
      {
        patient_id: insertedPatientIds[2],
        doctor_id: activeDoctorIds[2],
        start_time: '11:30:00',
        end_time: '12:15:00',
        reason: 'Pediatric Care & Immunization Check',
        status: 'In Consultation'
      },
      {
        patient_id: insertedPatientIds[3],
        doctor_id: activeDoctorIds[3],
        start_time: '14:00:00',
        end_time: '14:45:00',
        reason: 'Orthopedic Knee Assessment',
        status: 'Completed'
      },
      {
        patient_id: insertedPatientIds[4],
        doctor_id: activeDoctorIds[4],
        start_time: '15:30:00',
        end_time: '16:15:00',
        reason: 'Dermatology Skin Consultation',
        status: 'Scheduled'
      }
    ];

    for (const appt of sampleAppointments) {
      const [apptRes] = await pool.query(
        `INSERT INTO appointments (patient_id, doctor_id, appointment_date, start_time, end_time, reason, status)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [appt.patient_id, appt.doctor_id, today, appt.start_time, appt.end_time, appt.reason, appt.status]
      );

      const apptId = apptRes.insertId;

      // Status history
      await pool.query(
        `INSERT INTO appointment_status_history (appointment_id, previous_status, new_status, remarks)
         VALUES (?, NULL, 'Scheduled', 'Initial advance appointment booked')`,
        [apptId]
      );

      if (appt.status !== 'Scheduled') {
        await pool.query(
          `INSERT INTO appointment_status_history (appointment_id, previous_status, new_status, remarks)
           VALUES (?, 'Scheduled', ?, ?)`,
          [apptId, appt.status, `Patient status updated to ${appt.status}`]
        );
      }
    }

    console.log('Seeded sample appointments across Pre-Arrival, Checked-In, In Consultation, and Completed stages.');
    console.log('Database seeding process completed successfully!');
    process.exit(0);
  } catch (error) {
    console.error('Error during seeding:', error);
    process.exit(1);
  }
}

seed();
