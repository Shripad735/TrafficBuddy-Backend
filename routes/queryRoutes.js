const express = require('express');
const router = express.Router();
const queryController = require('../controllers/queryController');
const { sendWhatsAppMessage } = require('../utils/whatsapp');

// Get all queries with filtering and pagination
router.get('/', queryController.getAllQueries);

// Get query statistics
router.get('/statistics', queryController.getQueryStatistics);

// IMPORTANT: Use path parameter pattern with hyphens to avoid confusion with IDs
router.get('/time-filter', queryController.getqueriesbytimefilter);

// Get queries by type
router.get('/type/:type', queryController.getQueriesByType);

// Get query by ID - This should come after more specific routes
router.get('/:id([0-9a-fA-F]{24})', queryController.getQueryById);

// Update query status
router.put('/:id/status', queryController.updateQueryStatus);

// Delete a query
router.delete('/:id', queryController.deleteQuery);

router.post('/:id/notify-department', queryController.notifyDepartmentByEmail);

router.post('/broadcast', queryController.broadcastMessage);

router.post('/broadcasttoVolunteers', queryController.broadcastMessageToVolunteers);

// Test WhatsApp messaging
router.post('/test-notification', async (req, res) => {
    try {
      const { to, message } = req.body;
      
      if (!to || !message) {
        return res.status(400).json({
          success: false,
          message: 'Both "to" and "message" are required'
        });
      }
      
      // Format the number if not already in WhatsApp format
      const formattedNumber = to.startsWith('whatsapp:') ? to : `whatsapp:${to}`;
      
      // Send test message
      const result = await sendWhatsAppMessage(formattedNumber, message);
      
      return res.status(200).json({
        success: true,
        message: 'Test message sent successfully',
        sid: result.sid
      });
    } catch (error) {
      console.error('Error sending test message:', error);
      return res.status(500).json({
        success: false,
        message: 'Error sending test message',
        error: error.message
      });
    }
  });

module.exports = router;