const express = require('express');
const router = express.Router();
const multer = require('multer');
const teamApplicationController = require('../controllers/teamApplicationController');

// Configure multer for handling uploads
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// Create application session and send form link
router.post('/create-session', teamApplicationController.createApplicationSession);

// Submit application form with document upload
router.post('/submit', upload.single('aadharDocument'), teamApplicationController.submitApplication);

// Get all applications with filtering and pagination
router.get('/', teamApplicationController.getAllApplications);

// Update application status
router.put('/:id([0-9a-fA-F]{24})/status', teamApplicationController.updateApplicationStatus);

module.exports = router;