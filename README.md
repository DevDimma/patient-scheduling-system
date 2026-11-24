 ADVANCED PATIENT SCHEDULING & PRE-ARRIVAL MANAGEMENT SYSTEM


 <!-- 1. PROJECT OVERVIEW -->

The Advanced Patient Scheduling & Pre-Arrival Management System is a web-based healthcare application developed to improve patient registration, advance appointment scheduling and front-desk operations in healthcare facilities.

The system provides a central platform for managing patient records, viewing doctor availability, scheduling appointments and monitoring patient visits.


<!-- 2. APPLICATION PROCESS -->

Live Application:  
https://patient-scheduling-system.onrender.com

The application is deployed on Render and can be accessed through a web browser with an internet connection.

Primary User Role: Front Desk


<!-- 3. TECHNOLOGIES USED -->

The application was developed using the following technologies:

- HTML5 – Structure of the application.
- CSS3 – Styling and layout.
- Bootstrap 5.3 – Responsive user interface.
- JavaScript – Frontend functionality and interactions.
- Node.js – Backend runtime environment.
- Express.js – Backend framework and REST API.
- MySQL 8.x – Database management.
- Aiven – Cloud database hosting.
- Render – Application deployment and hosting.


<!-- 4. MAIN APPLICATION FEATURES -->

4.1 Dashboard
Provides an overview of clinic activities, including patient records, appointments, doctor availability and daily operations.

4.2 Patient Registration
Allows front-desk personnel to register new patients and record their personal information, contact details and emergency contact information. Registered patient details can be viewed and edited when corrections are required.

4.3 Doctor Rosters
Displays doctor information, medical specialties and available working schedules to support appointment planning.

4.4 Advance Scheduling
Allows front-desk personnel to book appointments for registered patients by selecting an available doctor, appointment date and time slot. The system also helps prevent conflicting appointments.

4.5 Visit Flow
Tracks patient appointments through different stages of the healthcare visit:

- Pre-Arrival
- Check-In / Arrival
- Consultation
- Visit Completed

4.6 Analytics
Provides operational insights and summaries, including appointment distribution, visit status and appointment volume by medical specialty.


<!-- 5. BASIC APPLICATION WORKFLOW-->

1. Open the application using the live URL.
2. Access the Patient Registration section.
3. Register a new patient by providing the required information.
4. Open the registered patient's details.
5. Select the *Book Appointment* option displayed beside the patient details.
6. Select the doctor, appointment date and available time slot.
7. Provide the reason for the visit and confirm the appointment.
8. Monitor scheduled appointments through the Dashboard and Visit Flow sections.


<!-- 6. DATABASE MANAGEMENT -->

The application uses MySQL as its relational database management system.

The database is hosted on Aiven and connected to the backend through the application's database configuration.

The database contains the following main tables:

- *patients:* Stores patient demographic and contact information.
- *doctors:* Stores doctor information and medical specialties.
- *doctor_schedules:* Stores doctors' weekly availability and working schedules.
- *appointments:* Stores patient appointment records.
- *appointment_status_history:* Records changes in appointment and visit statuses.

A SQL database backup is included with the project source files.


<!-- 7. PROJECT PURPOSE -->

This project was developed as part of the practical requirements for:

*CSC 392 – Practical Application of Software Development in Industries*

It demonstrates the application of web development technologies, backend programming and database integration in developing a healthcare appointment management solution.