// Main Application Controller for Advanced Patient Appointment Scheduling & Pre-Arrival Management System
document.addEventListener('DOMContentLoaded', () => {
    initApp();
});

// HTML-escape utility for XSS Prevention
function escapeHTML(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

// Timezone Helper: Get current date in Africa/Lagos (YYYY-MM-DD)
function getLagosTodayString() {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Africa/Lagos',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).format(new Date());
}

const AppState = {
    currentTab: 'advance-scheduling',
    doctors: [],
    allDoctors: [],
    selectedPatient: null,
    editingPatientId: null,
    selectedDoctor: null,
    selectedDate: getLagosTodayString(),
    selectedSlot: null,
    availableSlots: []
};

// -------------------------------------------------------------
// Initialization
// -------------------------------------------------------------
async function initApp() {
    setupSidebarNavigation();
    setupPatientSearch();
    setupAppointmentForm();
    setupPatientRegistrationModal();
    setupEditPatientModal();
    setupDateFilters();
    setupNotificationBell();
    setupProfileDropdown();

    // Set pipeline date label formatted in Lagos timezone
    const pipelineDateEl = document.getElementById('flowPipelineDate');
    if (pipelineDateEl) {
        pipelineDateEl.textContent = new Intl.DateTimeFormat('en-GB', {
            timeZone: 'Africa/Lagos',
            weekday: 'long',
            day: '2-digit',
            month: 'long',
            year: 'numeric'
        }).format(new Date());
    }

    // Load initial clinic data
    // Load initial clinic data (a failure in one step must not stop the rest)
    const startupSteps = [checkDatabaseHealth, loadDoctors, refreshDashboardStats, loadDailySchedule, refreshVisitFlow, loadNotifications];
    for (const step of startupSteps) {
        try {
            await step();
        } catch (err) {
            console.error(`Startup step "${step.name}" failed:`, err);
        }
    }
    // Auto-refresh every 30 seconds. The server moves finished consultations to "Completed" by itself;
    // this makes the screen pick that up without anyone clicking anything.
    setInterval(async () => {
        if (document.hidden) return;
        try {
            await refreshVisitFlow();
            await refreshDashboardStats();
            const menuOpen = document.querySelector('#dailyScheduleTableBody .dropdown-menu.show');
            if (AppState.currentTab === 'advance-scheduling' && !menuOpen) await loadDailySchedule(true);
            await loadNotifications();
        } catch (err) {
            console.warn('Auto-refresh failed:', err.message);
        }
    }, 30000);
}

// -------------------------------------------------------------
// Database Health & System Info
// -------------------------------------------------------------
async function checkDatabaseHealth() {
    const dbBadge = document.getElementById('dbStatusBadge');
    if (!dbBadge) return; // badge was removed from the page; the profile menu shows DB status instead

    try {
        const health = await API.getHealth();
        if (health.database && health.database.connected) {
            dbBadge.className = 'badge-pill-status connected';
            dbBadge.innerHTML = `<i class="bi bi-circle-fill text-success" style="font-size: 0.6rem;"></i> Connected Database: <strong>MySQL</strong>`;
        } else {
            dbBadge.className = 'badge-pill-status warning';
            dbBadge.innerHTML = `<i class="bi bi-exclamation-triangle-fill text-warning" style="font-size: 0.7rem;"></i> MySQL: Disconnected`;
        }
    } catch (error) {
        dbBadge.className = 'badge-pill-status warning';
        dbBadge.innerHTML = `<i class="bi bi-exclamation-triangle-fill text-danger" style="font-size: 0.7rem;"></i> Server Offline`;
    }
}

async function refreshDashboardStats() {
    try {
        const res = await API.getDashboardStats();
        if (res.success && res.counts) {
            const totalScheduledEl = document.getElementById('totalScheduledCount');
            if (totalScheduledEl) totalScheduledEl.textContent = res.counts.total_scheduled || 0;

            const statTotalAppts = document.getElementById('statTotalAppts');
            if (statTotalAppts) statTotalAppts.textContent = res.counts.total_scheduled || 0;

            const statTodayAppts = document.getElementById('statTodayAppts');
            if (statTodayAppts) statTodayAppts.textContent = res.counts.today_scheduled || 0;

            const statTotalPatients = document.getElementById('statTotalPatients');
            if (statTotalPatients) statTotalPatients.textContent = res.counts.total_patients || 0;

            const statActiveDoctors = document.getElementById('statActiveDoctors');
            if (statActiveDoctors) statActiveDoctors.textContent = res.counts.total_doctors || 0;

            const specialistsEl = document.getElementById('clinicOpsSpecialists');
            if (specialistsEl) specialistsEl.textContent = res.counts.total_doctors || 0;

            updateFlowCounts(res.visit_flow || []);
            loadDashboardUpcoming();
        }
    } catch (error) {
        console.warn('Could not refresh stats:', error.message);
    }
}

function updateFlowCounts(flowData) {
    const counts = {
        'Scheduled': 0,
        'Checked-In': 0,
        'In Consultation': 0,
        'Completed': 0
    };

    flowData.forEach(item => {
        if (counts.hasOwnProperty(item.status)) {
            counts[item.status] = item.count;
        }
    });

    const stepPreArrival = document.getElementById('flowCountPreArrival');
    if (stepPreArrival) stepPreArrival.textContent = counts['Scheduled'];

    const stepCheckIn = document.getElementById('flowCountCheckedIn');
    if (stepCheckIn) stepCheckIn.textContent = counts['Checked-In'];

    const stepConsultation = document.getElementById('flowCountConsultation');
    if (stepConsultation) stepConsultation.textContent = counts['In Consultation'];

    const stepCompleted = document.getElementById('flowCountCompleted');
    if (stepCompleted) {
        stepCompleted.textContent = (typeof AppState.visibleCompletedCount === 'number')
            ? AppState.visibleCompletedCount
            : counts['Completed'];
    }
}

// -------------------------------------------------------------
// Navigation & Views
// -------------------------------------------------------------
// Helper to navigate directly to any view
window.navigateToView = function (targetView) {
    const navLinks = document.querySelectorAll('.sidebar-nav .nav-link');
    const viewSections = document.querySelectorAll('.view-section');
    const pageTitle = document.getElementById('pageHeaderTitle');

    const titles = {
        'dashboard': 'Dashboard Overview',
        'patient-registration': 'Patient Registration & Records',
        'doctor-rosters': 'Doctor Rosters & Availability',
        'advance-scheduling': 'Patient Advance Scheduling & Pre-Arrival Flow',
        'visit-flow': 'Pre-Arrival & Visit Flow Pipeline',
        'analytics': 'Operations Analytics',
        'project-info': 'CSC 392: Software Dev SIWES Project'
    };

    navLinks.forEach(l => {
        if (l.getAttribute('data-view') === targetView) {
            l.classList.add('active');
        } else {
            l.classList.remove('active');
        }
    });

    viewSections.forEach(section => {
        section.classList.toggle('d-none', section.id !== `view-${targetView}`);
    });

    AppState.currentTab = targetView;
    if (pageTitle && titles[targetView]) {
        pageTitle.textContent = titles[targetView];
    }

    if (targetView === 'patient-registration') loadPatientsList();
    if (targetView === 'doctor-rosters') renderDoctorRosters();
    if (targetView === 'advance-scheduling') loadDailySchedule();
    if (targetView === 'visit-flow') refreshVisitFlow();
    if (targetView === 'analytics') refreshAnalytics();
};

function setupSidebarNavigation() {
    const navLinks = document.querySelectorAll('.sidebar-nav .nav-link');
    const viewSections = document.querySelectorAll('.view-section');
    const pageTitle = document.getElementById('pageHeaderTitle');

    const titles = {
        'dashboard': 'Dashboard Overview',
        'patient-registration': 'Patient Registration & Records',
        'doctor-rosters': 'Doctor Rosters & Availability',
        'advance-scheduling': 'Patient Advance Scheduling & Pre-Arrival Flow',
        'visit-flow': 'Pre-Arrival & Visit Flow Pipeline',
        'analytics': 'Operations Analytics',
        'project-info': 'CSC 392: Software Dev SIWES Project'
    };

    navLinks.forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const targetView = link.getAttribute('data-view');
            if (!targetView) return;

            navLinks.forEach(l => l.classList.remove('active'));
            link.classList.add('active');

            viewSections.forEach(section => {
                section.classList.toggle('d-none', section.id !== `view-${targetView}`);
            });

            AppState.currentTab = targetView;
            if (pageTitle && titles[targetView]) {
                pageTitle.textContent = titles[targetView];
            }

            // Trigger view-specific data loads
            if (targetView === 'patient-registration') loadPatientsList();
            if (targetView === 'doctor-rosters') renderDoctorRosters();
            if (targetView === 'advance-scheduling') loadDailySchedule();
            if (targetView === 'visit-flow') refreshVisitFlow();
            if (targetView === 'analytics') refreshAnalytics();

            // On mobile, collapse sidebar
            const sidebar = document.getElementById('appSidebar');
            if (window.innerWidth < 992 && sidebar) {
                sidebar.classList.remove('show');
            }
        });
    });

    // Sidebar Toggle button (desktop collapse & mobile drawer)
    const toggleBtn = document.getElementById('sidebarToggleBtn');
    const sidebar = document.getElementById('appSidebar');
    if (toggleBtn && sidebar) {
        toggleBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (window.innerWidth <= 992) {
                sidebar.classList.toggle('show');
            } else {
                sidebar.classList.toggle('collapsed');
            }
        });
    }

    // Close mobile sidebar on click outside
    document.addEventListener('click', (e) => {
        if (window.innerWidth <= 992 && sidebar && sidebar.classList.contains('show')) {
            if (!sidebar.contains(e.target) && e.target !== toggleBtn && !toggleBtn.contains(e.target)) {
                sidebar.classList.remove('show');
            }
        }
    });
}

// -------------------------------------------------------------
// Doctors Module
// -------------------------------------------------------------
async function loadDoctors() {
    try {
        // 1. Fetch active doctors for booking dropdown
        const activeRes = await API.getDoctors(false);
        if (activeRes.success && Array.isArray(activeRes.data)) {
            AppState.doctors = activeRes.data;
            populateDoctorSelect(activeRes.data);
        }

        // 2. Fetch all doctors (including inactive) for doctor rosters view
        const allRes = await API.getDoctors(true);
        if (allRes.success && Array.isArray(allRes.data)) {
            AppState.allDoctors = allRes.data;
            renderDoctorRosters();
        }
    } catch (error) {
        showToast('Failed to load doctors: ' + error.message, 'danger');
    }
}

function populateDoctorSelect(doctors) {
    const select = document.getElementById('bookingDoctorSelect');
    if (!select) return;

    select.innerHTML = '<option value="">-- Select Doctor --</option>';
    doctors.forEach(doc => {
        const opt = document.createElement('option');
        opt.value = doc.doctor_id;
        opt.textContent = `Dr. ${doc.first_name} ${doc.last_name} (${doc.specialty})`;
        select.appendChild(opt);
    });
}

