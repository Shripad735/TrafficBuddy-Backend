const nodemailer = require('nodemailer');

// Create email transporter using environment variables
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

/**
 * Sends an email notification about a new query
 * @param {Object} query - The query object from MongoDB
 * @returns {Promise} - Resolves when email is sent
 */
const sendQueryNotification = async (query) => {
  try {
    // Format the date and time
    const formattedDate = new Date(query.timestamp).toLocaleString('en-IN', {
      timeZone: 'Asia/Kolkata',
      dateStyle: 'medium',
      timeStyle: 'medium'
    });

    // Generate HTML content for the email
    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>New Traffic Buddy Report</title>
        <style>
          body {
            font-family: Arial, sans-serif;
            line-height: 1.6;
            color: #333;
          }
          .container {
            max-width: 600px;
            margin: 0 auto;
            padding: 20px;
            border: 1px solid #ddd;
            border-radius: 5px;
          }
          .header {
            background-color: #00439c;
            color: white;
            padding: 15px;
            border-radius: 5px 5px 0 0;
            text-align: center;
          }
          .header img {
            max-height: 80px;
          }
          .content {
            padding: 20px;
            background-color: #f9f9f9;
          }
          .footer {
            text-align: center;
            margin-top: 20px;
            font-size: 12px;
            color: #777;
          }
          table {
            width: 100%;
            border-collapse: collapse;
          }
          table td, table th {
            border: 1px solid #ddd;
            padding: 8px;
          }
          table th {
            background-color: #f2f2f2;
            text-align: left;
          }
          .photo {
            max-width: 100%;
            margin: 15px 0;
            border: 1px solid #ddd;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h2>🚦 New Traffic Buddy Report 🚦</h2>
          </div>
          <div class="content">
            <h3>Report Details</h3>
            <table>
              <tr>
                <th>Report Type</th>
                <td>${query.query_type}</td>
              </tr>
              <tr>
                <th>Submitted By</th>
                <td>${query.user_id}</td>
              </tr>
              <tr>
                <th>Date & Time</th>
                <td>${formattedDate}</td>
              </tr>
              <tr>
                <th>Status</th>
                <td>${query.status}</td>
              </tr>
              ${query.name ? `<tr><th>Name</th><td>${query.name}</td></tr>` : ''}
              ${query.email ? `<tr><th>Email</th><td>${query.email}</td></tr>` : ''}
              ${query.phone ? `<tr><th>Phone</th><td>${query.phone}</td></tr>` : ''}
              ${query.description ? `<tr><th>Description</th><td>${query.description}</td></tr>` : ''}
              ${query.vehicle_number ? `<tr><th>Vehicle Number</th><td>${query.vehicle_number}</td></tr>` : ''}
            </table>
            
            ${query.location && (query.location.latitude || query.location.longitude) ? 
              `<h3>Location Information</h3>
               <p>Latitude: ${query.location.latitude}, Longitude: ${query.location.longitude}</p>
               <p><a href="https://maps.google.com/?q=${query.location.latitude},${query.location.longitude}" target="_blank">View on Google Maps</a></p>` 
              : ''}
            
            ${query.photo_url ? 
              `<h3>Attached Photo</h3>
               <img src="${query.photo_url}" alt="Report Photo" class="photo">` 
              : ''}
          </div>
          <div class="footer">
            <p>This is an automated notification from Traffic Buddy. Please do not reply to this email.</p>
            <p>&copy; ${new Date().getFullYear()} Traffic Buddy. All rights reserved.</p>
          </div>
        </div>
      </body>
      </html>
    `;

    // Email options
    const mailOptions = {
      from: {
        name: 'TrafficBuddy',
        address: process.env.EMAIL_USER
      },
      to: 'shripadkhandare2020@gmail.com',
      subject: `New Traffic Buddy ${query.query_type} Report`,
      html: htmlContent
    };

    // Send email
    const info = await transporter.sendMail(mailOptions);
    console.log('Email notification sent:', info.messageId);
    return info;
  } catch (error) {
    console.error('Error sending email notification:', error);
    throw error;
  }
};

module.exports = {
  sendQueryNotification
};