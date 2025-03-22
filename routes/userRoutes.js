const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const { authMiddleware, mainAdminOnly } = require('../services/authService');

// router.use(authMiddleware);
// router.use(mainAdminOnly);
/*
DBMS => MongoDB
Database => traffic_buddy
Collection => divisions
    {
  "_id": {
    "$oid": "67dac1a2a771ed87f82890b2"
  },
  "name": "MAHALUNGE",
  "code": "MHAL",
  "boundaries": {
    "type": "Polygon",
    "coordinates": [
      [
        [73.80245792575678,18.820015921681275],.........[73.79700486342406,18.817329598298812]
      ]
    ]
  },
  "officers": [
    {
      "name": "PI PATIL",
      "phone": "+918010177103",
      "isActive": true,
      "_id": {
        "$oid": "67dac1a2a771ed87f82890b3"
      }
    }
  ],
  "dashboard_url": "",
  "dashboard_credentials": {
    "username": "mahalunge_admin",
    "password": "Admin@mahalunge#123"
  },
  "email": "ravirajsonar904@gmail.com",
  "alternate_phone": "918010177103",
  "__v": 0
}
*/
// The collection represents a geographical region named MAHALUNGE with defined boundary coordinates. 
// It tracks the current and past officers assigned to the area, with the most recent officer at the end of the officers array. 
// Additionally, it includes dashboard credentials, email, and an alternate phone number for contact.

// Apply auth middleware to all user routes and restrict to main admin only

// GET current officer of all divisions
router.get('/current-officer', userController.getCurrentOfficers);
// GET current officer of a particular division
router.get('/current-officer/:divisionId', userController.getCurrentOfficer);

// GET all officers of all divisions
router.get('/all-officers', userController.getAllOfficers);
// GET all officers of a particular division
router.get('/all-officers/:divisionId', userController.getAllOfficers);

// PUT update officer details
router.put('/update-officer/:divisionId', userController.updateOfficer);

// POST assign officer to a region
router.post('/add-officer/:divisionId', userController.assignOfficer);

// POST unassign officer from a region
router.post('/unassign-officer/:divisionId', userController.unassignOfficer);

module.exports = router;