function renderDoctorRosters() {
    const container = document.getElementById('doctorRosterList');
    if (!container) return;

    const list = AppState.allDoctors && AppState.allDoctors.length > 0
        ? AppState.allDoctors
        : AppState.doctors;

    if (!list || list.length === 0) {
        container.innerHTML = `<div class="p-4 text-center text-muted col-12">No doctors currently registered on the roster.</div>`;
        return;
    }

    container.innerHTML = list.map(doc => {
        const isActive = Boolean(Number(doc.is_active));
        const worksToday = Boolean(Number(doc.works_today));

        let badgeHtml;
        if (!isActive) {
            badgeHtml = `<span class="badge bg-secondary-subtle text-secondary border border-secondary-subtle"><i class="bi bi-pause-circle me-1"></i>Inactive / Off Duty</span>`;
        } else if (worksToday) {
            badgeHtml = `<span class="badge bg-success-subtle text-success border border-success-subtle"><i class="bi bi-check-circle me-1"></i>On Duty Today</span>`;
        } else {
            badgeHtml = `<span class="badge bg-warning-subtle text-warning-emphasis border border-warning-subtle"><i class="bi bi-moon me-1"></i>Active · Off Today</span>`;
        }

        const bookHtml = isActive
            ? `<button class="btn btn-sm btn-outline-primary" onclick="quickSelectDoctor(${doc.doctor_id})"><i class="bi bi-calendar-plus me-1"></i>Book</button>`
            : `<button class="btn btn-sm btn-light border text-muted" disabled title="Doctor is currently inactive"><i class="bi bi-slash-circle me-1"></i>Unavailable</button>`;

        const scheduleHtml = `<button class="btn btn-sm btn-outline-secondary" onclick="openDoctorScheduleModal(${doc.doctor_id})"><i class="bi bi-clock-history me-1"></i>Schedule</button>`;

        const toggleHtml = `<button class="btn btn-sm btn-light border ${isActive ? 'text-danger' : 'text-success'}" onclick="toggleDoctorActive(${doc.doctor_id})">${isActive ? 'Deactivate' : 'Activate'}</button>`;

        const initials = `${escapeHTML(doc.first_name[0] || '')}${escapeHTML(doc.last_name[0] || '')}`;

        return `
        <div class="col-md-6 col-lg-4 mb-3">
          <div class="card h-100 shadow-sm border-0" style="border-radius: 10px; ${!isActive ? 'opacity: 0.88; background: #faf9fd;' : ''}">
            <div class="card-body">
              <div class="d-flex align-items-center gap-3 mb-3">
                <div class="avatar-circle" style="width: 48px; height: 48px; font-size: 1.1rem; background-color: ${isActive ? '#5C8EC2' : '#94a3b8'};">
                  ${initials}
                </div>
                <div>
                  <h6 class="mb-0 fw-bold">Dr. ${escapeHTML(doc.first_name)} ${escapeHTML(doc.last_name)}</h6>
                  <span class="badge bg-primary-subtle text-primary border border-primary-subtle">${escapeHTML(doc.specialty)}</span>
                </div>
              </div>
              <p class="small text-muted mb-1"><i class="bi bi-telephone me-2"></i>${escapeHTML(doc.phone || 'N/A')}</p>
              <p class="small text-muted mb-2"><i class="bi bi-envelope me-2"></i>${escapeHTML(doc.email || 'N/A')}</p>
              <div class="border-top pt-2 mt-2">
                <div class="mb-2">${badgeHtml}</div>
                <div class="d-flex flex-wrap gap-2">${bookHtml}${scheduleHtml}${toggleHtml}</div>
              </div>
            </div>
          </div>
        </div>
      `;
    }).join('');
}

window.quickSelectDoctor = function (doctorId) {
    const select = document.getElementById('bookingDoctorSelect');
    if (select) {
        select.value = doctorId;
        select.dispatchEvent(new Event('change'));
    }
    // Switch to scheduling tab
    const schedulingTab = document.querySelector('[data-view="advance-scheduling"]');
    if (schedulingTab) schedulingTab.click();
};

// -------------------------------------------------------------
// Patient Search & Selection
// -------------------------------------------------------------
function setupPatientSearch() {
    const searchInput = document.getElementById('patientSearchInput');
    const resultsContainer = document.getElementById('patientSearchResults');
    const selectedBadge = document.getElementById('selectedPatientBadge');
    const clearBtn = document.getElementById('clearSelectedPatient');

    if (!searchInput || !resultsContainer) return;

    let debounceTimer = null;

    searchInput.addEventListener('input', (e) => {
        clearTimeout(debounceTimer);
        const query = e.target.value.trim();

        if (query.length < 1) {
            resultsContainer.classList.add('d-none');
            resultsContainer.innerHTML = '';
            return;
        }

        debounceTimer = setTimeout(async () => {
            try {
                const res = await API.getPatients(query);
                if (res.success && res.data.length > 0) {
                    resultsContainer.innerHTML = res.data.map(p => `
            <div class="search-result-item" data-id="${p.patient_id}">
              <div>
                <strong>${escapeHTML(p.first_name)} ${escapeHTML(p.last_name)}</strong>
                <span class="text-muted ms-2 small"><i class="bi bi-telephone"></i> ${escapeHTML(p.phone)}</span>
              </div>
              <span class="badge bg-light text-dark border">Select</span>
            </div>
          `).join('');
                    resultsContainer.classList.remove('d-none');

                    // Attach click listeners to items
                    resultsContainer.querySelectorAll('.search-result-item').forEach(item => {
                        item.addEventListener('click', () => {
                            const patientId = item.getAttribute('data-id');
                            const found = res.data.find(p => p.patient_id == patientId);
                            if (found) {
                                selectPatient(found);
                                resultsContainer.classList.add('d-none');
                                searchInput.value = '';
                            }
                        });
                    });
                } else {
                    resultsContainer.innerHTML = `
            <div class="p-3 text-center text-muted small">
              No matching patient found.
              <a href="#" class="text-primary fw-semibold d-block mt-1" onclick="openNewPatientModal('${query}')">+ Register "${query}"</a>
            </div>
          `;
                    resultsContainer.classList.remove('d-none');
                }
            } catch (err) {
                console.error(err);
            }
        }, 250);
    });

    // Hide dropdown on click outside
    document.addEventListener('click', (e) => {
        if (!searchInput.contains(e.target) && !resultsContainer.contains(e.target)) {
            resultsContainer.classList.add('d-none');
        }
    });

    if (clearBtn) {
        clearBtn.addEventListener('click', () => {
            AppState.selectedPatient = null;
            selectedBadge.classList.add('d-none');
        });
    }
}

function selectPatient(patient) {
    AppState.selectedPatient = patient;
    const selectedBadge = document.getElementById('selectedPatientBadge');
    const patientNameEl = document.getElementById('selectedPatientName');
    const patientPhoneEl = document.getElementById('selectedPatientPhone');

    if (selectedBadge && patientNameEl) {
        patientNameEl.textContent = `${patient.first_name} ${patient.last_name}`;
        if (patientPhoneEl) patientPhoneEl.textContent = patient.phone;
        selectedBadge.classList.remove('d-none');
    }
}

// -------------------------------------------------------------
// Appointment Scheduling & Conflict Checks
// -------------------------------------------------------------
function setupAppointmentForm() {
    const doctorSelect = document.getElementById('bookingDoctorSelect');
    const dateInput = document.getElementById('bookingDateInput');
    const form = document.getElementById('bookAppointmentForm');

    // Use Lagos WAT current date as default and minimum selectable date
    const todayStr = getLagosTodayString();
    if (dateInput) {
        dateInput.value = todayStr;
        dateInput.min = todayStr;
        AppState.selectedDate = todayStr;

        dateInput.addEventListener('change', (e) => {
            AppState.selectedDate = e.target.value;
            refreshAvailableSlots();
        });
    }

    if (doctorSelect) {
        doctorSelect.addEventListener('change', (e) => {
            AppState.selectedDoctor = e.target.value;
            refreshAvailableSlots();
        });
    }

    if (form) {
        form.addEventListener('submit', handleAppointmentBooking);
    }
}

async function refreshAvailableSlots() {
    const slotContainer = document.getElementById('slotSelectionGrid');
    const slotNotice = document.getElementById('slotSelectionNotice');
    if (!slotContainer) return;

    AppState.selectedSlot = null;

    if (!AppState.selectedDoctor || !AppState.selectedDate) {
        slotContainer.innerHTML = '';
        if (slotNotice) slotNotice.textContent = 'Please choose a doctor and appointment date to view available time slots.';
        return;
    }

    if (slotNotice) slotNotice.textContent = 'Loading doctor slots...';

    try {
        const res = await API.getDoctorSlots(AppState.selectedDoctor, AppState.selectedDate);
        if (res.success && res.data) {
            if (res.data.is_past_date) {
                slotContainer.innerHTML = `<div class="alert alert-warning py-2 px-3 small col-12 mb-0"><i class="bi bi-clock-history me-1"></i>Cannot book appointments for past dates.</div>`;
                if (slotNotice) slotNotice.textContent = 'Selected date has already passed.';
                return;
            }

            if (res.data.is_day_off) {
                slotContainer.innerHTML = `<div class="alert alert-secondary py-2 px-3 small col-12 mb-0"><i class="bi bi-calendar-x me-1"></i>${escapeHTML(res.data.message || 'Doctor is off duty on this day.')}</div>`;
                if (slotNotice) slotNotice.textContent = 'Doctor is off duty on this day.';
                return;
            }

            const slots = res.data.slots || [];
            AppState.availableSlots = slots;
            renderSlotGrid(slots);
            if (slotNotice) {
                const availableCount = slots.filter(s => s.is_available).length;
                slotNotice.innerHTML = `Found <strong>${availableCount}</strong> available slot(s) for the selected date.`;
            }
        }
    } catch (error) {
        if (slotNotice) slotNotice.innerHTML = `<span class="text-danger">Failed to load slots: ${escapeHTML(error.message)}</span>`;
    }
}

function renderSlotGrid(slots) {
    const container = document.getElementById('slotSelectionGrid');
    if (!container) return;

    if (slots.length === 0) {
        container.innerHTML = `<div class="text-muted small col-12 py-2">No working slots configured for this day.</div>`;
        return;
    }

    container.innerHTML = slots.map((slot, index) => {
        const labelText = escapeHTML(slot.label);
        if (slot.is_available) {
            return `
        <button type="button" class="slot-pill-btn" data-index="${index}">
          ${labelText}
        </button>
      `;
        } else {
            const reason = slot.is_past ? 'Time has passed' : 'Already Booked';
            return `
        <button type="button" class="slot-pill-btn booked" title="${reason}" disabled>
          ${labelText}
        </button>
      `;
        }
    }).join('');

    container.querySelectorAll('.slot-pill-btn:not(.booked)').forEach(btn => {
        btn.addEventListener('click', () => {
            container.querySelectorAll('.slot-pill-btn').forEach(b => b.classList.remove('selected'));
            btn.classList.add('selected');
            const idx = btn.getAttribute('data-index');
            AppState.selectedSlot = AppState.availableSlots[idx];
        });
    });
}

async function handleAppointmentBooking(e) {
    e.preventDefault();
    const alertContainer = document.getElementById('bookingAlertContainer');
    alertContainer.innerHTML = '';

    // Validation
    if (!AppState.selectedPatient) {
        showAlert(alertContainer, 'Please search and select a patient first.', 'warning');
        return;
    }

    if (!AppState.selectedDoctor) {
        showAlert(alertContainer, 'Please select a doctor.', 'warning');
        return;
    }

    if (!AppState.selectedDate) {
        showAlert(alertContainer, 'Please select an appointment date.', 'warning');
        return;
    }

    if (!AppState.selectedSlot) {
        showAlert(alertContainer, 'Please choose an available time slot.', 'warning');
        return;
    }

    const reasonInput = document.getElementById('bookingReasonInput');
    const notesInput = document.getElementById('bookingNotesInput');

    const payload = {
        patient_id: AppState.selectedPatient.patient_id,
        doctor_id: AppState.selectedDoctor,
        appointment_date: AppState.selectedDate,
        start_time: AppState.selectedSlot.start_time,
        end_time: AppState.selectedSlot.end_time,
        reason: reasonInput ? reasonInput.value.trim() : 'General Consultation',
        notes: notesInput ? notesInput.value.trim() : ''
    };

    const submitBtn = document.getElementById('submitBookingBtn');
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = `<span class="spinner-border spinner-border-sm me-2"></span>Booking...`;
    }

    try {
        const res = await API.createAppointment(payload);
        if (res.success) {
            showAlert(alertContainer, `✓ Appointment confirmed for ${res.data.patient_name} with ${res.data.doctor_name} at ${res.data.start_time_label}!`, 'success');
            showToast('Appointment successfully scheduled!', 'success');

            // Reset selection
            AppState.selectedSlot = null;
            if (reasonInput) reasonInput.value = '';
            if (notesInput) notesInput.value = '';

            // Reload slots, schedule table & dashboard stats
            await refreshAvailableSlots();
            await loadDailySchedule();
            await refreshDashboardStats();
            await refreshVisitFlow();
        }
    } catch (error) {
        // Check if error is double-booking conflict
        showAlert(alertContainer, error.message, 'danger');
        showToast(error.message, 'danger');
    } finally {
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerHTML = `<i class="bi bi-calendar-check me-2"></i>Confirm Appointment`;
        }
    }
}

function showAlert(container, message, type = 'info') {
    container.innerHTML = `
    <div class="alert alert-${type} alert-dismissible fade show d-flex align-items-center" role="alert">
      <i class="bi ${type === 'danger' ? 'bi-shield-exclamation' : type === 'success' ? 'bi-check-circle-fill' : 'bi-info-circle-fill'} me-2 fs-5"></i>
      <div>${message}</div>
      <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button>
    </div>
  `;
}

