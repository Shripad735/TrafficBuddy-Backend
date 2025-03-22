const express = require('express');
const axios = require('axios');
const dotenv = require('dotenv');
const path = require('path');
const multer = require('multer');
const cors = require('cors');

// Load environment variables
dotenv.config();

// Import utility functions
const { uploadImageToR2 } = require('./utils/imageupload');
const { sendQueryNotification } = require('./utils/emailer');
const { getCameraAppLink, getInstructionMessage, getUniversalLink, getCaptureUrl } = require('./utils/deeplink');
const { getText, getLanguagePrompt } = require('./utils/language');
const { getReportInstructionMessage } = require('./utils/deeplink');
const { getTwilioClient, sendWhatsAppMessage } = require('./utils/whatsapp');
const { getUserSession, updateUserSession } = require('./utils/sessionManager');

// Import database connection
const connectDB = require('./config/database');

// Import models
const Query = require('./models/Query');
const Session = require('./models/Session');
const { Division } = require('./models/Division');

// Import routes
const uploadRoutes = require('./routes/upload');
const queryRoutes = require('./routes/queryRoutes');
const dashboardRoutes = require('./routes/dashboardRoutes');
const authRoutes = require('./routes/authRoutes');
const userRoutes = require('./routes/userRoutes');

// Check for required environment variables
const requiredEnvVars = [
  'CLOUDFLARE_R2_BUCKET_NAME',
  'CLOUDFLARE_R2_ENDPOINT',
  'CLOUDFLARE_R2_ACCESS_KEY',
  'CLOUDFLARE_R2_SECRET_KEY',
  'CLOUDFLARE_R2_PUBLIC_URL',
  'TWILIO_AUTH_TOKEN',
  'EMAIL_USER',
  'EMAIL_PASS',
  'MAIN_ADMIN_USERNAME',
  'MAIN_ADMIN_PASSWORD'
];

const missingEnvVars = requiredEnvVars.filter(envVar => !process.env[envVar]);

if (!process.env.MAIN_ADMIN_USERNAME || !process.env.MAIN_ADMIN_PASSWORD) {
  console.error('Missing main admin credentials in environment variables');
  console.error('MAIN_ADMIN_USERNAME & MAIN_ADMIN_PASSWORD are required');
  console.error('Please check your .env file');
  process.exit(1);
}

if (missingEnvVars.length > 0) {
  console.error('Missing required environment variables:');
  missingEnvVars.forEach(envVar => console.error(`- ${envVar}`));
  console.error('Please check your .env file');
} else {
  console.log('All required environment variables found');
}

// Utility function to find which division a location belongs to
async function findDivisionForLocation(latitude, longitude) {
  try {
    console.log(`Checking division for location: ${latitude}, ${longitude}`);
    
    // Convert to proper number types
    const lat = parseFloat(latitude);
    const lng = parseFloat(longitude);
    
    if (isNaN(lat) || isNaN(lng)) {
      console.error('Invalid coordinates:', latitude, longitude);
      return null;
    }
    
    // Get all divisions
    const allDivisions = await Division.find();
    console.log(`Found ${allDivisions.length} divisions to check`);
    
    // Manual check for each division
    for (const division of allDivisions) {
      console.log(`Checking division: ${division.name}`);
      
      // Make sure the division has proper boundaries
      if (!division.boundaries || !division.boundaries.coordinates || 
          !Array.isArray(division.boundaries.coordinates) || 
          division.boundaries.coordinates.length === 0) {
        console.log(`Division ${division.name} has invalid boundaries format`);
        continue;
      }
      
      const coordinates = division.boundaries.coordinates[0];
      console.log(`Division has ${coordinates.length} boundary points`);
      
      // Check if point is within polygon using ray casting algorithm
      if (isPointInPolygon([lng, lat], coordinates)) {
        console.log(`Found matching division: ${division.name}`);
        return division;
      }
    }
    
    console.log('No division found for this location.');
    return null;
  } catch (error) {
    console.error('Error finding division for location:', error);
    return null;
  }
}

