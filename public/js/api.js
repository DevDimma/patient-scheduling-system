// Centralized API Client for Advanced Patient Appointment Scheduling & Pre-Arrival Management System
const API = {
  baseUrl: '/api',

  async request(endpoint, options = {}) {
    try {
      const config = {
        headers: {
          'Content-Type': 'application/json',
          ...options.headers
        },
        ...options
      };

      const response = await fetch(`${this.baseUrl}${endpoint}`, config);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || data.error || `HTTP error ${response.status}`);
      }

      return data;
    } catch (error) {
      console.error(`API Error on ${endpoint}:`, error);
      throw error;
    }
  },

  // Health & Stats
  getHealth() {
    return this.request('/health');
  },

  getDashboardStats() {
    return this.request('/stats/dashboard');
  },

  // Doctors
  getDoctors(includeInactive = false) {
    const query = includeInactive ? '?includeInactive=true' : '';
    return this.request(`/doctors${query}`);
  },

  getDoctorSchedules(doctorId) {
    return this.request(`/doctors/${doctorId}/schedules`);
  },

  getDoctorSlots(doctorId, date) {
    return this.request(`/doctors/${doctorId}/slots?date=${encodeURIComponent(date)}`);
  },

  createDoctor(doctorData) {
    return this.request('/doctors', {
      method: 'POST',
      body: JSON.stringify(doctorData)
    });
  },

  toggleDoctorActive(doctorId) {
    return this.request(`/doctors/${doctorId}/toggle-active`, {
      method: 'PATCH'
    });
  },

  updateDoctorSchedules(doctorId, schedules) {
    return this.request(`/doctors/${doctorId}/schedules`, {
      method: 'PUT',
      body: JSON.stringify({ schedules })
    });
  },

  // Patients
  getPatients(query = '') {
    const q = query ? `?q=${encodeURIComponent(query)}` : '';
    return this.request(`/patients${q}`);
  },

  getPatientById(patientId) {
    return this.request(`/patients/${patientId}`);
  },

  createPatient(patientData) {
    return this.request('/patients', {
      method: 'POST',
      body: JSON.stringify(patientData)
    });
  },

  updatePatient(patientId, patientData) {
    return this.request(`/patients/${patientId}`, {
      method: 'PUT',
      body: JSON.stringify(patientData)
    });
  },

  // Appointments
  getAppointments(filters = {}) {
    const params = new URLSearchParams();
    if (filters.date) params.append('date', filters.date);
    if (filters.doctor_id) params.append('doctor_id', filters.doctor_id);
    if (filters.status) params.append('status', filters.status);
    if (filters.patient_id) params.append('patient_id', filters.patient_id);
    if (filters.limit) params.append('limit', filters.limit);

    const queryString = params.toString() ? `?${params.toString()}` : '';
    return this.request(`/appointments${queryString}`);
  },

  createAppointment(appointmentData) {
    return this.request('/appointments', {
      method: 'POST',
      body: JSON.stringify(appointmentData)
    });
  },

  updateAppointmentStatus(appointmentId, status, remarks = '') {
    return this.request(`/appointments/${appointmentId}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status, remarks })
    });
  },

  getAppointmentHistory(appointmentId) {
    return this.request(`/appointments/${appointmentId}/history`);
  },

  rescheduleAppointment(appointmentId, data) {
    return this.request(`/appointments/${appointmentId}/reschedule`, {
      method: 'POST',
      body: JSON.stringify(data)
    });
  },

  autoCompleteConsultations() {
    return this.request('/appointments/auto-complete', {
      method: 'POST'
    });
  }
};
