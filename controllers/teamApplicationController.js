const TeamApplication = require('../models/TeamApplication');
const Session = require('../models/Session');
const { uploadImageToR2 } = require('../utils/imageupload');
const { sendWhatsAppMessage } = require('../utils/whatsapp');
const { getText } = require('../utils/language');

// Create a new application session
exports.createApplicationSession = async (req, res) => {
  try {
    const { userId, language = 'en' } = req.body;
    
    // Check if user exists in session
    const session = await Session.findOne({ user_id: userId });
    if (!session) {
      return res.status(404).json({
        success: false,
        message: 'User session not found'
      });
    }
    
    // Generate unique session ID for the application
    const sessionId = `join_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;
    
    // Calculate session expiry (24 hours from now)
    const sessionExpires = new Date();
    sessionExpires.setHours(sessionExpires.getHours() + 24);
    
    // Generate the form URL
    const formUrl = `${process.env.SERVER_URL}/join-team.html?userId=${encodeURIComponent(userId)}&sessionId=${sessionId}`;
    
    // Send WhatsApp message with form link
    await sendWhatsAppMessage(
      userId,
      getText('JOIN_FORM_LINK', language, formUrl)
    );
    
    return res.status(200).json({
      success: true,
      message: 'Join form link sent',
      sessionId,
      formUrl
    });
  } catch (error) {
    console.error('Error creating application session:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
};

// Process form submission
exports.submitApplication = async (req, res) => {
  try {
    const { 
      userId, 
      sessionId, 
      fullName, 
      division,
      motivation,
      address,
      phone,
      email,
      aadharNumber
    } = req.body;
    
    // Validate required fields
    if (!userId || !sessionId || !fullName || !division || !motivation || !address || !phone || !email || !aadharNumber) {
      return res.status(400).json({
        success: false,
        error: 'All fields are required'
      });
    }
    
    // Check if there's a valid user session
    const userSession = await Session.findOne({ user_id: userId });
    if (!userSession) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }
    
    // Calculate session expiry (24 hours from now)
    const sessionExpires = new Date();
    sessionExpires.setHours(sessionExpires.getHours() + 24);
    
    // Process aadhar document if provided
    let aadharDocumentUrl = null;
    if (req.file) {
      const imageBuffer = req.file.buffer;
      const base64Image = `data:${req.file.mimetype};base64,${imageBuffer.toString('base64')}`;
      aadharDocumentUrl = await uploadImageToR2(base64Image, 'TrafficBuddyDocs');
    } else {
      return res.status(400).json({
        success: false,
        error: 'Aadhar document is required'
      });
    }
    
    // Create new application
    const application = new TeamApplication({
      user_id: userId,
      user_name: userSession.user_name || 'Unknown',
      full_name: fullName,
      division,
      motivation,
      address,
      phone,
      email,
      aadhar_number: aadharNumber,
      aadhar_document_url: aadharDocumentUrl,
      status: 'Pending',
      session_id: sessionId,
      session_expires: sessionExpires
    });
    
    await application.save();
    
    // Send confirmation message via WhatsApp
    await sendWhatsAppMessage(
      userId,
      getText('JOIN_APPLICATION_RECEIVED', userSession.language || 'en', fullName)
    );
    
    return res.status(201).json({
      success: true,
      message: 'Application submitted successfully',
      applicationId: application._id
    });
  } catch (error) {
    console.error('Error submitting application:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error. Please try again later.'
    });
  }
};

// Get all applications with pagination and filtering
exports.getAllApplications = async (req, res) => {
  try {
    const { page = 1, limit = 10, status, division } = req.query;
    const skip = (page - 1) * limit;

    let filter = {};
    if (status) filter.status = status;
    if (division) filter.division = division;

    const applications = await TeamApplication.find(filter)
      .sort({ applied_at: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await TeamApplication.countDocuments(filter);

    return res.status(200).json({
      success: true,
      count: applications.length,
      total,
      totalPages: Math.ceil(total / limit),
      currentPage: parseInt(page),
      data: applications
    });
  } catch (error) {
    console.error('Error fetching applications:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
};

// Update application status
exports.updateApplicationStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, verification_notes, verified_by } = req.body;

    if (!['Pending', 'Approved', 'Rejected'].includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid status value'
      });
    }

    const application = await TeamApplication.findById(id);
    if (!application) {
      return res.status(404).json({
        success: false,
        message: 'Application not found'
      });
    }

    application.status = status;
    application.verification_notes = verification_notes || '';
    
    if (status !== 'Pending') {
      application.processed_at = new Date();
      application.verified_by = verified_by;
    }

    await application.save();

    // Send status update via WhatsApp
    const userSession = await Session.findOne({ user_id: application.user_id });
    const language = userSession?.language || 'en';
    
    await sendWhatsAppMessage(
      application.user_id,
      getText(`TEAM_APPLICATION_${status.toUpperCase()}`, language, application.full_name, verification_notes || '')
    );

    return res.status(200).json({
      success: true,
      message: `Application ${status.toLowerCase()} successfully`,
      data: application
    });
  } catch (error) {
    console.error('Error updating application:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
};