// Improved ray casting algorithm to check if point is in polygon
function isPointInPolygon(point, polygon) {
  const x = point[0]; // longitude
  const y = point[1]; // latitude
  
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i][0]; // longitude of point i
    const yi = polygon[i][1]; // latitude of point i
    const xj = polygon[j][0]; // longitude of point j
    const yj = polygon[j][1]; // latitude of point j
    
    // Handle points with third coordinate (elevation) if present
    const xi_clean = Array.isArray(xi) ? xi[0] : xi;
    const yi_clean = Array.isArray(yi) ? yi[1] : yi;
    const xj_clean = Array.isArray(xj) ? xj[0] : xj;
    const yj_clean = Array.isArray(yj) ? yj[1] : yj;
    
    // Check if ray from point crosses edge
    const intersect = ((yi_clean > y) !== (yj_clean > y)) && 
                     (x < (xj_clean - xi_clean) * (y - yi_clean) / (yj_clean - yi_clean) + xi_clean);
    if (intersect) inside = !inside;
  }
  
  return inside;
}

// Initialize Express app
const app = express();
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Enable CORS
app.use(cors({
  origin: ['http://localhost:5173', 'http://localhost:3000', 'https://yourdomain.com'],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Use routes
app.use('/api/auth', authRoutes);
app.use('/api/queries', queryRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/uploads', uploadRoutes);
app.use('/api/users', userRoutes);

// Get Twilio client
const client = getTwilioClient();
const accountSid = process.env.TWILIO_SID || 'your_account_sid';
const authToken = process.env.TWILIO_AUTH_TOKEN || 'your_auth_token';

// Configure multer for handling media files
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// Helper function to generate the main menu
function getMainMenu(language) {
  return getText('WELCOME_MESSAGE', language);
}

// Helper function to download and process media from Twilio
async function processMedia(body) {
  if (!body.NumMedia || parseInt(body.NumMedia) === 0) {
    return null;
  }

  console.log('Media found in message. Count:', body.NumMedia);

  try {
    const mediaUrl = body.MediaUrl0;
    const contentType = body.MediaContentType0 || 'image/jpeg';

    if (!mediaUrl) {
      console.error('No media URL found in the request');
      return null;
    }

    console.log(`Media URL: ${mediaUrl}`);
    console.log(`Content Type: ${contentType}`);

    const auth = Buffer.from(`${accountSid}:${authToken}`).toString('base64');

    const response = await axios({
      method: 'get',
      url: mediaUrl,
      responseType: 'arraybuffer',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Accept': 'application/json'
      }
    });

    if (response.status !== 200) {
      console.error('Failed to download media. Status:', response.status);
      return null;
    }

    console.log(`Downloaded media: ${response.data.length} bytes`);

    const base64Data = Buffer.from(response.data).toString('base64');
    const base64Image = `data:${contentType};base64,${base64Data}`;

    console.log('Uploading to R2...');
    const uploadedUrl = await uploadImageToR2(base64Image, 'traffic_buddy');
    console.log('Upload complete. URL:', uploadedUrl);

    return uploadedUrl;
  } catch (error) {
    console.error('Error processing media:', error.message);
    if (error.response) {
      console.error('Response status:', error.response.status);
      console.error('Response data:', error.response.data);
    }
    return null;
  }
}

// Serve the capture.html file
app.get('/capture.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'capture.html'));
});

// Endpoint to handle reports from the capture page
app.post('/api/report', upload.single('image'), async (req, res) => {
  try {
    console.log('----- NEW REPORT SUBMISSION -----');
    console.log('Request body:', req.body);
    
    const { latitude, longitude, description, userId, reportType, address } = req.body;
    
    if (!req.file) {
      console.error('No image file found in the request');
      return res.status(400).json({ success: false, error: 'No image file found' });
    }
    
    // Check if the location is within any division
    const matchingDivision = await findDivisionForLocation(latitude, longitude);
    
    // If location is not in any division, reject the report
    if (!matchingDivision) {
      console.log('Location is outside PCMC jurisdiction');
      return res.status(400).json({ 
        success: false, 
        error: 'This location appears to be outside PCMC jurisdiction. We can only process reports within PCMC limits.' 
      });
    }
    
    // Upload image to R2
    const imageBuffer = req.file.buffer;
    const base64Image = `data:${req.file.mimetype};base64,${imageBuffer.toString('base64')}`;
    console.log('Uploading image to R2...');
    const uploadedUrl = await uploadImageToR2(base64Image, 'traffic_buddy');
    console.log('Image uploaded to:', uploadedUrl);
    
    // Determine report type
    let queryType = 'General Report';
    switch (reportType) {
      case '1':
        queryType = 'Traffic Violation';
        break;
      case '2':
        queryType = 'Traffic Congestion';
        break;
      case '3':
        queryType = 'Accident';
        break;
      case '4':
        queryType = 'Road Damage';
        break;
      case '5':
        queryType = 'Illegal Parking';
        break;
      case '7':
        queryType = 'Suggestion';
        break;
      default:
        queryType = 'General Report';
    }
    
    // Get user's name from session
    const userSession = await Session.findOne({ user_id: userId });
    const userName = userSession?.user_name || 'Anonymous';
    
    // Prepare the query object but do not save it yet
    const newQuery = new Query({
      user_id: userId,
      user_name: userName,
      query_type: queryType,
      description: description,
      photo_url: uploadedUrl,
      location: { 
        latitude: parseFloat(latitude), 
        longitude: parseFloat(longitude),
        address: address || `${latitude}, ${longitude}`
      },
      status: 'Pending',
      division: matchingDivision._id,
      divisionName: matchingDivision.name,
      divisionNotified: false
    });

    // Notify division officers via WhatsApp if they exist
    let notifiedOfficers = [];
    let divisionNotified = false;

    try {
      if (matchingDivision.officers && matchingDivision.officers.length > 0) {
        const activeOfficers = matchingDivision.officers.filter(officer => officer.isActive);
        
        // Only notify up to 2 officers
        const officersToNotify = activeOfficers.slice(0, 2);
        
        if (officersToNotify.length > 0) {
          const notificationMessage = `🚨 New Traffic Report in ${matchingDivision.name}\n\n` +
            `Type: ${queryType}\n` +
            `Location: ${address || 'See map link'}\n` +
            `Description: ${description}\n\n` +
            `To resolve this issue, click: https://trafficbuddy.pcmc.gov.in/resolve/pending`;
          
          // Send messages to officers
          for (const officer of officersToNotify) {
            try {
              await sendWhatsAppMessage(officer.phone, notificationMessage);
              console.log(`Notification sent to officer: ${officer.name} (${officer.phone})`);
              
              // Record that officer was notified
              notifiedOfficers.push({
                phone: officer.phone,
                timestamp: new Date()
              });
            } catch (officerError) {
              console.error(`Failed to notify officer ${officer.name} (${officer.phone}):`, officerError);
            }
          }
          
          // Set divisionNotified to true if at least one officer was notified
          if (notifiedOfficers.length > 0) {
            divisionNotified = true;
          }
        } else {
          console.log('No active officers to notify for this division');
        }
      } else {
        console.log('No officers found for this division');
      }
    } catch (notificationError) {
      console.error('Error notifying division officers:', notificationError);
    }

    // Only save the query if divisionNotified is true
    if (!divisionNotified) {
      console.log('Division was not notified. Query will not be saved.');
      return res.status(400).json({
        success: false,
        error: 'Unable to notify division officers. Report cannot be saved at this time.'
      });
    }

    // Update the query object with notification details and save it
    newQuery.divisionNotified = true;
    newQuery.divisionOfficersNotified = notifiedOfficers;
    await newQuery.save();
    console.log(`Saved ${queryType} report to database with division: ${matchingDivision.name}`);

    // Send email notification
    try {
      await sendQueryNotification(newQuery, matchingDivision);
      console.log('Email notification sent');
    } catch (emailError) {
      console.error('Error sending email notification:', emailError);
    }
    
    // Send WhatsApp notification to user
    let userLanguage = 'en';
    try {
      if (userSession) {
        userLanguage = userSession.language || 'en';
      }
      
      const confirmMessage = getText('REPORT_RESPONSE', userLanguage, queryType, true);
      
      await client.messages.create({
        from: 'whatsapp:+14155238886',
        to: userId,
        body: confirmMessage
      });
      
      console.log('WhatsApp confirmation sent to user');
    } catch (whatsappError) {
      console.error('Error sending WhatsApp confirmation:', whatsappError);
    }
    
    res.status(200).json({ success: true });
  } catch (error) {
    console.error('Error processing report:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Webhook for incoming messages with image handling
app.post('/webhook', express.urlencoded({ extended: true }), async (req, res) => {
  try {
    console.log('----- NEW WEBHOOK REQUEST -----');
    console.log('Request body:', JSON.stringify(req.body));

    const userMessage = req.body.Body || '';
    const userNumber = req.body.From || '';

    console.log(`From: ${userNumber}, Message: ${userMessage}`);

    // Process media first (if any)
    let mediaUrl = null;
    if (req.body.NumMedia && parseInt(req.body.NumMedia) > 0) {
      console.log('Processing media attachment');
      mediaUrl = await processMedia(req.body);
    }

    // Check for location data in the WhatsApp message
    let latitude = req.body.Latitude || null;
    let longitude = req.body.Longitude || null;
    let locationAddress = req.body.Address || null;

    // Get user session using the helper function
    const userSession = await getUserSession(userNumber);
    console.log('User session:', userSession);

    const currentState = userSession.current_state;
    const lastOption = userSession.last_option;
    const userLanguage = userSession.language || 'en';

    console.log(`Current state: ${currentState}, Last option: ${lastOption}, Language: ${userLanguage}`);

    // Process the message based on current state
    let responseMessage = '';
    let newState = currentState;
    let newLastOption = lastOption;
    let newLanguage = userLanguage;

    // Special command to reset the session and force language selection
    if (userMessage && userMessage.toLowerCase() === 'reset') {
      responseMessage = getLanguagePrompt('en'); // Default to English prompt for reset
      newState = 'LANGUAGE_SELECT';
      newLastOption = null;
      console.log('User session reset to language selection');
    }
    // Special command to return to menu from any state
    else if (userMessage && userMessage.toLowerCase() === 'menu') {
      responseMessage = getMainMenu(userLanguage);
      newState = 'MENU';
      newLastOption = null;
    }
    // Handle language selection state
    else if (currentState === 'LANGUAGE_SELECT') {
      if (userMessage === '1') {
        // English selected
        newLanguage = 'en';
        responseMessage = getText('NAME_REQUEST', 'en');
        newState = 'NAME_COLLECTION';
      } else if (userMessage === '2') {
        // Marathi selected
        newLanguage = 'mr';
        responseMessage = getText('NAME_REQUEST', 'mr');
        newState = 'NAME_COLLECTION';
      } else {
        // Invalid selection, show language prompt again
        responseMessage = getLanguagePrompt(userLanguage);
      }
    }
    // Handle name collection state
    else if (currentState === 'NAME_COLLECTION') {
      // Store the user's name
      userSession.user_name = userMessage;
      await userSession.save();
      
      // Confirm the name was saved
      responseMessage = getText('NAME_CONFIRMATION', userLanguage, userMessage);
      
      // Then show the main menu
      responseMessage += '\n\n' + getMainMenu(userLanguage);
      newState = 'MENU';
    }
    // Handle menu state
    else if (currentState === 'MENU') {
      // User is at the main menu
      if (userMessage === '1' || userMessage === '2' || userMessage === '3' || 
          userMessage === '4' || userMessage === '5') {
      
        const captureUrl = getCaptureUrl(userNumber, userMessage);
        const instructions = getReportInstructionMessage(captureUrl, userLanguage);
        responseMessage = getText('CAMERA_INSTRUCTIONS', userLanguage, instructions);
        newState = 'AWAITING_REPORT';
        newLastOption = userMessage;
      } else if (userMessage === '6') {
        // Traffic signal information
        responseMessage = getText('TRAFFIC_SIGNAL_INFO', userLanguage);
        newState = 'MENU';
      } else if (userMessage === '7') {
        // Suggestion
        const captureUrl = getCaptureUrl(userNumber, userMessage);
        const instructions = getReportInstructionMessage(captureUrl, userLanguage);
        responseMessage = getText('CAMERA_INSTRUCTIONS', userLanguage, instructions);
        newState = 'AWAITING_SUGGESTION';
        newLastOption = userMessage;
      } else if (userMessage === '8') {
        // Join Traffic Buddy team
        responseMessage = getText('JOIN_REQUEST', userLanguage);
        newState = 'AWAITING_JOIN';
      } else {
        // Invalid option
        responseMessage = getMainMenu(userLanguage);
      }
    } else if (currentState === 'AWAITING_REPORT' || currentState === 'AWAITING_SUGGESTION') {
      // Determine report type based on last option
      let reportType = 'General Report';
      switch (lastOption) {
        case '1':
          reportType = 'Traffic Violation';
          break;
        case '2':
          reportType = 'Traffic Congestion';
          break;
        case '3':
          reportType = 'Accident';
          break;
        case '4':
          reportType = 'Road Damage';
          break;
        case '5':
          reportType = 'Illegal Parking';
          break;
        case '7':
          reportType = 'Suggestion';
          break;
        default:
          reportType = 'General Report';
      }

      // If location data is present, try to find the division
      let matchingDivision = null;
      if (latitude && longitude) {
        matchingDivision = await findDivisionForLocation(latitude, longitude);
        if (!matchingDivision) {
          console.log('Location is outside PCMC jurisdiction');
          responseMessage = getText('LOCATION_OUTSIDE_JURISDICTION', userLanguage);
          newState = 'MENU';
          newLastOption = null;

          // Update user session
          await updateUserSession(userSession, newState, newLastOption, newLanguage);

          // Send response back to the user
          console.log('Sending response:', responseMessage);
          await client.messages.create({
            from: 'whatsapp:+14155238886',
            to: userNumber,
            body: responseMessage
          });

          return res.status(200).send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
        }
      } else {
        // If no location data is provided, inform the user to provide location
        responseMessage = getText('LOCATION_MISSING_HINT', userLanguage);
        newState = 'AWAITING_LOCATION';
        newLastOption = lastOption;

        // Temporarily store the description and photo URL in the session
        userSession.last_description = userMessage;
        userSession.last_photo_url = mediaUrl;
        await userSession.save();

        // Update user session
        await updateUserSession(userSession, newState, newLastOption, newLanguage);

        // Send response back to the user
        console.log('Sending response:', responseMessage);
        await client.messages.create({
          from: 'whatsapp:+14155238886',
          to: userNumber,
          body: responseMessage
        });

        return res.status(200).send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
      }

      // If we reach here, a division was found
      // Create a new report with user's name
      const newQuery = new Query({
        user_id: userNumber,
        user_name: userSession.user_name || 'Anonymous',
        query_type: reportType,
        description: userMessage,
        photo_url: mediaUrl,
        location: { 
          latitude: parseFloat(latitude), 
          longitude: parseFloat(longitude),
          address: locationAddress || `${latitude}, ${longitude}`
        },
        status: 'Pending',
        division: matchingDivision._id,
        divisionName: matchingDivision.name,
        divisionNotified: false
      });

      // Notify division officers via WhatsApp if they exist
      let notifiedOfficers = [];
      let divisionNotified = false;

      try {
        if (matchingDivision.officers && matchingDivision.officers.length > 0) {
          const activeOfficers = matchingDivision.officers.filter(officer => officer.isActive);
          
          // Only notify up to 2 officers
          const officersToNotify = activeOfficers.slice(0, 2);
          
          if (officersToNotify.length > 0) {
            const notificationMessage = `🚨 New Traffic Report in ${matchingDivision.name}\n\n` +
              `Type: ${reportType}\n` +
              `Location: ${locationAddress || 'See map link'}\n` +
              `Description: ${userMessage}\n\n` +
              `To resolve this issue, click: https://trafficbuddy.pcmc.gov.in/resolve/pending`;
            
            // Send messages to officers
            for (const officer of officersToNotify) {
              try {
                await sendWhatsAppMessage(officer.phone, notificationMessage);
                console.log(`Notification sent to officer: ${officer.name} (${officer.phone})`);
                
                // Record that officer was notified
                notifiedOfficers.push({
                  phone: officer.phone,
                  timestamp: new Date()
                });
              } catch (officerError) {
                console.error(`Failed to notify officer ${officer.name} (${officer.phone}):`, officerError);
              }
            }
            
            // Set divisionNotified to true if at least one officer was notified
            if (notifiedOfficers.length > 0) {
              divisionNotified = true;
            }
          } else {
            console.log('No active officers to notify for this division');
          }
        } else {
          console.log('No officers found for this division');
        }
      } catch (notificationError) {
        console.error('Error notifying division officers:', notificationError);
      }

      // Only save the query if divisionNotified is true
      if (!divisionNotified) {
        console.log('Division was not notified. Query will not be saved.');
        responseMessage = getText('NOTIFICATION_FAILED', userLanguage);
        newState = 'MENU';
        newLastOption = null;

        // Update user session
        await updateUserSession(userSession, newState, newLastOption, newLanguage);

        // Send response back to the user
        console.log('Sending response:', responseMessage);
        await client.messages.create({
          from: 'whatsapp:+14155238886',
          to: userNumber,
          body: responseMessage
        });

        return res.status(200).send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
      }

      // Update the query object with notification details and save it
      newQuery.divisionNotified = true;
      newQuery.divisionOfficersNotified = notifiedOfficers;
      await newQuery.save();
      console.log(`Saved ${reportType} report to database with division: ${matchingDivision.name}`);

      // Update the notification message with the actual query ID
      if (notifiedOfficers.length > 0) {
        const updatedNotificationMessage = `🚨 New Traffic Report in ${matchingDivision.name}\n\n` +
          `Type: ${reportType}\n` +
          `Location: ${locationAddress || 'See map link'}\n` +
          `Description: ${userMessage}\n\n` +
          `To resolve this issue, click: https://trafficbuddy.pcmc.gov.in/resolve/${newQuery._id}`;
        
        // Resend the notification with the correct link
        for (const officer of notifiedOfficers) {
          try {
            await sendWhatsAppMessage(officer.phone, updatedNotificationMessage);
            console.log(`Updated notification sent to officer with correct link: ${officer.phone}`);
          } catch (updateError) {
            console.error(`Failed to send updated notification to ${officer.phone}:`, updateError);
          }
        }
      }

      // Send email notification
      try {
        await sendQueryNotification(newQuery, matchingDivision);
        console.log('Email notification sent');
      } catch (emailError) {
        console.error('Error sending email notification:', emailError);
      }

      // Send confirmation to user
      responseMessage = getText('REPORT_RESPONSE', userLanguage, reportType, !!mediaUrl);
      newState = 'MENU';
      newLastOption = null;
    } else if (currentState === 'AWAITING_LOCATION') {
      // User should have sent location data
      if (latitude && longitude) {
        const matchingDivision = await findDivisionForLocation(latitude, longitude);
        if (!matchingDivision) {
          console.log('Location is outside PCMC jurisdiction');
          responseMessage = getText('LOCATION_OUTSIDE_JURISDICTION', userLanguage);
          newState = 'MENU';
          newLastOption = null;

          // Update user session
          await updateUserSession(userSession, newState, newLastOption, newLanguage);

          // Send response back to the user
          console.log('Sending response:', responseMessage);
          await client.messages.create({
            from: 'whatsapp:+14155238886',
            to: userNumber,
            body: responseMessage
          });

          return res.status(200).send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
        }

        // Determine report type based on last option
        let reportType = 'General Report';
        switch (lastOption) {
          case '1':
            reportType = 'Traffic Violation';
            break;
          case '2':
            reportType = 'Traffic Congestion';
            break;
          case '3':
            reportType = 'Accident';
            break;
          case '4':
            reportType = 'Road Damage';
            break;
          case '5':
            reportType = 'Illegal Parking';
            break;
          case '7':
            reportType = 'Suggestion';
            break;
          default:
            reportType = 'General Report';
        }

        // Retrieve description and photo URL from session
        const description = userSession.last_description || 'No description provided';
        const photoUrl = userSession.last_photo_url || null;

        // Create a new report with user's name
        const newQuery = new Query({
          user_id: userNumber,
          user_name: userSession.user_name || 'Anonymous',
          query_type: reportType,
          description: description,
          photo_url: photoUrl,
          location: { 
            latitude: parseFloat(latitude), 
            longitude: parseFloat(longitude),
            address: locationAddress || `${latitude}, ${longitude}`
          },
          status: 'Pending',
          division: matchingDivision._id,
          divisionName: matchingDivision.name,
          divisionNotified: false
        });

        // Notify division officers via WhatsApp if they exist
        let notifiedOfficers = [];
        let divisionNotified = false;

        try {
          if (matchingDivision.officers && matchingDivision.officers.length > 0) {
            const activeOfficers = matchingDivision.officers.filter(officer => officer.isActive);
            
            // Only notify up to 2 officers
            const officersToNotify = activeOfficers.slice(0, 2);
            
            if (officersToNotify.length > 0) {
              const notificationMessage = `🚨 New Traffic Report in ${matchingDivision.name}\n\n` +
                `Type: ${reportType}\n` +
                `Location: ${locationAddress || 'See map link'}\n` +
                `Description: ${description}\n\n` +
                `To resolve this issue, click: https://trafficbuddy.pcmc.gov.in/resolve/pending`;
              
              // Send messages to officers
              for (const officer of officersToNotify) {
                try {
                  await sendWhatsAppMessage(officer.phone, notificationMessage);
                  console.log(`Notification sent to officer: ${officer.name} (${officer.phone})`);
                  
                  // Record that officer was notified
                  notifiedOfficers.push({
                    phone: officer.phone,
                    timestamp: new Date()
                  });
                } catch (officerError) {
                  console.error(`Failed to notify officer ${officer.name} (${officer.phone}):`, officerError);
                }
              }
              
              // Set divisionNotified to true if at least one officer was notified
              if (notifiedOfficers.length > 0) {
                divisionNotified = true;
              }
            } else {
              console.log('No active officers to notify for this division');
            }
          } else {
            console.log('No officers found for this division');
          }
        } catch (notificationError) {
          console.error('Error notifying division officers:', notificationError);
        }

        // Only save the query if divisionNotified is true
        if (!divisionNotified) {
          console.log('Division was not notified. Query will not be saved.');
          responseMessage = getText('NOTIFICATION_FAILED', userLanguage);
          newState = 'MENU';
          newLastOption = null;

          // Update user session
          await updateUserSession(userSession, newState, newLastOption, newLanguage);

          // Send response back to the user
          console.log('Sending response:', responseMessage);
          await client.messages.create({
            from: 'whatsapp:+14155238886',
            to: userNumber,
            body: responseMessage
          });

          return res.status(200).send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
        }

        // Update the query object with notification details and save it
        newQuery.divisionNotified = true;
        newQuery.divisionOfficersNotified = notifiedOfficers;
        await newQuery.save();
        console.log(`Saved ${reportType} report to database with division: ${matchingDivision.name}`);

        // Update the notification message with the actual query ID
        if (notifiedOfficers.length > 0) {
          const updatedNotificationMessage = `🚨 New Traffic Report in ${matchingDivision.name}\n\n` +
            `Type: ${reportType}\n` +
            `Location: ${locationAddress || 'See map link'}\n` +
            `Description: ${description}\n\n` +
            `To resolve this issue, click: https://trafficbuddy.pcmc.gov.in/resolve/${newQuery._id}`;
          
          // Resend the notification with the correct link
          for (const officer of notifiedOfficers) {
            try {
              await sendWhatsAppMessage(officer.phone, updatedNotificationMessage);
              console.log(`Updated notification sent to officer with correct link: ${officer.phone}`);
            } catch (updateError) {
              console.error(`Failed to send updated notification to ${officer.phone}:`, updateError);
            }
          }
        }

        // Send email notification
        try {
          await sendQueryNotification(newQuery, matchingDivision);
          console.log('Email notification sent');
        } catch (emailError) {
          console.error('Error sending email notification:', emailError);
        }

        // Send confirmation to user
        responseMessage = getText('REPORT_RESPONSE', userLanguage, reportType, !!photoUrl);
        newState = 'MENU';
        newLastOption = null;

        // Clear temporary session data
        userSession.last_description = null;
        userSession.last_photo_url = null;
        await userSession.save();
      } else {
        responseMessage = getText('LOCATION_MISSING_HINT', userLanguage);
        newState = 'AWAITING_LOCATION';
      }
    } else if (currentState === 'AWAITING_JOIN') {
      // Process join request
      // Join requests don't require location/division, so we can save them directly
      const infoLines = userMessage.split('\n');
      let name = '';
      let email = '';
      let phone = '';
      let location = '';
      
      for (const line of infoLines) {
        if (line.toLowerCase().includes('name:')) {
          name = line.split(':')[1]?.trim() || '';
        } else if (line.toLowerCase().includes('email:')) {
          email = line.split(':')[1]?.trim() || '';
        } else if (line.toLowerCase().includes('phone:')) {
          phone = line.split(':')[1]?.trim() || '';
        } else if (line.toLowerCase().includes('location:')) {
          location = line.split(':')[1]?.trim() || '';
        }
      }
      
      // Create a new join request
      const joinQuery = new Query({
        user_id: userNumber,
        user_name: userSession.user_name || 'Anonymous',
        query_type: 'Join Request',
        name: name,
        email: email,
        phone: phone,
        description: userMessage,
        status: 'Pending'
      });
      
      await joinQuery.save();
      console.log('Saved join request to database');
      
      // Send email notification
      try {
        await sendQueryNotification(joinQuery);
        console.log('Email notification sent');
      } catch (emailError) {
        console.error('Error sending email notification:', emailError);
      }
      
      // Send confirmation to user
      responseMessage = getText('JOIN_RESPONSE', userLanguage);
      newState = 'MENU';
      newLastOption = null;
    } else {
      // Default behavior for any other state
      responseMessage = getMainMenu(userLanguage);
      newState = 'MENU';
      newLastOption = null;
    }

    // Update user session with new state using the helper function
    await updateUserSession(userSession, newState, newLastOption, newLanguage);

    // Send response back to the user
    console.log('Sending response:', responseMessage);

    const message = await client.messages.create({
      from: 'whatsapp:+14155238886',
      to: userNumber,
      body: responseMessage
    });

    console.log(`Response sent with SID: ${message.sid}`);

    // Respond to Twilio webhook with success
    res.status(200).send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
  } catch (error) {
    console.error('Error processing webhook:', error);
    res.status(500).send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
  }
});

app.get('/api/divisions', async (req, res) => {
  try {
    const divisions = await Division.find().select('name code');
    return res.status(200).json({ success: true, divisions });
  } catch (error) {
    console.error('Error fetching divisions:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
});

// Get a specific division
app.get('/api/divisions/:divisionId', async (req, res) => {
  try {
    const division = await Division.findById(req.params.divisionId).select('-dashboard_credentials.password');
    
    if (!division) {
      return res.status(404).json({ success: false, message: 'Division not found' });
    }
    
    return res.status(200).json({ success: true, division });
  } catch (error) {
    console.error('Error fetching division:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
});

app.get('/reset-all-sessions', async (req, res) => {
  try {
    await Session.updateMany({}, { current_state: 'LANGUAGE_SELECT' });
    res.status(200).json({ message: 'All sessions reset to language selection' });
  } catch (error) {
    console.error('Error resetting sessions:', error);
    res.status(500).json({ error: 'Failed to reset sessions' });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

// Connect to database before starting server
(async () => {
  try {
    await connectDB();
    
    // Start the server
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => {
      console.log(`Server is running on port ${PORT}`);
    });
  } catch (err) {
    console.error('Failed to connect to database. Server not started.');
    console.error(err);
  }
})();