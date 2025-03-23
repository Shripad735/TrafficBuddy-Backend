// utils/whatsapp.js
require('dotenv').config();
const twilio = require('twilio');

// Twilio credentials
const accountSid = process.env.TWILIO_SID || 'your_account_sid';
const authToken = process.env.TWILIO_AUTH_TOKEN || 'your_auth_token';
const client = twilio(accountSid, authToken);

/**
 * Get Twilio client instance
 * @returns {Object} - Twilio client
 */
exports.getTwilioClient = () => client;

/**
 * Send a WhatsApp message using Twilio
 * @param {string} to - Recipient's WhatsApp number in format 'whatsapp:+1234567890'
 * @param {string} body - Message body text
 * @returns {Promise} - Twilio message response
 */
exports.sendWhatsAppMessage = async (to, body) => {
  try {
    // Ensure the 'to' number starts with 'whatsapp:+'
    const formattedTo = to.startsWith('whatsapp:+') ? to : `whatsapp:+${to.replace(/^\+/, '')}`;
    const message = await client.messages.create({
      from: 'whatsapp:+14155238886', // Your Twilio WhatsApp number
      to: formattedTo, // Fixed: Now ensures the 'to' starts with 'whatsapp:+'
      body: body
    });
    
    console.log(`WhatsApp message sent with SID: ${message.sid}`);
    return message;
  } catch (error) {
    console.error('Error sending WhatsApp message:', error);
    throw error;
  }
};

/**
 * Notify division officers about new queries
 * @param {Object} query - The traffic query object
 * @param {Object} division - The division object containing officers
 * @returns {Promise<Array>} - List of notified officers
 */
exports.notifyDivisionOfficers = async (query, division) => {
  if (!division || !division.officers || division.officers.length === 0) {
    console.log('No officers to notify for division');
    return [];
  }
  
  // Get Twilio client - fixed: using the exported function
  const client = exports.getTwilioClient();
  
  // Get the first officer regardless of active status
  const officerToNotify = division.officers[0];
  const notifiedContacts = [];
  
  try {
    const location = query.location?.address || `${query.location?.latitude}, ${query.location?.longitude}`;
    
    // Create notification message
    const notificationMessage = `🚨 New Traffic Report in ${division.name}\n\n` +
      `Type: ${query.queryType}\n` +
      `Location: ${query.location?.address || 'See map link'}\n` +
      `Description: ${query.description}\n\n` +
      `To resolve this issue, click: ${process.env.SERVER_URL}/resolve.html?id=${query._id}`;
    
    // Phone numbers to notify
    const phoneNumbers = [];
    
    // Add officer's primary phone
    if (officerToNotify?.phone) {
      phoneNumbers.push(officerToNotify.phone);
    }
    
    // Add alternate phone if it exists
    if (officerToNotify?.alternate_phone) {
      phoneNumbers.push(officerToNotify.alternate_phone);
    }
    
    // Send messages to both phone numbers
    for (const phone of phoneNumbers) {
      try {
        // Ensure the 'to' number starts with 'whatsapp:+'
        const formattedPhone = phone.startsWith('whatsapp:+') ? phone : `whatsapp:+${phone.replace(/^\+/, '')}`;
        await client.messages.create({
          from: 'whatsapp:+14155238886',
          to: formattedPhone,
          body: notificationMessage
        });
        
        console.log(`Notification sent to ${formattedPhone}`);
        
        notifiedContacts.push({
          phone: phone,
          timestamp: new Date()
        });
      } catch (error) {
        console.error(`Error sending notification to ${phone}:`, error);
      }
    }
    
    return notifiedContacts;
  } catch (error) {
    console.error('Error in notifyDivisionOfficers:', error);
    return [];
  }
};