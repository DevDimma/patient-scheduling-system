-- ====================================================================
-- Hospital Management & Patient Appointment Scheduling System
-- Database Schema & Seed Data (Strict Dependency Order)
-- ====================================================================

CREATE DATABASE IF NOT EXISTS hospital_management;
USE hospital_management;

-- 1. PATIENTS TABLE
CREATE TABLE IF NOT EXISTS patients (
    patient_id INT AUTO_INCREMENT PRIMARY KEY,
    patient_code VARCHAR(20) UNIQUE,
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    phone VARCHAR(20) NOT NULL,
    email VARCHAR(150),
    date_of_birth DATE,
    gender VARCHAR(20),
    address TEXT,
    emergency_contact VARCHAR(100),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 2. DOCTORS TABLE
CREATE TABLE IF NOT EXISTS doctors (
    doctor_id INT AUTO_INCREMENT PRIMARY KEY,
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    specialty VARCHAR(100) NOT NULL,
    phone VARCHAR(20),
    email VARCHAR(150),
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 3. DOCTOR SCHEDULES TABLE (Depends on doctors)
CREATE TABLE IF NOT EXISTS doctor_schedules (
    schedule_id INT AUTO_INCREMENT PRIMARY KEY,
    doctor_id INT NOT NULL,
    day_of_week TINYINT NOT NULL,
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    slot_duration_minutes INT DEFAULT 45,
    is_available BOOLEAN DEFAULT TRUE,

    FOREIGN KEY (doctor_id)
        REFERENCES doctors(doctor_id)
        ON DELETE CASCADE,

    CHECK (day_of_week BETWEEN 1 AND 7),
    CHECK (end_time > start_time),
    CHECK (slot_duration_minutes > 0)
);

-- 4. APPOINTMENTS TABLE (Depends on patients and doctors)
CREATE TABLE IF NOT EXISTS appointments (
    appointment_id INT AUTO_INCREMENT PRIMARY KEY,
    patient_id INT NOT NULL,
    doctor_id INT NOT NULL,
    appointment_date DATE NOT NULL,
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    reason TEXT,
    status ENUM(
        'Scheduled',
        'Checked-In',
        'In Consultation',
        'Completed',
        'Cancelled',
        'No-Show'
    ) DEFAULT 'Scheduled',
    checked_in_at DATETIME,
    consultation_started_at DATETIME,
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP,

    FOREIGN KEY (patient_id)
        REFERENCES patients(patient_id)
        ON DELETE CASCADE,

    FOREIGN KEY (doctor_id)
        REFERENCES doctors(doctor_id)
        ON DELETE CASCADE,

    CHECK (end_time > start_time),

    INDEX idx_appointment_date (appointment_date),
    INDEX idx_doctor_date (doctor_id, appointment_date),
    INDEX idx_patient (patient_id)
);

-- 5. APPOINTMENT STATUS HISTORY TABLE (Depends on appointments)
CREATE TABLE IF NOT EXISTS appointment_status_history (
    history_id INT AUTO_INCREMENT PRIMARY KEY,
    appointment_id INT NOT NULL,
    previous_status VARCHAR(30),
    new_status VARCHAR(30) NOT NULL,
    changed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    remarks TEXT,

    FOREIGN KEY (appointment_id)
        REFERENCES appointments(appointment_id)
        ON DELETE CASCADE
);

SHOW TABLES;
DESCRIBE patients;
DESCRIBE doctors;
DESCRIBE doctor_schedules;
DESCRIBE appointments;
DESCRIBE appointment_status_history;