// -------------------------------------------------------------
// Daily Schedule Table
// -------------------------------------------------------------
async function loadDailySchedule(silent = false) {
    const tableBody = document.getElementById('dailyScheduleTableBody');
    const scheduleCountBadge = document.getElementById('dailyScheduleCount');
    if (!tableBody) return;

    const dateFilter = document.getElementById('scheduleDateFilter');
    const targetDate = dateFilter && dateFilter.value ? dateFilter.value : AppState.selectedDate;

    if (!silent) {
        tableBody.innerHTML = `
        <tr>
          <td colspan="4" class="text-center py-4 text-muted">
            <div class="spinner-border spinner-border-sm me-2" role="status"></div> Loading appointments...
          </td>
        </tr>
      `;
    }

    try {
        const res = await API.getAppointments({ date: targetDate });
        if (res.success) {
            const appointments = res.data;
            if (scheduleCountBadge) scheduleCountBadge.textContent = `${appointments.length} Scheduled`;

            if (appointments.length === 0) {
                tableBody.innerHTML = `
          <tr>
            <td colspan="4" class="text-center py-4 text-muted">
              <i class="bi bi-calendar-x fs-4 d-block mb-1"></i>
              No appointments scheduled for this date.
            </td>
          </tr>
        `;
                return;
            }

            tableBody.innerHTML = appointments.map(appt => {
                const badgeClass = getStatusBadgeClass(appt.status);
                const isTerm = appt.status === 'Completed' || appt.status === 'Cancelled' || appt.status === 'No-Show';
                return `
          <tr>
            <td>
              <div class="fw-bold">${escapeHTML(appt.patient_name)}</div>
              <div class="small text-muted"><i class="bi bi-telephone"></i> ${escapeHTML(appt.patient_phone || 'N/A')}</div>
            </td>
            <td>
              <div>${escapeHTML(formatDisplayDate(appt.appointment_date))}</div>
              <div class="small text-muted">${escapeHTML(appt.start_time_label)} - ${escapeHTML(appt.end_time_label)}</div>
              <div class="small text-primary fw-medium">${escapeHTML(appt.doctor_name)}</div>
            </td>
            <td>
              <span class="status-pill ${badgeClass}">${escapeHTML(appt.status)}</span>
            </td>
            <td class="text-end">
              <div class="dropdown">
                <button class="btn btn-sm btn-light border dropdown-toggle" type="button" data-bs-toggle="dropdown">
                  Action
                </button>
                <ul class="dropdown-menu dropdown-menu-end shadow-sm">
                  ${appt.status === 'Scheduled' ? `
                    <li><a class="dropdown-item" href="#" onclick="changeStatus(${appt.appointment_id}, 'Checked-In')"><i class="bi bi-box-arrow-in-right text-info me-2"></i>Check In</a></li>
                    <li><a class="dropdown-item text-warning" href="#" onclick="changeStatus(${appt.appointment_id}, 'No-Show')"><i class="bi bi-person-x me-2"></i>Mark No-Show</a></li>
                    <li><hr class="dropdown-divider"></li>
                    <li><a class="dropdown-item text-danger" href="#" onclick="changeStatus(${appt.appointment_id}, 'Cancelled')"><i class="bi bi-x-circle me-2"></i>Cancel Booking</a></li>
                  ` : ''}

                  ${appt.status === 'Checked-In' ? `
                    <li><a class="dropdown-item" href="#" onclick="changeStatus(${appt.appointment_id}, 'In Consultation')"><i class="bi bi-activity text-warning me-2"></i>Move to Consultation</a></li>
                    <li><hr class="dropdown-divider"></li>
                    <li><a class="dropdown-item text-danger" href="#" onclick="changeStatus(${appt.appointment_id}, 'Cancelled')"><i class="bi bi-x-circle me-2"></i>Cancel Booking</a></li>
                  ` : ''}

                  ${appt.status === 'In Consultation' ? `
                    <li><a class="dropdown-item" href="#" onclick="changeStatus(${appt.appointment_id}, 'Completed')"><i class="bi bi-check-circle text-success me-2"></i>Mark Completed</a></li>
                    <li><hr class="dropdown-divider"></li>
                    <li><a class="dropdown-item text-danger" href="#" onclick="changeStatus(${appt.appointment_id}, 'Cancelled')"><i class="bi bi-x-circle me-2"></i>Cancel Booking</a></li>
                  ` : ''}

                  ${isTerm ? `
                    <li><span class="dropdown-item text-muted disabled"><i class="bi bi-lock me-2"></i>Visit Concluded</span></li>
                  ` : ''}
                </ul>
              </div>
            </td>
          </tr>
        `;
            }).join('');
        }
    } catch (error) {
        tableBody.innerHTML = `<tr><td colspan="4" class="text-danger text-center py-3">Error loading schedule: ${error.message}</td></tr>`;
    }
}

function getStatusBadgeClass(status) {
    switch (status) {
        case 'Scheduled':
        case 'Confirmed':
            return 'status-confirmed';
        case 'Checked-In':
            return 'status-checked-in';
        case 'In Consultation':
        case 'In Progress':
            return 'status-in-progress';
        case 'Completed':
            return 'status-completed';
        case 'Cancelled':
            return 'status-cancelled';
        case 'No-Show':
            return 'status-no-show';
        default:
            return 'status-confirmed';
    }
}

function formatDisplayDate(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

window.changeStatus = async function (appointmentId, newStatus) {
    try {
        const res = await API.updateAppointmentStatus(appointmentId, newStatus);
        if (res.success) {
            showToast(`Appointment status updated to ${newStatus}`, 'success');
            await loadDailySchedule();
            await refreshDashboardStats();
            await refreshVisitFlow();
        }
    } catch (error) {
        showToast(`Failed to update status: ${error.message}`, 'danger');
    }
};

// -------------------------------------------------------------
// Notification Bell
// -------------------------------------------------------------
function setupNotificationBell() {
    const bellBtn = document.getElementById('notificationBellBtn');
    const bellDropdown = document.getElementById('notificationDropdown');
    const profileDropdown = document.getElementById('profileDropdown');
    if (!bellBtn || !bellDropdown) return;

    bellBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const isOpen = bellDropdown.classList.contains('show');
        // Close profile if open
        if (profileDropdown) profileDropdown.classList.remove('show');
        bellDropdown.classList.toggle('show', !isOpen);
        if (!isOpen) await loadNotifications();
    });
}

async function loadNotifications() {
    const listEl = document.getElementById('notificationList');
    const badgeEl = document.getElementById('notificationBadge');
    if (!listEl) return;

    try {
        const today = getLagosTodayString();
        const res = await API.getAppointments({ date: today, status: 'Scheduled' });
        const items = (res.success && res.data) ? res.data : [];

        // Update badge
        if (badgeEl) {
            if (items.length > 0) {
                badgeEl.textContent = items.length;
                badgeEl.style.display = 'flex';
            } else {
                badgeEl.style.display = 'none';
            }
        }

        if (items.length === 0) {
            listEl.innerHTML = `<div class="dropdown-panel-empty text-muted small"><i class="bi bi-calendar-check me-2"></i>No pre-arrival patients remaining today</div>`;
            return;
        }

        listEl.innerHTML = items.slice(0, 8).map(a => `
            <div class="notification-item">
                <div class="notification-item-icon"><i class="bi bi-person-walking"></i></div>
                <div>
                    <div class="fw-semibold">${escapeHTML(a.patient_name)}</div>
                    <div class="text-muted" style="font-size:0.78rem;"><i class="bi bi-clock me-1"></i>${escapeHTML(a.start_time_label)} - ${escapeHTML(a.end_time_label)} · ${escapeHTML(a.doctor_name)}</div>
                </div>
            </div>
        `).join('');

        if (items.length > 8) {
            listEl.innerHTML += `<div class="dropdown-panel-empty text-muted small">+${items.length - 8} more patients</div>`;
        }
    } catch (err) {
        listEl.innerHTML = `<div class="dropdown-panel-empty text-danger small">Could not load notifications</div>`;
    }
}

// -------------------------------------------------------------
// Profile Dropdown
// -------------------------------------------------------------
function setupProfileDropdown() {
    const profileBtn = document.getElementById('profileAvatarBtn');
    const profileDropdown = document.getElementById('profileDropdown');
    const bellDropdown = document.getElementById('notificationDropdown');
    if (!profileBtn || !profileDropdown) return;

    profileBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const isOpen = profileDropdown.classList.contains('show');
        if (bellDropdown) bellDropdown.classList.remove('show');
        profileDropdown.classList.toggle('show', !isOpen);
    });

    // "Project Info" link in profile dropdown
    const projectLink = document.getElementById('profileProjectLink');
    if (projectLink) {
        projectLink.addEventListener('click', (e) => {
            e.preventDefault();
            profileDropdown.classList.remove('show');
            window.navigateToView('project-info');
        });
    }

    // "Refresh System Data" in profile dropdown
    const refreshBtn = document.getElementById('profileRefreshBtn');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', async (e) => {
            e.preventDefault();
            profileDropdown.classList.remove('show');
            showToast('Refreshing system data…', 'primary');
            await refreshDashboardStats();
            await loadDailySchedule();
            await loadNotifications();
            showToast('System data refreshed', 'success');
        });
    }

    // Update profile DB status indicator
    const profileDbStatus = document.getElementById('profileDbStatus');
    if (profileDbStatus) {
        try {
            API.getHealth().then(h => {
                if (h.database && h.database.connected) {
                    profileDbStatus.textContent = 'Connected';
                    profileDbStatus.className = 'fw-semibold text-success';
                } else {
                    profileDbStatus.textContent = 'Disconnected';
                    profileDbStatus.className = 'fw-semibold text-danger';
                }
            });
        } catch (_) { }
    }
}

// Close both dropdowns on outside click
document.addEventListener('click', (e) => {
    const bell = document.getElementById('notificationDropdown');
    const profile = document.getElementById('profileDropdown');
    const bellBtn = document.getElementById('notificationBellBtn');
    const profileBtn = document.getElementById('profileAvatarBtn');

    if (bell && bell.classList.contains('show')) {
        if (!bell.contains(e.target) && e.target !== bellBtn && !bellBtn.contains(e.target)) {
            bell.classList.remove('show');
        }
    }
    if (profile && profile.classList.contains('show')) {
        if (!profile.contains(e.target) && e.target !== profileBtn && !profileBtn.contains(e.target)) {
            profile.classList.remove('show');
        }
    }
});

// -------------------------------------------------------------
// Analytics
// -------------------------------------------------------------
async function refreshAnalytics() {
    try {
        const res = await API.getDashboardStats();
        if (!res.success) return;

        // Status counts
        const statusMap = {};
        (res.visit_flow || []).forEach(item => { statusMap[item.status] = item.count; });

        const setEl = (id, val) => {
            const el = document.getElementById(id);
            if (el) el.textContent = val !== undefined ? val : 0;
        };

        setEl('analyticsScheduled', statusMap['Scheduled'] || 0);
        setEl('analyticsCheckedIn', statusMap['Checked-In'] || 0);
        setEl('analyticsInConsultation', statusMap['In Consultation'] || 0);
        setEl('analyticsCompleted', statusMap['Completed'] || 0);

        // Specialty breakdown
        renderSpecialtyBreakdown(res.specialty_distribution || []);
    } catch (err) {
        console.warn('Analytics refresh failed:', err.message);
    }
}

