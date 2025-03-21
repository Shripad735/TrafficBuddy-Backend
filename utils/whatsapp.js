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