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

// Import routes
const uploadRoutes = require('./routes/upload');
const queryRoutes = require('./routes/queryRoutes');
const dashboardRoutes = require('./routes/dashboardRoutes');

// Check for required environment variables
const requiredEnvVars = [
  'CLOUDFLARE_R2_BUCKET_NAME',
  'CLOUDFLARE_R2_ENDPOINT',
  'CLOUDFLARE_R2_ACCESS_KEY',
  'CLOUDFLARE_R2_SECRET_KEY',
  'CLOUDFLARE_R2_PUBLIC_URL',
  'TWILIO_AUTH_TOKEN',
  'EMAIL_USER',
  'EMAIL_PASS'
];

const missingEnvVars = requiredEnvVars.filter(envVar => !process.env[envVar]);

if (missingEnvVars.length > 0) {
  console.error('Missing required environment variables:');
  missingEnvVars.forEach(envVar => console.error(`- ${envVar}`));
  console.error('Please check your .env file');
} else {
  console.log('All required environment variables found');
}

// Initialize Express app
const app = express();
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

//cors


// Enable CORS
app.use(cors({
  origin: ['http://localhost:5173', 'http://localhost:3000', 'https://yourdomain.com'],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Configure CORS headers
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  if (req.method === 'OPTIONS') {
    res.header('Access-Control-Allow-Methods', 'PUT, POST, PATCH, DELETE, GET');
    return res.status(200).json({});
  }
  next();
});

// Use routes
app.use('/api/upload', uploadRoutes);
app.use('/api/queries', queryRoutes);
app.use('/api/dashboard', dashboardRoutes);

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
    // Get the media URL directly from the request
    const mediaUrl = body.MediaUrl0;
    const contentType = body.MediaContentType0 || 'image/jpeg';

    if (!mediaUrl) {
      console.error('No media URL found in the request');
      return null;
    }

    console.log(`Media URL: ${mediaUrl}`);
    console.log(`Content Type: ${contentType}`);

    // Create a basic auth header
    const auth = Buffer.from(`${accountSid}:${authToken}`).toString('base64');

    // Download the media with proper authentication
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

    // Convert to base64 and upload to R2
    const base64Data = Buffer.from(response.data).toString('base64');
    const base64Image = `data:${contentType};base64,${base64Data}`;

    // Upload to Cloudflare R2
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
    
    // Then update the newQuery creation
    const newQuery = new Query({
      user_id: userId,
      user_name: userName, // Include user's name
      query_type: queryType,
      description: description,
      photo_url: uploadedUrl,
      location: { 
        latitude: parseFloat(latitude), 
        longitude: parseFloat(longitude),
        address: address || `${latitude}, ${longitude}`
      },
      status: 'Pending'
    });
    
    await newQuery.save();
    console.log(`Saved ${queryType} report to database`);
    
    // Send email notification
    try {
      await sendQueryNotification(newQuery);
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
      
      // Create a new report with user's name
      const newQuery = new Query({
        user_id: userNumber,
        user_name: userSession.user_name || 'Anonymous', // Include user's name
        query_type: reportType,
        description: userMessage,
        photo_url: mediaUrl,
        location: { latitude: null, longitude: null },
        status: 'Pending'
      });
      
      await newQuery.save();
      console.log(`Saved ${reportType} report to database`);
      
      // Send email notification
      try {
        await sendQueryNotification(newQuery);
        console.log('Email notification sent');
      } catch (emailError) {
        console.error('Error sending email notification:', emailError);
      }
      
      // Send confirmation to user
      responseMessage = getText('REPORT_RESPONSE', userLanguage, reportType, !!mediaUrl);
      newState = 'MENU';
      newLastOption = null;
    } else if (currentState === 'AWAITING_JOIN') {
      // Process join request
      // Store user information
      // Assuming the message format is "Name: John Doe\nEmail: john@example.com\nPhone: 1234567890"
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
        user_name: userSession.user_name || 'Anonymous', // Include user's name
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