function renderSpecialtyBreakdown(data) {
    const tbody = document.getElementById('specialtyBreakdownBody');
    if (!tbody) return;

    if (!data || data.length === 0) {
        tbody.innerHTML = `<tr><td colspan="3" class="text-center text-muted py-3">No appointment data available</td></tr>`;
        return;
    }

    const maxCount = Math.max(...data.map(d => Number(d.count) || 0), 1);
    tbody.innerHTML = data.map(row => {
        const count = Number(row.count) || 0;
        const pct = Math.round((count / maxCount) * 100);
        return `
            <tr>
                <td class="fw-semibold">${escapeHTML(row.specialty || 'General')}</td>
                <td class="text-end fw-bold text-primary">${count}</td>
                <td>
                    <div class="d-flex align-items-center gap-2">
                        <div class="progress flex-grow-1" style="height:8px;border-radius:6px;background-color:#EBF3FB;">
                            <div class="progress-bar" style="width:${pct}%;background-color:var(--primary-sky);border-radius:6px;"></div>
                        </div>
                        <span class="small text-muted" style="min-width:30px;">${pct}%</span>
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}

// -------------------------------------------------------------
// Setup Date Filters
// -------------------------------------------------------------
function setupDateFilters() {
    const filter = document.getElementById('scheduleDateFilter');
    if (filter) {
        filter.value = getLagosTodayString();
        filter.addEventListener('change', () => {
            loadDailySchedule();
        });
    }
}

// -------------------------------------------------------------
// Visit Flow Module (Kanban / Step Progression)
// -------------------------------------------------------------
async function refreshVisitFlow() {
    const container = document.getElementById('visitFlowColumns');
    if (!container) return;

    try {
        const res = await API.getAppointments({ limit: 100 });
        if (res.success) {
            const appts = res.data;
            const cleared = getClearedCompletedIds();
            const allCompleted = appts.filter(a => a.status === 'Completed');
            const columns = {
                'Scheduled': appts.filter(a => a.status === 'Scheduled'),
                'Checked-In': appts.filter(a => a.status === 'Checked-In'),
                'In Consultation': appts.filter(a => a.status === 'In Consultation'),
                'Completed': allCompleted.filter(a => !cleared.has(a.appointment_id))
            };

            AppState.visibleCompletedCount = columns['Completed'].length;
            AppState.hiddenCompletedCount = allCompleted.length - columns['Completed'].length;
            const completedCountEl = document.getElementById('flowCountCompleted');
            if (completedCountEl) completedCountEl.textContent = AppState.visibleCompletedCount;

            renderVisitFlowColumns(columns);
        }
    } catch (err) {
        console.error('Visit flow refresh failed:', err);
    }
}

function renderVisitFlowColumns(columns) {
    const container = document.getElementById('visitFlowColumns');
    if (!container) return;

    const colConfigs = [
        { key: 'Scheduled', label: '1. Pre-Arrival / Scheduled', badge: 'bg-primary' },
        { key: 'Checked-In', label: '2. Arrived & Checked-In', badge: 'bg-info' },
        { key: 'In Consultation', label: '3. In Consultation / Triage', badge: 'bg-warning text-dark' },
        { key: 'Completed', label: '4. Visit Completed', badge: 'bg-dark' }
    ];

    container.innerHTML = colConfigs.map(cfg => {
        const items = columns[cfg.key] || [];
        const hiddenNote = (cfg.key === 'Completed' && AppState.hiddenCompletedCount > 0)
            ? `<div class="text-center pt-2"><a href="#" class="small text-decoration-none" onclick="showClearedCompleted(); return false;">Show ${AppState.hiddenCompletedCount} cleared</a></div>`
            : '';
        return `
      <div class="col-md-3 mb-3">
        <div class="card h-100 border-0 shadow-sm" style="background: #f8fafc; border-radius: 10px;">
          <div class="card-header bg-white border-bottom py-3 d-flex justify-content-between align-items-center">
            <h6 class="mb-0 fw-bold fs-6">${cfg.label}</h6>
            <span class="badge ${cfg.badge}">${items.length}</span>
          </div>
          <div class="card-body p-2" style="max-height: 480px; overflow-y: auto;">
            ${items.length === 0 ? `<div class="text-center py-4 text-muted small">No patients in this stage</div>` :
                items.map(a => `
                <div class="card mb-2 border shadow-none" style="border-radius: 8px;">
                  <div class="card-body p-2">
                    <div class="fw-bold text-dark">${escapeHTML(a.patient_name)}</div>
                    <div class="small text-muted"><i class="bi bi-clock"></i> ${escapeHTML(a.start_time_label)} - ${escapeHTML(a.end_time_label)} · ${escapeHTML(a.doctor_name)}</div>
                    <div class="small text-secondary mt-1"><i class="bi bi-chat-text"></i> ${escapeHTML(a.reason || 'Consultation')}</div>
                    <div class="d-flex justify-content-between align-items-center mt-2 pt-1 border-top">
                      <span class="small text-muted">${escapeHTML(formatDisplayDate(a.appointment_date))}</span>
                      <div class="btn-group btn-group-sm">
                        ${cfg.key === 'Scheduled' ? `
                          <button class="btn btn-xs btn-outline-info" onclick="changeStatus(${a.appointment_id}, 'Checked-In')">Check-In</button>
                          <button class="btn btn-xs btn-outline-warning" onclick="changeStatus(${a.appointment_id}, 'No-Show')">No-Show</button>
                        ` : ''}
                        ${cfg.key === 'Checked-In' ? `<button class="btn btn-xs btn-outline-warning" onclick="changeStatus(${a.appointment_id}, 'In Consultation')">Consult</button>` : ''}
                        ${cfg.key === 'In Consultation' ? `<button class="btn btn-xs btn-outline-success" onclick="changeStatus(${a.appointment_id}, 'Completed')">Complete</button>` : ''}
                      </div>
                    </div>
                  </div>
                </div>
              `).join('')
            }
            ${hiddenNote}
          </div>
        </div>
      </div>
    `;
    }).join('');
}

// -------------------------------------------------------------
// Patient Registration & List
// -------------------------------------------------------------
async function loadPatientsList() {
    const tbody = document.getElementById('patientRecordsTableBody');
    const countBadge = document.getElementById('patientRecordsCount');
    const searchInput = document.getElementById('patientRecordsSearchInput');
    if (!tbody) return;

    const q = searchInput ? searchInput.value.trim() : '';

    try {
        const res = await API.getPatients(q);
        if (res.success) {
            if (countBadge) countBadge.textContent = `${res.data.length} Registered Patients`;

            if (res.data.length === 0) {
                tbody.innerHTML = `<tr><td colspan="6" class="text-center py-4 text-muted">No patients found.</td></tr>`;
                return;
            }

            tbody.innerHTML = res.data.map(p => {
                const code = escapeHTML(p.patient_code || ('PT-' + String(p.patient_id).padStart(4, '0')));
                return `
        <tr>
          <td><span class="badge bg-primary-subtle text-primary border border-primary-subtle fw-semibold">${code}</span></td>
          <td class="fw-semibold">${escapeHTML(p.first_name)} ${escapeHTML(p.last_name)}</td>
          <td>${escapeHTML(p.phone || 'N/A')}</td>
          <td>${escapeHTML(p.email || 'N/A')}</td>
          <td>${escapeHTML(p.gender || 'N/A')}</td>
          <td>
            <div class="d-flex gap-1">
              <button class="btn btn-sm btn-outline-primary" onclick="bookForPatient(${p.patient_id})">
                <i class="bi bi-calendar-plus me-1"></i>Book
              </button>
              <button class="btn btn-sm btn-outline-secondary" onclick="viewPatientDetails(${p.patient_id})">
                <i class="bi bi-eye me-1"></i>View
              </button>
              <button class="btn btn-sm btn-outline-info" onclick="openEditPatientModalById(${p.patient_id})">
                <i class="bi bi-pencil-square me-1"></i>Edit
              </button>
            </div>
          </td>
        </tr>
      `;
            }).join('');
        }
    } catch (error) {
        tbody.innerHTML = `<tr><td colspan="6" class="text-danger text-center py-3">Failed to load patients: ${error.message}</td></tr>`;
    }
}

window.bookForPatient = async function (patientId) {
    try {
        const res = await API.getPatientById(patientId);
        if (res.success && res.data) {
            selectPatient(res.data);
            const schedulingTab = document.querySelector('[data-view="advance-scheduling"]');
            if (schedulingTab) schedulingTab.click();
        } else {
            showToast('Could not load patient record', 'danger');
        }
    } catch (err) {
        showToast('Failed to load patient: ' + err.message, 'danger');
    }
};


window.viewPatientDetails = async function (patientId) {
    try {
        const res = await API.getPatientById(patientId);
        if (!res.success || !res.data) {
            showToast('Could not load patient details', 'danger');
            return;
        }
        const p = res.data;

        document.getElementById('detailPatientName').textContent = `${p.first_name} ${p.last_name}`;
        document.getElementById('detailPatientGender').textContent = p.gender || '—';
        document.getElementById('detailPatientDob').textContent = p.date_of_birth
            ? new Date(p.date_of_birth + 'T00:00:00').toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' })
            : '—';
        document.getElementById('detailPatientPhone').textContent = p.phone || '—';
        document.getElementById('detailPatientEmail').textContent = p.email || '—';
        document.getElementById('detailPatientAddress').textContent = p.address || '—';
        document.getElementById('detailPatientEmergency').textContent = p.emergency_contact || '—';

        // Wire "Edit Patient" button
        const editBtn = document.getElementById('detailEditBtn');
        if (editBtn) {
            editBtn.onclick = () => {
                const detailsModal = document.getElementById('patientDetailsModal');
                const modalInstance = bootstrap.Modal.getInstance(detailsModal);

                if (modalInstance) {
                    modalInstance.hide();
                }

                detailsModal.addEventListener('hidden.bs.modal', function openEditForm() {
                    detailsModal.removeEventListener('hidden.bs.modal', openEditForm);
                    window.openEditPatientModal(p);
                }, { once: true });
            };
        }

        // Wire "Book Appointment" button
        const bookBtn = document.getElementById('detailBookBtn');
        if (bookBtn) {
            bookBtn.onclick = async () => {
                const modalEl = document.getElementById('patientDetailsModal');
                const modalInstance = bootstrap.Modal.getInstance(modalEl);
                if (modalInstance) modalInstance.hide();
                await bookForPatient(patientId);
            };
        }

        const modalEl = document.getElementById('patientDetailsModal');
        const modal = new bootstrap.Modal(modalEl);
        modal.show();
    } catch (err) {
        showToast('Failed to load patient details: ' + err.message, 'danger');
    }
};



function setupPatientRegistrationModal() {
    const form = document.getElementById('registerPatientForm');
    if (!form) return;

    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        const btn = form.querySelector('button[type="submit"]');
        if (btn) btn.disabled = true;

        const payload = {
            first_name: document.getElementById('regFirstName').value.trim(),
            last_name: document.getElementById('regLastName').value.trim(),
            phone: document.getElementById('regPhone').value.trim(),
            email: document.getElementById('regEmail').value.trim(),
            date_of_birth: document.getElementById('regDob').value || null,
            gender: document.getElementById('regGender').value || null,
            address: document.getElementById('regAddress').value.trim() || null,
            emergency_contact: document.getElementById('regEmergencyContact').value.trim() || null
        };

        // Frontend validation
        const missing = [];
        if (!payload.first_name) missing.push('First Name');
        if (!payload.last_name) missing.push('Last Name');
        if (!payload.phone) missing.push('Phone Number');
        if (!payload.email) missing.push('Email Address');
        if (!payload.date_of_birth) missing.push('Date of Birth');
        if (!payload.gender) missing.push('Gender');
        if (!payload.address) missing.push('Residential Address');
        if (!payload.emergency_contact) missing.push('Emergency Contact');

        if (missing.length > 0) {
            showToast(`All fields are required. Please fill: ${missing.join(', ')}`, 'danger');
            if (btn) btn.disabled = false;
            return;
        }

        try {
            const res = await API.createPatient(payload);

            if (res.success) {
                const code = res.data.patient_code || ('PT-' + String(res.data.patient_id).padStart(4, '0'));
                showToast(
                    `Patient ${res.data.first_name} ${res.data.last_name} registered successfully! Patient ID: ${code}`,
                    'success'
                );

                form.reset();

                const modalEl = document.getElementById('registerPatientModal');
                const modalInstance = bootstrap.Modal.getInstance(modalEl);
                if (modalInstance) modalInstance.hide();

                selectPatient(res.data);

                await refreshDashboardStats();
                await loadPatientsList();
            } else {
                showToast(res.message || res.error || 'Could not save patient details', 'danger');
            }
        } catch (error) {
            showToast(`Registration failed: ${error.message}`, 'danger');
        } finally {
            if (btn) btn.disabled = false;
        }
    });

    // Patient Records Search Filter
    const patientSearch = document.getElementById('patientRecordsSearchInput');
    if (patientSearch) {
        let timer = null;
        patientSearch.addEventListener('input', () => {
            clearTimeout(timer);
            timer = setTimeout(loadPatientsList, 300);
        });
    }
}

function setupEditPatientModal() {
    const form = document.getElementById('editPatientForm');
    if (!form) return;

    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        const btn = form.querySelector('button[type="submit"]');
        if (btn) btn.disabled = true;

        const patientId = document.getElementById('editPatientId').value;
        const payload = {
            first_name: document.getElementById('editFirstName').value.trim(),
            last_name: document.getElementById('editLastName').value.trim(),
            phone: document.getElementById('editPhone').value.trim(),
            email: document.getElementById('editEmail').value.trim(),
            date_of_birth: document.getElementById('editDob').value || null,
            gender: document.getElementById('editGender').value || null,
            address: document.getElementById('editAddress').value.trim() || null,
            emergency_contact: document.getElementById('editEmergencyContact').value.trim() || null
        };

        const missing = [];
        if (!payload.first_name) missing.push('First Name');
        if (!payload.last_name) missing.push('Last Name');
        if (!payload.phone) missing.push('Phone Number');
        if (!payload.email) missing.push('Email Address');
        if (!payload.date_of_birth) missing.push('Date of Birth');
        if (!payload.gender) missing.push('Gender');
        if (!payload.address) missing.push('Residential Address');
        if (!payload.emergency_contact) missing.push('Emergency Contact');

        if (missing.length > 0) {
            showToast(`All fields are required. Missing: ${missing.join(', ')}`, 'danger');
            if (btn) btn.disabled = false;
            return;
        }

        try {
            const res = await API.updatePatient(patientId, payload);
            if (res.success) {
                const code = res.data.patient_code || ('PT-' + String(res.data.patient_id).padStart(4, '0'));
                showToast(`Patient ${res.data.first_name} ${res.data.last_name} (${code}) updated successfully!`, 'success');

                const modalEl = document.getElementById('editPatientModal');
                const modalInstance = bootstrap.Modal.getInstance(modalEl);
                if (modalInstance) modalInstance.hide();

                // If currently selected for booking, update selected patient
                if (AppState.selectedPatient && AppState.selectedPatient.patient_id === Number(patientId)) {
                    selectPatient(res.data);
                }

                await loadPatientsList();
            } else {
                showToast(res.message || res.error || 'Failed to update patient profile', 'danger');
            }
        } catch (error) {
            showToast(`Update failed: ${error.message}`, 'danger');
        } finally {
            if (btn) btn.disabled = false;
        }
    });
}

window.openNewPatientModal = function (prefillName = '') {
    const form = document.getElementById('registerPatientForm');
    if (form) form.reset();

    if (prefillName) {
        const parts = prefillName.split(' ');
        const first = parts[0] || '';
        const last = parts.slice(1).join(' ') || '';
        const fnInput = document.getElementById('regFirstName');
        const lnInput = document.getElementById('regLastName');
        if (fnInput) fnInput.value = first;
        if (lnInput) lnInput.value = last;
    }
    const modalEl = document.getElementById('registerPatientModal');
    if (modalEl) {
        const modal = new bootstrap.Modal(modalEl);
        modal.show();
    }
};

window.openEditPatientModal = function (patient) {
    if (!patient) return;

    document.getElementById('editPatientId').value = patient.patient_id;
    const code = patient.patient_code || ('PT-' + String(patient.patient_id).padStart(4, '0'));
    const codeTitleEl = document.getElementById('editPatientCodeTitle');
    if (codeTitleEl) codeTitleEl.textContent = code;

    document.getElementById('editFirstName').value = patient.first_name || '';
    document.getElementById('editLastName').value = patient.last_name || '';
    document.getElementById('editPhone').value = patient.phone || '';
    document.getElementById('editEmail').value = patient.email || '';
    document.getElementById('editDob').value = patient.date_of_birth
        ? String(patient.date_of_birth).split('T')[0].split(' ')[0]
        : '';
    document.getElementById('editGender').value = patient.gender || '';
    document.getElementById('editAddress').value = patient.address || '';
    document.getElementById('editEmergencyContact').value = patient.emergency_contact || '';

    const modalEl = document.getElementById('editPatientModal');
    if (modalEl) {
        const modal = new bootstrap.Modal(modalEl);
        modal.show();
    }
};

window.openEditPatientModalById = async function (patientId) {
    try {
        const res = await API.getPatientById(patientId);
        if (res.success && res.data) {
            window.openEditPatientModal(res.data);
        } else {
            showToast('Could not load patient profile for editing', 'danger');
        }
    } catch (err) {
        showToast('Error loading patient: ' + err.message, 'danger');
    }
};


// -------------------------------------------------------------
// Toast Notification Utility
// -------------------------------------------------------------
function showToast(message, type = 'primary') {
    const toastContainer = document.getElementById('toastContainer');
    if (!toastContainer) return;

    const toastId = 'toast-' + Date.now();
    const icon = type === 'success' ? 'bi-check-circle-fill' : type === 'danger' ? 'bi-exclamation-triangle-fill' : 'bi-info-circle-fill';
    const bgClass = type === 'success' ? 'text-bg-success' : type === 'danger' ? 'text-bg-danger' : 'text-bg-dark';

    const toastHtml = `
    <div id="${toastId}" class="toast align-items-center ${bgClass} border-0 mb-2 shadow" role="alert" aria-live="assertive" aria-atomic="true">
      <div class="d-flex">
        <div class="toast-body d-flex align-items-center gap-2">
          <i class="bi ${icon}"></i>
          <span>${message}</span>
        </div>
        <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast" aria-label="Close"></button>
      </div>
    </div>
  `;

    toastContainer.insertAdjacentHTML('beforeend', toastHtml);
    const toastElement = document.getElementById(toastId);
    const bsToast = new bootstrap.Toast(toastElement, { delay: 4500 });
    bsToast.show();

    toastElement.addEventListener('hidden.bs.toast', () => {
        toastElement.remove();
    });
}


// -------------------------------------------------------------
// Doctor Management: Add Doctor, Activate/Deactivate, Weekly Schedule
// -------------------------------------------------------------
window.openAddDoctorModal = function () {
    const form = document.getElementById('addDoctorForm');
    if (form) form.reset();
    bootstrap.Modal.getOrCreateInstance(document.getElementById('addDoctorModal')).show();
};

window.toggleDoctorActive = async function (doctorId) {
    try {
        const res = await API.toggleDoctorActive(doctorId);
        showToast(res.message || 'Doctor status updated', 'success');
        await loadDoctors();
        await refreshDashboardStats();
    } catch (error) {
        showToast('Could not update doctor: ' + error.message, 'danger');
    }
};

// MySQL DAYOFWEEK numbers: 1 = Sunday, 2 = Monday ... 7 = Saturday
const WEEK_DAYS = [
    { label: 'Monday', value: 2 },
    { label: 'Tuesday', value: 3 },
    { label: 'Wednesday', value: 4 },
    { label: 'Thursday', value: 5 },
    { label: 'Friday', value: 6 },
    { label: 'Saturday', value: 7 },
    { label: 'Sunday', value: 1 }
];

window.openDoctorScheduleModal = async function (doctorId) {
    const allDocs = (AppState.allDoctors && AppState.allDoctors.length > 0) ? AppState.allDoctors : AppState.doctors;
    const doc = allDocs.find(d => Number(d.doctor_id) === Number(doctorId));
    if (!doc) return;

    try {
        const res = await API.getDoctorSchedules(doctorId);
        const rows = (res.success && Array.isArray(res.data)) ? res.data : [];

        document.getElementById('schedDoctorId').value = doctorId;
        document.getElementById('schedDoctorName').textContent = `Dr. ${doc.first_name} ${doc.last_name}`;
        document.getElementById('schedDoctorSpecialty').textContent = doc.specialty;

        document.getElementById('schedTableBody').innerHTML = WEEK_DAYS.map(day => {
            const s = rows.find(r => Number(r.day_of_week) === day.value);
            const working = s ? Boolean(Number(s.is_available)) : false;
            const start = s ? String(s.start_time).slice(0, 5) : '09:00';
            const end = s ? String(s.end_time).slice(0, 5) : '17:00';
            const slot = s && s.slot_duration_minutes ? s.slot_duration_minutes : 45;
            return `
            <tr data-day="${day.value}" data-slot="${slot}">
              <td class="fw-semibold">${day.label}</td>
              <td>
                <div class="form-check form-switch">
                  <input class="form-check-input sched-working" type="checkbox" ${working ? 'checked' : ''}>
                </div>
              </td>
              <td><input type="time" class="form-control form-control-sm sched-start" value="${start}"></td>
              <td><input type="time" class="form-control form-control-sm sched-end" value="${end}"></td>
            </tr>`;
        }).join('');

        bootstrap.Modal.getOrCreateInstance(document.getElementById('doctorScheduleModal')).show();
    } catch (error) {
        showToast('Could not load schedule: ' + error.message, 'danger');
    }
};

document.addEventListener('submit', async (e) => {
    // ---- Add Doctor form ----
    if (e.target.id === 'addDoctorForm') {
        e.preventDefault();
        const val = (id) => document.getElementById(id).value.trim();
        const payload = {
            first_name: val('addDocFirstName'),
            last_name: val('addDocLastName'),
            specialty: val('addDocSpecialty'),
            phone: val('addDocPhone'),
            email: val('addDocEmail')
        };

        const btn = e.target.querySelector('button[type="submit"]');
        if (btn) btn.disabled = true;
        try {
            const res = await API.createDoctor(payload);
            if (res.success) {
                showToast(res.message || 'Doctor added to the roster', 'success');
                const modalInstance = bootstrap.Modal.getInstance(document.getElementById('addDoctorModal'));
                if (modalInstance) modalInstance.hide();
                await loadDoctors();
                await refreshDashboardStats();
            }
        } catch (error) {
            showToast('Could not add doctor: ' + error.message, 'danger');
        } finally {
            if (btn) btn.disabled = false;
        }
        return;
    }

    // ---- Weekly Schedule form ----
    if (e.target.id === 'doctorScheduleForm') {
        e.preventDefault();
        const doctorId = document.getElementById('schedDoctorId').value;
        const schedules = [];

        for (const row of document.querySelectorAll('#schedTableBody tr')) {
            const working = row.querySelector('.sched-working').checked;
            const start = row.querySelector('.sched-start').value || '09:00';
            const end = row.querySelector('.sched-end').value || '17:00';
            if (working && end <= start) {
                showToast('Shift end time must be after the start time on working days.', 'danger');
                return;
            }
            schedules.push({
                day_of_week: Number(row.getAttribute('data-day')),
                start_time: start + ':00',
                end_time: end + ':00',
                slot_duration_minutes: Number(row.getAttribute('data-slot')) || 45,
                is_available: working
            });
        }

        const btn = e.target.querySelector('button[type="submit"]');
        if (btn) btn.disabled = true;
        try {
            const res = await API.updateDoctorSchedules(doctorId, schedules);
            if (res.success) {
                showToast(res.message || 'Schedule updated', 'success');
                const modalInstance = bootstrap.Modal.getInstance(document.getElementById('doctorScheduleModal'));
                if (modalInstance) modalInstance.hide();
                await loadDoctors();
            }
        } catch (error) {
            showToast('Could not update schedule: ' + error.message, 'danger');
        } finally {
            if (btn) btn.disabled = false;
        }
    }
});

// -------------------------------------------------------------
// Refresh Flow button (with visible feedback)
// -------------------------------------------------------------
// Completed visits that were "cleared" from the board. The records stay in the database
// (and in Analytics); they are just hidden from the Visit Completed column.
function getClearedCompletedIds() {
    try {
        return new Set(JSON.parse(localStorage.getItem('flowClearedCompletedIds') || '[]'));
    } catch (_) {
        return new Set(AppState.clearedFallback || []);
    }
}

function saveClearedCompletedIds(idSet) {
    AppState.clearedFallback = [...idSet];
    try {
        localStorage.setItem('flowClearedCompletedIds', JSON.stringify([...idSet]));
    } catch (_) { /* storage unavailable: kept in memory for this session */ }
}

window.manualRefreshFlow = async function (btn) {
    const original = btn ? btn.innerHTML : '';
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Refreshing...';
    }
    try {
        // Load the latest data (this also lets the server finish any consultations that are due),
        // then clear every completed visit from the board
        const res = await API.getAppointments({ limit: 100 });
        let clearedNow = 0;
        if (res.success) {
            const cleared = getClearedCompletedIds();
            res.data.filter(a => a.status === 'Completed').forEach(a => {
                if (!cleared.has(a.appointment_id)) clearedNow++;
                cleared.add(a.appointment_id);
            });
            saveClearedCompletedIds(cleared);
        }
        await refreshVisitFlow();
        await refreshDashboardStats();
        showToast(clearedNow > 0
            ? `Visit flow refreshed. ${clearedNow} completed visit(s) cleared from the board (records are kept).`
            : 'Visit flow refreshed.', 'success');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = original;
        }
    }
};

// Bring back completed visits that were cleared from the board
window.showClearedCompleted = async function () {
    saveClearedCompletedIds(new Set());
    await refreshVisitFlow();
};

// -------------------------------------------------------------
// Dashboard: Today's Upcoming Appointments table
// -------------------------------------------------------------
async function loadDashboardUpcoming() {
    const tbody = document.getElementById('dashboardUpcomingTableBody');
    if (!tbody) return;

    try {
        const res = await API.getAppointments({ date: getLagosTodayString() });
        const items = (res.success && res.data) ? res.data : [];

        if (items.length === 0) {
            tbody.innerHTML = `<tr><td colspan="5" class="text-center py-3 text-muted"><i class="bi bi-calendar-x me-1"></i>No appointments scheduled for today.</td></tr>`;
            return;
        }

        tbody.innerHTML = items.map(a => {
            let action = '<span class="text-muted small">—</span>';
            if (a.status === 'Scheduled') {
                action = `<button class="btn btn-sm btn-outline-info" onclick="changeStatus(${a.appointment_id}, 'Checked-In')">Check In</button>`;
            } else if (a.status === 'Checked-In') {
                action = `<button class="btn btn-sm btn-outline-warning" onclick="changeStatus(${a.appointment_id}, 'In Consultation')">Start Consultation</button>`;
            } else if (a.status === 'In Consultation') {
                action = `<button class="btn btn-sm btn-outline-success" onclick="changeStatus(${a.appointment_id}, 'Completed')">Complete</button>`;
            }

            return `
            <tr>
              <td class="fw-semibold">${escapeHTML(a.patient_name)}</td>
              <td>${escapeHTML(a.doctor_name)}${a.doctor_specialty ? `<div class="small text-muted">${escapeHTML(a.doctor_specialty)}</div>` : ''}</td>
              <td>${escapeHTML(a.start_time_label)} – ${escapeHTML(a.end_time_label)}</td>
              <td><span class="status-pill ${getStatusBadgeClass(a.status)}">${escapeHTML(a.status)}</span></td>
              <td>${action}</td>
            </tr>`;
        }).join('');
    } catch (error) {
        tbody.innerHTML = `<tr><td colspan="5" class="text-danger text-center py-3">Could not load today's schedule: ${escapeHTML(error.message)}</td></tr>`;
    }
} document.getElementById('scheduleDateFilter');
const targetDate = dateFilter && dateFilter.value ? dateFilter.value : AppState.selectedDate;

tableBody.innerHTML = `
    <tr>
      <td colspan="4" class="text-center py-4 text-muted">
        <div class="spinner-border spinner-border-sm me-2" role="status"></div> Loading appointments...
      </td>
    </tr>
  `;

try {
    const res = await API.getAppointments({ date: targetDate });
    if (res.success) {
        const appointments = res.data;
        if (scheduleCountBadge) scheduleCountBadge.textContent = `${appointments.length} Scheduled`;

        if (appointments.length === 0) {
            tableBody.innerHTML = `
          <tr>
            <td colspan="4" class="text-center py-4 text-muted">
              <i class="bi bi-calendar-x fs-4 d-block mb-1"></i>
              No appointments scheduled for this date.
            </td>
          </tr>
        `;
            return;
        }

        tableBody.innerHTML = appointments.map(appt => {
            const badgeClass = getStatusBadgeClass(appt.status);
            const isTerm = appt.status === 'Completed' || appt.status === 'Cancelled' || appt.status === 'No-Show';
            return `
          <tr>
            <td>
              <div class="fw-bold">${escapeHTML(appt.patient_name)}</div>
              <div class="small text-muted"><i class="bi bi-telephone"></i> ${escapeHTML(appt.patient_phone || 'N/A')}</div>
            </td>
            <td>
              <div>${escapeHTML(formatDisplayDate(appt.appointment_date))}</div>
              <div class="small text-muted">${escapeHTML(appt.start_time_label)} - ${escapeHTML(appt.end_time_label)}</div>
              <div class="small text-primary fw-medium">${escapeHTML(appt.doctor_name)}</div>
            </td>
            <td>
              <span class="status-pill ${badgeClass}">${escapeHTML(appt.status)}</span>
            </td>
            <td class="text-end">
              <div class="dropdown">
                <button class="btn btn-sm btn-light border dropdown-toggle" type="button" data-bs-toggle="dropdown">
                  Action
                </button>
                <ul class="dropdown-menu dropdown-menu-end shadow-sm">
                  ${appt.status === 'Scheduled' ? `
                    <li><a class="dropdown-item" href="#" onclick="changeStatus(${appt.appointment_id}, 'Checked-In')"><i class="bi bi-box-arrow-in-right text-info me-2"></i>Check In</a></li>
                    <li><a class="dropdown-item text-warning" href="#" onclick="changeStatus(${appt.appointment_id}, 'No-Show')"><i class="bi bi-person-x me-2"></i>Mark No-Show</a></li>
                    <li><hr class="dropdown-divider"></li>
                    <li><a class="dropdown-item text-danger" href="#" onclick="changeStatus(${appt.appointment_id}, 'Cancelled')"><i class="bi bi-x-circle me-2"></i>Cancel Booking</a></li>
                  ` : ''}

                  ${appt.status === 'Checked-In' ? `
                    <li><a class="dropdown-item" href="#" onclick="changeStatus(${appt.appointment_id}, 'In Consultation')"><i class="bi bi-activity text-warning me-2"></i>Move to Consultation</a></li>
                    <li><hr class="dropdown-divider"></li>
                    <li><a class="dropdown-item text-danger" href="#" onclick="changeStatus(${appt.appointment_id}, 'Cancelled')"><i class="bi bi-x-circle me-2"></i>Cancel Booking</a></li>
                  ` : ''}

                  ${appt.status === 'In Consultation' ? `
                    <li><a class="dropdown-item" href="#" onclick="changeStatus(${appt.appointment_id}, 'Completed')"><i class="bi bi-check-circle text-success me-2"></i>Mark Completed</a></li>
                    <li><hr class="dropdown-divider"></li>
                    <li><a class="dropdown-item text-danger" href="#" onclick="changeStatus(${appt.appointment_id}, 'Cancelled')"><i class="bi bi-x-circle me-2"></i>Cancel Booking</a></li>
                  ` : ''}

                  ${isTerm ? `
                    <li><span class="dropdown-item text-muted disabled"><i class="bi bi-lock me-2"></i>Visit Concluded</span></li>
                  ` : ''}
                </ul>
              </div>
            </td>
          </tr>
        `;
        }).join('');
    }
} catch (error) {
    tableBody.innerHTML = `<tr><td colspan="4" class="text-danger text-center py-3">Error loading schedule: ${error.message}</td></tr>`;
}
}

