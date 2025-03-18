const express = require('express');
const router = express.Router();
const dashboardController = require('../controllers/dashboardController');

// Get dashboard summary data
router.get('/summary', dashboardController.getDashboardSummary);

// Get recent activity
router.get('/recent-activity', dashboardController.getRecentActivity);

// Get map data
router.get('/map-data', dashboardController.getMapData);

module.exports = router;