function getStatusBadgeClass(status) {
    switch (status) {
        case 'Scheduled':
        case 'Confirmed':
            return 'status-confirmed';
        case 'Checked-In':
            return 'status-checked-in';
        case 'In Consultation':
        case 'In Progress':
            return 'status-in-progress';
        case 'Completed':
            return 'status-completed';
        case 'Cancelled':
            return 'status-cancelled';
        case 'No-Show':
            return 'status-no-show';
        default:
            return 'status-confirmed';
    }
}

function formatDisplayDate(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

window.changeStatus = async function (appointmentId, newStatus) {
    try {
        const res = await API.updateAppointmentStatus(appointmentId, newStatus);
        if (res.success) {
            showToast(`Appointment status updated to ${newStatus}`, 'success');
            await loadDailySchedule();
            await refreshDashboardStats();
            await refreshVisitFlow();
        }
    } catch (error) {
        showToast(`Failed to update status: ${error.message}`, 'danger');
    }
};

// -------------------------------------------------------------
// Notification Bell
// -------------------------------------------------------------
function setupNotificationBell() {
    const bellBtn = document.getElementById('notificationBellBtn');
    const bellDropdown = document.getElementById('notificationDropdown');
    const profileDropdown = document.getElementById('profileDropdown');
    if (!bellBtn || !bellDropdown) return;

    bellBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const isOpen = bellDropdown.classList.contains('show');
        // Close profile if open
        if (profileDropdown) profileDropdown.classList.remove('show');
        bellDropdown.classList.toggle('show', !isOpen);
        if (!isOpen) await loadNotifications();
    });
}

async function loadNotifications() {
    const listEl = document.getElementById('notificationList');
    const badgeEl = document.getElementById('notificationBadge');
    if (!listEl) return;

    try {
        const today = getLagosTodayString();
        const res = await API.getAppointments({ date: today, status: 'Scheduled' });
        const items = (res.success && res.data) ? res.data : [];

        // Update badge
        if (badgeEl) {
            if (items.length > 0) {
                badgeEl.textContent = items.length;
                badgeEl.style.display = 'flex';
            } else {
                badgeEl.style.display = 'none';
            }
        }

        if (items.length === 0) {
            listEl.innerHTML = `<div class="dropdown-panel-empty text-muted small"><i class="bi bi-calendar-check me-2"></i>No pre-arrival patients remaining today</div>`;
            return;
        }

        listEl.innerHTML = items.slice(0, 8).map(a => `
            <div class="notification-item">
                <div class="notification-item-icon"><i class="bi bi-person-walking"></i></div>
                <div>
                    <div class="fw-semibold">${escapeHTML(a.patient_name)}</div>
                    <div class="text-muted" style="font-size:0.78rem;"><i class="bi bi-clock me-1"></i>${escapeHTML(a.start_time_label)} - ${escapeHTML(a.end_time_label)} · ${escapeHTML(a.doctor_name)}</div>
                </div>
            </div>
        `).join('');

        if (items.length > 8) {
            listEl.innerHTML += `<div class="dropdown-panel-empty text-muted small">+${items.length - 8} more patients</div>`;
        }
    } catch (err) {
        listEl.innerHTML = `<div class="dropdown-panel-empty text-danger small">Could not load notifications</div>`;
    }
}

// -------------------------------------------------------------
// Profile Dropdown
// -------------------------------------------------------------
function setupProfileDropdown() {
    const profileBtn = document.getElementById('profileAvatarBtn');
    const profileDropdown = document.getElementById('profileDropdown');
    const bellDropdown = document.getElementById('notificationDropdown');
    if (!profileBtn || !profileDropdown) return;

    profileBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const isOpen = profileDropdown.classList.contains('show');
        if (bellDropdown) bellDropdown.classList.remove('show');
        profileDropdown.classList.toggle('show', !isOpen);
    });

    // "Project Info" link in profile dropdown
    const projectLink = document.getElementById('profileProjectLink');
    if (projectLink) {
        projectLink.addEventListener('click', (e) => {
            e.preventDefault();
            profileDropdown.classList.remove('show');
            window.navigateToView('project-info');
        });
    }

    // "Refresh System Data" in profile dropdown
    const refreshBtn = document.getElementById('profileRefreshBtn');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', async (e) => {
            e.preventDefault();
            profileDropdown.classList.remove('show');
            showToast('Refreshing system data…', 'primary');
            await refreshDashboardStats();
            await loadDailySchedule();
            await loadNotifications();
            showToast('System data refreshed', 'success');
        });
    }

    // Update profile DB status indicator
    const profileDbStatus = document.getElementById('profileDbStatus');
    if (profileDbStatus) {
        try {
            API.getHealth().then(h => {
                if (h.database && h.database.connected) {
                    profileDbStatus.textContent = 'Connected';
                    profileDbStatus.className = 'fw-semibold text-success';
                } else {
                    profileDbStatus.textContent = 'Disconnected';
                    profileDbStatus.className = 'fw-semibold text-danger';
                }
            });
        } catch (_) { }
    }
}

// Close both dropdowns on outside click
document.addEventListener('click', (e) => {
    const bell = document.getElementById('notificationDropdown');
    const profile = document.getElementById('profileDropdown');
    const bellBtn = document.getElementById('notificationBellBtn');
    const profileBtn = document.getElementById('profileAvatarBtn');

    if (bell && bell.classList.contains('show')) {
        if (!bell.contains(e.target) && e.target !== bellBtn && !bellBtn.contains(e.target)) {
            bell.classList.remove('show');
        }
    }
    if (profile && profile.classList.contains('show')) {
        if (!profile.contains(e.target) && e.target !== profileBtn && !profileBtn.contains(e.target)) {
            profile.classList.remove('show');
        }
    }
});

// -------------------------------------------------------------
// Analytics
// -------------------------------------------------------------
async function refreshAnalytics() {
    try {
        const res = await API.getDashboardStats();
        if (!res.success) return;

        // Status counts
        const statusMap = {};
        (res.visit_flow || []).forEach(item => { statusMap[item.status] = item.count; });

        const setEl = (id, val) => {
            const el = document.getElementById(id);
            if (el) el.textContent = val !== undefined ? val : 0;
        };

        setEl('analyticsScheduled', statusMap['Scheduled'] || 0);
        setEl('analyticsCheckedIn', statusMap['Checked-In'] || 0);
        setEl('analyticsInConsultation', statusMap['In Consultation'] || 0);
        setEl('analyticsCompleted', statusMap['Completed'] || 0);

        // Specialty breakdown
        renderSpecialtyBreakdown(res.specialty_distribution || []);
    } catch (err) {
        console.warn('Analytics refresh failed:', err.message);
    }
}

function renderSpecialtyBreakdown(data) {
    const tbody = document.getElementById('specialtyBreakdownBody');
    if (!tbody) return;

    if (!data || data.length === 0) {
        tbody.innerHTML = `<tr><td colspan="3" class="text-center text-muted py-3">No appointment data available</td></tr>`;
        return;
    }

    const maxCount = Math.max(...data.map(d => Number(d.count) || 0), 1);
    tbody.innerHTML = data.map(row => {
        const count = Number(row.count) || 0;
        const pct = Math.round((count / maxCount) * 100);
        return `
            <tr>
                <td class="fw-semibold">${escapeHTML(row.specialty || 'General')}</td>
                <td class="text-end fw-bold text-primary">${count}</td>
                <td>
                    <div class="d-flex align-items-center gap-2">
                        <div class="progress flex-grow-1" style="height:8px;border-radius:6px;background-color:#EBF3FB;">
                            <div class="progress-bar" style="width:${pct}%;background-color:var(--primary-sky);border-radius:6px;"></div>
                        </div>
                        <span class="small text-muted" style="min-width:30px;">${pct}%</span>
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}

// -------------------------------------------------------------
// Setup Date Filters
// -------------------------------------------------------------
function setupDateFilters() {
    const filter = document.getElementById('scheduleDateFilter');
    if (filter) {
        filter.value = getLagosTodayString();
        filter.addEventListener('change', () => {
            loadDailySchedule();
        });
    }
}

// -------------------------------------------------------------
// Visit Flow Module (Kanban / Step Progression)
// -------------------------------------------------------------
async function refreshVisitFlow() {
    const container = document.getElementById('visitFlowColumns');
    if (!container) return;

    try {
        const res = await API.getAppointments({ limit: 100 });
        if (res.success) {
            const appts = res.data;
            const columns = {
                'Scheduled': appts.filter(a => a.status === 'Scheduled'),
                'Checked-In': appts.filter(a => a.status === 'Checked-In'),
                'In Consultation': appts.filter(a => a.status === 'In Consultation'),
                'Completed': appts.filter(a => a.status === 'Completed')
            };

            renderVisitFlowColumns(columns);
        }
    } catch (err) {
        console.error('Visit flow refresh failed:', err);
    }
}

function renderVisitFlowColumns(columns) {
    const container = document.getElementById('visitFlowColumns');
    if (!container) return;

    const colConfigs = [
        { key: 'Scheduled', label: '1. Pre-Arrival / Scheduled', badge: 'bg-primary' },
        { key: 'Checked-In', label: '2. Arrived & Checked-In', badge: 'bg-info' },
        { key: 'In Consultation', label: '3. In Consultation / Triage', badge: 'bg-warning text-dark' },
        { key: 'Completed', label: '4. Visit Completed', badge: 'bg-dark' }
    ];

    container.innerHTML = colConfigs.map(cfg => {
        const items = columns[cfg.key] || [];
        return `
      <div class="col-md-3 mb-3">
        <div class="card h-100 border-0 shadow-sm" style="background: #f8fafc; border-radius: 10px;">
          <div class="card-header bg-white border-bottom py-3 d-flex justify-content-between align-items-center">
            <h6 class="mb-0 fw-bold fs-6">${cfg.label}</h6>
            <span class="badge ${cfg.badge}">${items.length}</span>
          </div>
          <div class="card-body p-2" style="max-height: 480px; overflow-y: auto;">
            ${items.length === 0 ? `<div class="text-center py-4 text-muted small">No patients in this stage</div>` :
                items.map(a => `
                <div class="card mb-2 border shadow-none" style="border-radius: 8px;">
                  <div class="card-body p-2">
                    <div class="fw-bold text-dark">${escapeHTML(a.patient_name)}</div>
                    <div class="small text-muted"><i class="bi bi-clock"></i> ${escapeHTML(a.start_time_label)} - ${escapeHTML(a.end_time_label)} · ${escapeHTML(a.doctor_name)}</div>
                    <div class="small text-secondary mt-1"><i class="bi bi-chat-text"></i> ${escapeHTML(a.reason || 'Consultation')}</div>
                    <div class="d-flex justify-content-between align-items-center mt-2 pt-1 border-top">
                      <span class="small text-muted">${escapeHTML(formatDisplayDate(a.appointment_date))}</span>
                      <div class="btn-group btn-group-sm">
                        ${cfg.key === 'Scheduled' ? `
                          <button class="btn btn-xs btn-outline-info" onclick="changeStatus(${a.appointment_id}, 'Checked-In')">Check-In</button>
                          <button class="btn btn-xs btn-outline-warning" onclick="changeStatus(${a.appointment_id}, 'No-Show')">No-Show</button>
                        ` : ''}
                        ${cfg.key === 'Checked-In' ? `<button class="btn btn-xs btn-outline-warning" onclick="changeStatus(${a.appointment_id}, 'In Consultation')">Consult</button>` : ''}
                        ${cfg.key === 'In Consultation' ? `<button class="btn btn-xs btn-outline-success" onclick="changeStatus(${a.appointment_id}, 'Completed')">Complete</button>` : ''}
                      </div>
                    </div>
                  </div>
                </div>
              `).join('')
            }
          </div>
        </div>
      </div>
    `;
    }).join('');
}

// -------------------------------------------------------------
// Patient Registration & List
// -------------------------------------------------------------
async function loadPatientsList() {
    const tbody = document.getElementById('patientRecordsTableBody');
    const countBadge = document.getElementById('patientRecordsCount');
    const searchInput = document.getElementById('patientRecordsSearchInput');
    if (!tbody) return;

    const q = searchInput ? searchInput.value.trim() : '';

    try {
        const res = await API.getPatients(q);
        if (res.success) {
            if (countBadge) countBadge.textContent = `${res.data.length} Registered Patients`;

            if (res.data.length === 0) {
                tbody.innerHTML = `<tr><td colspan="6" class="text-center py-4 text-muted">No patients found.</td></tr>`;
                return;
            }

            tbody.innerHTML = res.data.map(p => {
                const code = escapeHTML(p.patient_code || ('PT-' + String(p.patient_id).padStart(4, '0')));
                return `
        <tr>
          <td><span class="badge bg-primary-subtle text-primary border border-primary-subtle fw-semibold">${code}</span></td>
          <td class="fw-semibold">${escapeHTML(p.first_name)} ${escapeHTML(p.last_name)}</td>
          <td>${escapeHTML(p.phone || 'N/A')}</td>
          <td>${escapeHTML(p.email || 'N/A')}</td>
          <td>${escapeHTML(p.gender || 'N/A')}</td>
          <td>
            <div class="d-flex gap-1">
              <button class="btn btn-sm btn-outline-primary" onclick="bookForPatient(${p.patient_id})">
                <i class="bi bi-calendar-plus me-1"></i>Book
              </button>
              <button class="btn btn-sm btn-outline-secondary" onclick="viewPatientDetails(${p.patient_id})">
                <i class="bi bi-eye me-1"></i>View
              </button>
              <button class="btn btn-sm btn-outline-info" onclick="openEditPatientModalById(${p.patient_id})">
                <i class="bi bi-pencil-square me-1"></i>Edit
              </button>
            </div>
          </td>
        </tr>
      `;
            }).join('');
        }
    } catch (error) {
        tbody.innerHTML = `<tr><td colspan="6" class="text-danger text-center py-3">Failed to load patients: ${error.message}</td></tr>`;
    }
}

window.bookForPatient = async function (patientId) {
    try {
        const res = await API.getPatientById(patientId);
        if (res.success && res.data) {
            selectPatient(res.data);
            const schedulingTab = document.querySelector('[data-view="advance-scheduling"]');
            if (schedulingTab) schedulingTab.click();
        } else {
            showToast('Could not load patient record', 'danger');
        }
    } catch (err) {
        showToast('Failed to load patient: ' + err.message, 'danger');
    }
};


window.viewPatientDetails = async function (patientId) {
    try {
        const res = await API.getPatientById(patientId);
        if (!res.success || !res.data) {
            showToast('Could not load patient details', 'danger');
            return;
        }
        const p = res.data;

        document.getElementById('detailPatientName').textContent = `${p.first_name} ${p.last_name}`;
        document.getElementById('detailPatientGender').textContent = p.gender || '—';
        document.getElementById('detailPatientDob').textContent = p.date_of_birth
            ? new Date(p.date_of_birth + 'T00:00:00').toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' })
            : '—';
        document.getElementById('detailPatientPhone').textContent = p.phone || '—';
        document.getElementById('detailPatientEmail').textContent = p.email || '—';
        document.getElementById('detailPatientAddress').textContent = p.address || '—';
        document.getElementById('detailPatientEmergency').textContent = p.emergency_contact || '—';

        // Wire "Edit Patient" button
        const editBtn = document.getElementById('detailEditBtn');
        if (editBtn) {
            editBtn.onclick = () => {
                const detailsModal = document.getElementById('patientDetailsModal');
                const modalInstance = bootstrap.Modal.getInstance(detailsModal);

                if (modalInstance) {
                    modalInstance.hide();
                }

                detailsModal.addEventListener('hidden.bs.modal', function openEditForm() {
                    detailsModal.removeEventListener('hidden.bs.modal', openEditForm);
                    window.openEditPatientModal(p);
                }, { once: true });
            };
        }

        // Wire "Book Appointment" button
        const bookBtn = document.getElementById('detailBookBtn');
        if (bookBtn) {
            bookBtn.onclick = async () => {
                const modalEl = document.getElementById('patientDetailsModal');
                const modalInstance = bootstrap.Modal.getInstance(modalEl);
                if (modalInstance) modalInstance.hide();
                await bookForPatient(patientId);
            };
        }

        const modalEl = document.getElementById('patientDetailsModal');
        const modal = new bootstrap.Modal(modalEl);
        modal.show();
    } catch (err) {
        showToast('Failed to load patient details: ' + err.message, 'danger');
    }
};



function setupPatientRegistrationModal() {
    const form = document.getElementById('registerPatientForm');
    if (!form) return;

    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        const btn = form.querySelector('button[type="submit"]');
        if (btn) btn.disabled = true;

        const payload = {
            first_name: document.getElementById('regFirstName').value.trim(),
            last_name: document.getElementById('regLastName').value.trim(),
            phone: document.getElementById('regPhone').value.trim(),
            email: document.getElementById('regEmail').value.trim(),
            date_of_birth: document.getElementById('regDob').value || null,
            gender: document.getElementById('regGender').value || null,
            address: document.getElementById('regAddress').value.trim() || null,
            emergency_contact: document.getElementById('regEmergencyContact').value.trim() || null
        };

        // Frontend validation
        const missing = [];
        if (!payload.first_name) missing.push('First Name');
        if (!payload.last_name) missing.push('Last Name');
        if (!payload.phone) missing.push('Phone Number');
        if (!payload.email) missing.push('Email Address');
        if (!payload.date_of_birth) missing.push('Date of Birth');
        if (!payload.gender) missing.push('Gender');
        if (!payload.address) missing.push('Residential Address');
        if (!payload.emergency_contact) missing.push('Emergency Contact');

        if (missing.length > 0) {
            showToast(`All fields are required. Please fill: ${missing.join(', ')}`, 'danger');
            if (btn) btn.disabled = false;
            return;
        }

        try {
            const res = await API.createPatient(payload);

            if (res.success) {
                const code = res.data.patient_code || ('PT-' + String(res.data.patient_id).padStart(4, '0'));
                showToast(
                    `Patient ${res.data.first_name} ${res.data.last_name} registered successfully! Patient ID: ${code}`,
                    'success'
                );

                form.reset();

                const modalEl = document.getElementById('registerPatientModal');
                const modalInstance = bootstrap.Modal.getInstance(modalEl);
                if (modalInstance) modalInstance.hide();

                selectPatient(res.data);

                await refreshDashboardStats();
                await loadPatientsList();
            } else {
                showToast(res.message || res.error || 'Could not save patient details', 'danger');
            }
        } catch (error) {
            showToast(`Registration failed: ${error.message}`, 'danger');
        } finally {
            if (btn) btn.disabled = false;
        }
    });

    // Patient Records Search Filter
    const patientSearch = document.getElementById('patientRecordsSearchInput');
    if (patientSearch) {
        let timer = null;
        patientSearch.addEventListener('input', () => {
            clearTimeout(timer);
            timer = setTimeout(loadPatientsList, 300);
        });
    }
}

function setupEditPatientModal() {
    const form = document.getElementById('editPatientForm');
    if (!form) return;

    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        const btn = form.querySelector('button[type="submit"]');
        if (btn) btn.disabled = true;

        const patientId = document.getElementById('editPatientId').value;
        const payload = {
            first_name: document.getElementById('editFirstName').value.trim(),
            last_name: document.getElementById('editLastName').value.trim(),
            phone: document.getElementById('editPhone').value.trim(),
            email: document.getElementById('editEmail').value.trim(),
            date_of_birth: document.getElementById('editDob').value || null,
            gender: document.getElementById('editGender').value || null,
            address: document.getElementById('editAddress').value.trim() || null,
            emergency_contact: document.getElementById('editEmergencyContact').value.trim() || null
        };

        const missing = [];
        if (!payload.first_name) missing.push('First Name');
        if (!payload.last_name) missing.push('Last Name');
        if (!payload.phone) missing.push('Phone Number');
        if (!payload.email) missing.push('Email Address');
        if (!payload.date_of_birth) missing.push('Date of Birth');
        if (!payload.gender) missing.push('Gender');
        if (!payload.address) missing.push('Residential Address');
        if (!payload.emergency_contact) missing.push('Emergency Contact');

        if (missing.length > 0) {
            showToast(`All fields are required. Missing: ${missing.join(', ')}`, 'danger');
            if (btn) btn.disabled = false;
            return;
        }

        try {
            const res = await API.updatePatient(patientId, payload);
            if (res.success) {
                const code = res.data.patient_code || ('PT-' + String(res.data.patient_id).padStart(4, '0'));
                showToast(`Patient ${res.data.first_name} ${res.data.last_name} (${code}) updated successfully!`, 'success');

                const modalEl = document.getElementById('editPatientModal');
                const modalInstance = bootstrap.Modal.getInstance(modalEl);
                if (modalInstance) modalInstance.hide();

                // If currently selected for booking, update selected patient
                if (AppState.selectedPatient && AppState.selectedPatient.patient_id === Number(patientId)) {
                    selectPatient(res.data);
                }

                await loadPatientsList();
            } else {
                showToast(res.message || res.error || 'Failed to update patient profile', 'danger');
            }
        } catch (error) {
            showToast(`Update failed: ${error.message}`, 'danger');
        } finally {
            if (btn) btn.disabled = false;
        }
    });
}

window.openNewPatientModal = function (prefillName = '') {
    const form = document.getElementById('registerPatientForm');
    if (form) form.reset();

    if (prefillName) {
        const parts = prefillName.split(' ');
        const first = parts[0] || '';
        const last = parts.slice(1).join(' ') || '';
        const fnInput = document.getElementById('regFirstName');
        const lnInput = document.getElementById('regLastName');
        if (fnInput) fnInput.value = first;
        if (lnInput) lnInput.value = last;
    }
    const modalEl = document.getElementById('registerPatientModal');
    if (modalEl) {
        const modal = new bootstrap.Modal(modalEl);
        modal.show();
    }
};

window.openEditPatientModal = function (patient) {
    if (!patient) return;

    document.getElementById('editPatientId').value = patient.patient_id;
    const code = patient.patient_code || ('PT-' + String(patient.patient_id).padStart(4, '0'));
    const codeTitleEl = document.getElementById('editPatientCodeTitle');
    if (codeTitleEl) codeTitleEl.textContent = code;

    document.getElementById('editFirstName').value = patient.first_name || '';
    document.getElementById('editLastName').value = patient.last_name || '';
    document.getElementById('editPhone').value = patient.phone || '';
    document.getElementById('editEmail').value = patient.email || '';
    document.getElementById('editDob').value = patient.date_of_birth
        ? String(patient.date_of_birth).split('T')[0].split(' ')[0]
        : '';
    document.getElementById('editGender').value = patient.gender || '';
    document.getElementById('editAddress').value = patient.address || '';
    document.getElementById('editEmergencyContact').value = patient.emergency_contact || '';

    const modalEl = document.getElementById('editPatientModal');
    if (modalEl) {
        const modal = new bootstrap.Modal(modalEl);
        modal.show();
    }
};

window.openEditPatientModalById = async function (patientId) {
    try {
        const res = await API.getPatientById(patientId);
        if (res.success && res.data) {
            window.openEditPatientModal(res.data);
        } else {
            showToast('Could not load patient profile for editing', 'danger');
        }
    } catch (err) {
        showToast('Error loading patient: ' + err.message, 'danger');
    }
};


// -------------------------------------------------------------
// Toast Notification Utility
// -------------------------------------------------------------
function showToast(message, type = 'primary') {
    const toastContainer = document.getElementById('toastContainer');
    if (!toastContainer) return;

    const toastId = 'toast-' + Date.now();
    const icon = type === 'success' ? 'bi-check-circle-fill' : type === 'danger' ? 'bi-exclamation-triangle-fill' : 'bi-info-circle-fill';
    const bgClass = type === 'success' ? 'text-bg-success' : type === 'danger' ? 'text-bg-danger' : 'text-bg-dark';

    const toastHtml = `
    <div id="${toastId}" class="toast align-items-center ${bgClass} border-0 mb-2 shadow" role="alert" aria-live="assertive" aria-atomic="true">
      <div class="d-flex">
        <div class="toast-body d-flex align-items-center gap-2">
          <i class="bi ${icon}"></i>
          <span>${message}</span>
        </div>
        <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast" aria-label="Close"></button>
      </div>
    </div>
  `;

    toastContainer.insertAdjacentHTML('beforeend', toastHtml);
    const toastElement = document.getElementById(toastId);
    const bsToast = new bootstrap.Toast(toastElement, { delay: 4500 });
    bsToast.show();

    toastElement.addEventListener('hidden.bs.toast', () => {
        toastElement.remove();
    });
}


// -------------------------------------------------------------
// Doctor Management: Add Doctor, Activate/Deactivate, Weekly Schedule
// -------------------------------------------------------------
window.openAddDoctorModal = function () {
    const form = document.getElementById('addDoctorForm');
    if (form) form.reset();
    bootstrap.Modal.getOrCreateInstance(document.getElementById('addDoctorModal')).show();
};

window.toggleDoctorActive = async function (doctorId) {
    try {
        const res = await API.toggleDoctorActive(doctorId);
        showToast(res.message || 'Doctor status updated', 'success');
        await loadDoctors();
        await refreshDashboardStats();
    } catch (error) {
        showToast('Could not update doctor: ' + error.message, 'danger');
    }
};

// MySQL DAYOFWEEK numbers: 1 = Sunday, 2 = Monday ... 7 = Saturday
const WEEK_DAYS = [
    { label: 'Monday', value: 2 },
    { label: 'Tuesday', value: 3 },
    { label: 'Wednesday', value: 4 },
    { label: 'Thursday', value: 5 },
    { label: 'Friday', value: 6 },
    { label: 'Saturday', value: 7 },
    { label: 'Sunday', value: 1 }
];

window.openDoctorScheduleModal = async function (doctorId) {
    const allDocs = (AppState.allDoctors && AppState.allDoctors.length > 0) ? AppState.allDoctors : AppState.doctors;
    const doc = allDocs.find(d => Number(d.doctor_id) === Number(doctorId));
    if (!doc) return;

    try {
        const res = await API.getDoctorSchedules(doctorId);
        const rows = (res.success && Array.isArray(res.data)) ? res.data : [];

        document.getElementById('schedDoctorId').value = doctorId;
        document.getElementById('schedDoctorName').textContent = `Dr. ${doc.first_name} ${doc.last_name}`;
        document.getElementById('schedDoctorSpecialty').textContent = doc.specialty;

        document.getElementById('schedTableBody').innerHTML = WEEK_DAYS.map(day => {
            const s = rows.find(r => Number(r.day_of_week) === day.value);
            const working = s ? Boolean(Number(s.is_available)) : false;
            const start = s ? String(s.start_time).slice(0, 5) : '09:00';
            const end = s ? String(s.end_time).slice(0, 5) : '17:00';
            const slot = s && s.slot_duration_minutes ? s.slot_duration_minutes : 45;
            return `
            <tr data-day="${day.value}" data-slot="${slot}">
              <td class="fw-semibold">${day.label}</td>
              <td>
                <div class="form-check form-switch">
                  <input class="form-check-input sched-working" type="checkbox" ${working ? 'checked' : ''}>
                </div>
              </td>
              <td><input type="time" class="form-control form-control-sm sched-start" value="${start}"></td>
              <td><input type="time" class="form-control form-control-sm sched-end" value="${end}"></td>
            </tr>`;
        }).join('');

        bootstrap.Modal.getOrCreateInstance(document.getElementById('doctorScheduleModal')).show();
    } catch (error) {
        showToast('Could not load schedule: ' + error.message, 'danger');
    }
};

document.addEventListener('submit', async (e) => {
    // ---- Add Doctor form ----
    if (e.target.id === 'addDoctorForm') {
        e.preventDefault();
        const val = (id) => document.getElementById(id).value.trim();
        const payload = {
            first_name: val('addDocFirstName'),
            last_name: val('addDocLastName'),
            specialty: val('addDocSpecialty'),
            phone: val('addDocPhone'),
            email: val('addDocEmail')
        };

        const btn = e.target.querySelector('button[type="submit"]');
        if (btn) btn.disabled = true;
        try {
            const res = await API.createDoctor(payload);
            if (res.success) {
                showToast(res.message || 'Doctor added to the roster', 'success');
                const modalInstance = bootstrap.Modal.getInstance(document.getElementById('addDoctorModal'));
                if (modalInstance) modalInstance.hide();
                await loadDoctors();
                await refreshDashboardStats();
            }
        } catch (error) {
            showToast('Could not add doctor: ' + error.message, 'danger');
        } finally {
            if (btn) btn.disabled = false;
        }
        return;
    }

    // ---- Weekly Schedule form ----
    if (e.target.id === 'doctorScheduleForm') {
        e.preventDefault();
        const doctorId = document.getElementById('schedDoctorId').value;
        const schedules = [];

        for (const row of document.querySelectorAll('#schedTableBody tr')) {
            const working = row.querySelector('.sched-working').checked;
            const start = row.querySelector('.sched-start').value || '09:00';
            const end = row.querySelector('.sched-end').value || '17:00';
            if (working && end <= start) {
                showToast('Shift end time must be after the start time on working days.', 'danger');
                return;
            }
            schedules.push({
                day_of_week: Number(row.getAttribute('data-day')),
                start_time: start + ':00',
                end_time: end + ':00',
                slot_duration_minutes: Number(row.getAttribute('data-slot')) || 45,
                is_available: working
            });
        }

        const btn = e.target.querySelector('button[type="submit"]');
        if (btn) btn.disabled = true;
        try {
            const res = await API.updateDoctorSchedules(doctorId, schedules);
            if (res.success) {
                showToast(res.message || 'Schedule updated', 'success');
                const modalInstance = bootstrap.Modal.getInstance(document.getElementById('doctorScheduleModal'));
                if (modalInstance) modalInstance.hide();
                await loadDoctors();
            }
        } catch (error) {
            showToast('Could not update schedule: ' + error.message, 'danger');
        } finally {
            if (btn) btn.disabled = false;
        }
    }
});

// -------------------------------------------------------------
// Refresh Flow button (with visible feedback)
// -------------------------------------------------------------
window.manualRefreshFlow = async function (btn) {
    const original = btn ? btn.innerHTML : '';
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Refreshing...';
    }
    try {
        await refreshVisitFlow();
        await refreshDashboardStats();
        showToast('Visit flow refreshed', 'success');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = original;
        }
    }
};

// -------------------------------------------------------------
// Dashboard: Today's Upcoming Appointments table
// -------------------------------------------------------------
async function loadDashboardUpcoming() {
    const tbody = document.getElementById('dashboardUpcomingTableBody');
    if (!tbody) return;

    try {
        const res = await API.getAppointments({ date: getLagosTodayString() });
        const items = (res.success && res.data) ? res.data : [];

        if (items.length === 0) {
            tbody.innerHTML = `<tr><td colspan="5" class="text-center py-3 text-muted"><i class="bi bi-calendar-x me-1"></i>No appointments scheduled for today.</td></tr>`;
            return;
        }

        tbody.innerHTML = items.map(a => {
            let action = '<span class="text-muted small">—</span>';
            if (a.status === 'Scheduled') {
                action = `<button class="btn btn-sm btn-outline-info" onclick="changeStatus(${a.appointment_id}, 'Checked-In')">Check In</button>`;
            } else if (a.status === 'Checked-In') {
                action = `<button class="btn btn-sm btn-outline-warning" onclick="changeStatus(${a.appointment_id}, 'In Consultation')">Start Consultation</button>`;
            } else if (a.status === 'In Consultation') {
                action = `<button class="btn btn-sm btn-outline-success" onclick="changeStatus(${a.appointment_id}, 'Completed')">Complete</button>`;
            }

            return `
            <tr>
              <td class="fw-semibold">${escapeHTML(a.patient_name)}</td>
              <td>${escapeHTML(a.doctor_name)}${a.doctor_specialty ? `<div class="small text-muted">${escapeHTML(a.doctor_specialty)}</div>` : ''}</td>
              <td>${escapeHTML(a.start_time_label)} – ${escapeHTML(a.end_time_label)}</td>
              <td><span class="status-pill ${getStatusBadgeClass(a.status)}">${escapeHTML(a.status)}</span></td>
              <td>${action}</td>
            </tr>`;
        }).join('');
    } catch (error) {
        tbody.innerHTML = `<tr><td colspan="5" class="text-danger text-center py-3">Could not load today's schedule: ${escapeHTML(error.message)}</td></tr>`;
    }
}