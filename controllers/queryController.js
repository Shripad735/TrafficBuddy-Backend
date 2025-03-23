const Query = require('../models/Query');
const Division = require('../models/Division');
const { sendWhatsAppMessage } = require('../utils/whatsapp');
const { getText } = require('../utils/language');
const Session = require('../models/Session');
const { sendQueryEmail } = require('../utils/email');
const mongoose = require('mongoose');


// Get all queries (with pagination and filtering)
exports.getAllQueries = async (req, res) => {
  try {
    const { 
      page = 1, 
      limit = 10, 
      status, 
      query_type,
      sort = 'timestamp',
      order = 'desc',
      search,
      division
    } = req.query;
    
    const skip = (page - 1) * limit;
    
    // Build filter object
    let filter = {};
    
    if (status) {
      filter.status = status;
    }
    
    if (query_type) {
      filter.query_type = query_type;
    }
    
    // Filter by division if specified (for division dashboards)
    if (division && division !== 'NOT_SPECIFIED') {
      // Handle both ObjectId and string representations
      if (mongoose.Types.ObjectId.isValid(division)) {
        filter.division = new mongoose.Types.ObjectId(division);
      } else {
        // If a division code is provided instead of an ID
        const divisionDoc = await Division.findOne({ code: division });
        if (divisionDoc) {
          filter.division = divisionDoc._id;
        }
      }
    }
    // Check if user role is division_admin (from auth middleware)
    if (req.user && req.user.role === 'division_admin' && req.user.divisionId) {
      // Override any division filter - division admins can only see their own division's data
      filter.division = new mongoose.Types.ObjectId(req.user.divisionId);
    }
    
    // Search functionality
    if (search) {
      filter.$or = [
        { description: { $regex: search, $options: 'i' } },
        { user_name: { $regex: search, $options: 'i' } },
        { vehicle_number: { $regex: search, $options: 'i' } },
        { 'location.address': { $regex: search, $options: 'i' } }
      ];
    }
    
    // Set up sorting
    const sortDirection = order.toLowerCase() === 'asc' ? 1 : -1;
    const sortOptions = {};
    sortOptions[sort] = sortDirection;
    
    // Execute query with pagination
    const queries = await Query.find(filter)
      .populate('division', 'name code')
      .sort(sortOptions)
      .skip(skip)
      .limit(parseInt(limit));
    
    // Get total count for pagination
    const totalQueries = await Query.countDocuments(filter);
    
    return res.status(200).json({
      success: true,
      count: queries.length,
      total: totalQueries,
      totalPages: Math.ceil(totalQueries / limit),
      currentPage: parseInt(page),
      data: queries
    });
  } catch (error) {
    console.error('Error fetching queries:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
};

// Get query by ID
exports.getQueryById = async (req, res) => {
  try {
    const { id } = req.params;
    
    const query = await Query.findById(id);
    
    if (!query) {
      return res.status(404).json({
        success: false,
        message: 'Query not found'
      });
    }
    
    return res.status(200).json({
      success: true,
      data: query
    });
  } catch (error) {
    console.error('Error fetching query:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
};

// Update query status
// Update the updateQueryStatus function

exports.updateQueryStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, resolution_note } = req.body;
    
    if (!['Pending', 'In Progress', 'Resolved', 'Rejected'].includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid status value'
      });
    }
    
    // Find the query by ID
    const query = await Query.findById(id);
    
    if (!query) {
      return res.status(404).json({
        success: false,
        message: 'Query not found'
      });
    }
    
    // Update status and add resolution note if provided
    query.status = status;
    if (resolution_note) {
      query.resolution_note = resolution_note;
    }
    
    // If status is being changed to Resolved, add resolution timestamp
    if (status === 'Resolved') {
      query.resolved_at = new Date();
    }
    
    await query.save();
    
    // Get the user's language preference for WhatsApp notification
    const userSession = await Session.findOne({ user_id: query.user_id });
    const userLanguage = userSession?.language || 'en';
    
    // Send WhatsApp notification to user about status change
    if (query.user_id && query.user_id.startsWith('whatsapp:')) {
      try {
        console.log(`Sending status update to ${query.user_id}`);
        
        // Format query type for message
        const queryTypeForMessage = query.query_type || 'report';
        
        // Prepare status update message with proper string formatting
        let statusMessage = '';
        
        if (status === 'In Progress') {
          // Replace placeholder with actual value
          statusMessage = getText('STATUS_IN_PROGRESS', userLanguage)
            .replace('{0}', queryTypeForMessage.toLowerCase());
        } else if (status === 'Resolved') {
          // Replace placeholders with actual values
          statusMessage = getText('STATUS_RESOLVED', userLanguage)
            .replace('{0}', queryTypeForMessage.toLowerCase())
            .replace('{1}', resolution_note || 'No additional details provided.');
        } else if (status === 'Rejected') {
          // Replace placeholders with actual values
          statusMessage = getText('STATUS_REJECTED', userLanguage)
            .replace('{0}', queryTypeForMessage.toLowerCase())
            .replace('{1}', resolution_note || 'No reason specified.');
        }
        
        if (statusMessage) {
          console.log('Message to be sent:', statusMessage);
          
          // Send the message
          const messageSent = await sendWhatsAppMessage(query.user_id, statusMessage);
          console.log('WhatsApp message status update sent successfully:', messageSent.sid);
        }
      } catch (notificationError) {
        console.error('Error sending WhatsApp notification:', notificationError);
        // Don't fail the request if notification fails
      }
    } else {
      console.log('Cannot send status update - invalid user ID format:', query.user_id);
    }
    
    return res.status(200).json({
      success: true,
      message: `Query status updated to ${status}`,
      data: query
    });
  } catch (error) {
    console.error('Error updating query status:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
};

// Get queries by type
exports.getQueriesByType = async (req, res) => {
  try {
    const { type } = req.params;
    const { page = 1, limit = 10 } = req.query;
    
    const skip = (page - 1) * limit;
    
    const queries = await Query.find({ query_type: type })
      .sort({ timestamp: -1 })
      .skip(skip)
      .limit(parseInt(limit));
    
    const totalQueries = await Query.countDocuments({ query_type: type });
    
    return res.status(200).json({
      success: true,
      count: queries.length,
      total: totalQueries,
      totalPages: Math.ceil(totalQueries / limit),
      currentPage: parseInt(page),
      data: queries
    });
  } catch (error) {
    console.error('Error fetching queries by type:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
};

// Get query statistics


// Delete a query (admin feature)
exports.deleteQuery = async (req, res) => {
  try {
    const { id } = req.params;
    
    const query = await Query.findById(id);
    
    if (!query) {
      return res.status(404).json({
        success: false,
        message: 'Query not found'
      });
    }
    
    await Query.findByIdAndDelete(id);
    
    return res.status(200).json({
      success: true,
      message: 'Query deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting query:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
};


// Send query information to department via email
exports.notifyDepartmentByEmail = async (req, res) => {
  try {
    const { id } = req.params;
    const { email, departmentName } = req.body;
    
    // Validation
    if (!email || !departmentName) {
      return res.status(400).json({
        success: false,
        message: 'Email address and department name are required'
      });
    }
    
    // Find the query by ID
    const query = await Query.findById(id);
    
    if (!query) {
      return res.status(404).json({
        success: false,
        message: 'Query not found'
      });
    }
    
    // Generate subject based on query type and ID
    const subject = `Traffic Buddy: ${query.query_type} Report - Ref #${query._id.toString().slice(-6)}`;
    
    // Send email
    await sendQueryEmail(email, subject, query, departmentName);
    
    // Update query to track notification
    query.notifications = query.notifications || [];
    query.notifications.push({
      type: 'email',
      recipient: email,
      department: departmentName,
      timestamp: new Date()
    });
    
    await query.save();
    
    return res.status(200).json({
      success: true,
      message: `Query details successfully sent to ${departmentName} at ${email}`,
      notificationCount: query.notifications ? query.notifications.length : 0
    });
  } catch (error) {
    console.error('Error sending query notification email:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
};


// function to brodcast message to all users
exports.broadcastMessage = async (req, res) => {
  try {
    const { message } = req.body;
    
    if (!message) {
      return res.status(400).json({
        success: false,
        message: 'Message is required'
      });
    }
    
    // Get all active sessions
    const activeSessions = await Session.find({ active: true });
    
    // Send message to each active session
    activeSessions.forEach(async (session) => {
      try {
        // Send the message
        const messageSent = await sendWhatsAppMessage(session.user_id, message);
        console.log('WhatsApp message sent successfully:', messageSent.sid);
      } catch (error) {
        console.error('Error sending WhatsApp message:', error);
        // Don't fail the request if notification fails
      }
    });
    
    return res.status(200).json({
      success: true,
      message: 'Message broadcast successfully'
    });
  } catch (error) {
    console.error('Error broadcasting message:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
};

//brodcase msg to volunteers in a specific area
exports.broadcastMessageToVolunteers = async (req, res) => {
  try {
    const { message, area } = req.body;
    
    if (!message || !area) {
      return res.status(400).json({
        success: false,
        message: 'Message and area are required'
      });
    }
    
    // Get all active sessions in the area
    const activeSessions = await Session.find({ 
      active: true,
      'location.area': area
    });
    
    // Send message to each active session
    activeSessions.forEach(async (session) => {
      try {
        // Send the message
        const messageSent = await sendWhatsAppMessage(session.user_id, message);
        console.log('WhatsApp message sent successfully:', messageSent.sid);
      } catch (error) {
        console.error('Error sending WhatsApp message:', error);
        // Don't fail the request if notification fails
      }
    });
    
    return res.status(200).json({
      success: true,
      message: 'Message broadcast successfully'
    });
  } catch (error) {
    console.error('Error broadcasting message:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
};


exports.getQueriesByDivision = async (req, res) => {
  try {
    const { division } = req.params;
    
    let filter = {};
    if (division && division !== 'NOT_SPECIFIED') {
      // Handle both ObjectId and string representations
      if (mongoose.Types.ObjectId.isValid(division)) {
        filter.division = new mongoose.Types.ObjectId(division);
      } else {
        // If a division code is provided instead of an ID
        const divisionDoc = await Division.findOne({ code: division });
        if (divisionDoc) {
          filter.division = divisionDoc._id;
        }
      }
    }
    
    // Check if user role is division_admin (from auth middleware)
    if (req.user && req.user.role === 'division_admin' && req.user.divisionId) {
      // Override any division filter - division admins can only see their own division's data
      filter.division = new mongoose.Types.ObjectId(req.user.divisionId);
    }
    
    console.log(`Querying DB with filter:`, filter);
    
    const queries = await Query
    .find(filter)
    .sort({ timestamp: -1 });
    
    console.log(`Found ${queries.length} queries matching the division`);
    
    return res.status(200).json({
      success: true,
      count: queries.length,
      data: queries
    });
  } catch (error) {
    console.error('Error fetching queries by time filter:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
}

exports.getqueriesbytimefilter = async (req, res) => {
  try {
    const { start, end, division} = req.query;
    
    if (!start || !end) {
      return res.status(400).json({
        success: false,
        message: 'Both start and end dates are required'
      });
    }
    
    // Parse the dates correctly
    const startDate = new Date(start);
    startDate.setHours(0, 0, 0, 0);
    
    const endDate = new Date(end);
    endDate.setHours(23, 59, 59, 999);
    
    // Add console logs to debug date parsing
    console.log('Original start date string:', start);
    console.log('Original end date string:', end);
    console.log('Parsed startDate:', startDate);
    console.log('Parsed endDate:', endDate);
    
    // Validate dates
    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      return res.status(400).json({
        success: false,
        message: 'Invalid date format. Please use ISO format (YYYY-MM-DD) or timestamp'
      });
    }
    
    let filter = { timestamp: { $gte: startDate, $lte: endDate } };
    
    // Filter by division if specified (for division dashboards)
    if (division && division !== 'NOT_SPECIFIED') {
      // Handle both ObjectId and string representations
      if (mongoose.Types.ObjectId.isValid(division)) {
        filter.division = new mongoose.Types.ObjectId(division);
      } else {
        // If a division code is provided instead of an ID
        const divisionDoc = await Division.findOne({ code: division });
        if (divisionDoc) {
          filter.division = divisionDoc._id;
        }
      }
    }
    
    // Check if user role is division_admin (from auth middleware)
    if (req.user && req.user.role === 'division_admin' && req.user.divisionId) {
      // Override any division filter - division admins can only see their own division's data
      filter.division = new mongoose.Types.ObjectId(req.user.divisionId);
    }

    console.log(`Querying DB with filter:`, filter);

    const queries = await Query.find(filter).sort({ timestamp: -1 });
    
    console.log(`Found ${queries.length} queries matching the date range`);

    return res.status(200).json({
      success: true,
      count: queries.length,
      timeRange: {
        start: startDate,
        end: endDate
      },
      data: queries
    });
  } catch (error) {
    console.error('Error fetching queries by time filter:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
};

// Get stats by division
exports.getStatsByDivision = async (req, res) => {
  try {
    const { division } = req.params;
    
    if (!division) {
      return res.status(400).json({
        success: false,
        message: 'Division is required'
      });
    }

    let filter = {}
    if (division && division !== 'NOT_SPECIFIED') {
      // Handle both ObjectId and string representations
      if (mongoose.Types.ObjectId.isValid(division)) {
        filter.division = new mongoose.Types.ObjectId(division);
      } else {
        // If a division code is provided instead of an ID
        const divisionDoc = await Division.findOne({ code: division });
        if (divisionDoc) {
          filter.division = divisionDoc._id;
        }
      }
    }
    
    // Check if user role is division_admin (from auth middleware)
    if (req.user && req.user.role === 'division_admin' && req.user.divisionId) {
      // Override any division filter - division admins can only see their own division's data
      filter.division = new mongoose.Types.ObjectId(req.user.divisionId);
    }
    
    // Get counts for each status
    const pending = await Query.countDocuments({ ...filter, status: 'Pending' });
    const inProgress = await Query.countDocuments({ ...filter, status: 'In Progress' });
    const resolved = await Query.countDocuments({ ...filter, status: 'Resolved' });
    const rejected = await Query.countDocuments({ ...filter, status: 'Rejected' });
    
    // Get counts for each query type
    const trafficViolation = await Query.countDocuments({ ...filter, query_type: 'Traffic Violation' });
    const trafficCongestion = await Query.countDocuments({ ...filter, query_type: 'Traffic Congestion' });
    const accident = await Query.countDocuments({ ...filter, query_type: 'Accident' });
    const roadDamage = await Query.countDocuments({ ...filter, query_type: 'Road Damage' });
    const illegalParking = await Query.countDocuments({ ...filter, query_type: 'Illegal Parking' });
    const suggestion = await Query.countDocuments({ ...filter, query_type: 'Suggestion' });
    const joinRequest = await Query.countDocuments({ ...filter, query_type: 'Join Request' });
    const generalReport = await Query.countDocuments({ ...filter, query_type: 'General Report' });

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    const recentQueries = await Query.countDocuments({ ...filter, timestamp: { $gte: thirtyDaysAgo}});
    const recentResolved = await Query.countDocuments({
      ...filter,
      status: 'Resolved',
      resolved_at: { $gte: thirtyDaysAgo }
    });
    
    // Get daily counts for the past month for a chart
    const dailyCounts = await Query.aggregate([
      {
        $match: {
          ...filter, 
          timestamp: { $gte: thirtyDaysAgo } 
        } 
      },
      {
        $group: {
          _id: { 
            $dateToString: { format: "%Y-%m-%d", date: "$timestamp" } 
          },
          count: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    return res.status(200).json({
      success: true,
      stats: {
        total: pending + inProgress + resolved + rejected,
        byStatus: { pending, inProgress, resolved, rejected },
        byType: { 
          trafficViolation,
          trafficCongestion,
          accident,
          roadDamage, 
          illegalParking,
          suggestion,
          joinRequest,
          generalReport
        },
        recent: {
          totalQueries: recentQueries,
          resolvedQueries: recentResolved,
          dailyCounts
        }
      }
    });
  } catch (error) {
    console.error('Error fetching division stats:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
}

// Get query statistics with division filtering
exports.getQueryStatistics = async (req, res) => {
  try {

    filter = {}

    // Check if user role is division_admin (from auth middleware)
    if (req.user && req.user.role === 'division_admin' && req.user.divisionId) {
      // Override any division filter - division admins can only see their own division's data
      filter.division = new mongoose.Types.ObjectId(req.user.divisionId);
    }

    // Get counts for each status
    const pending = await Query.countDocuments({ ...filter, status: 'Pending' });
    const inProgress = await Query.countDocuments({ ...filter, status: 'In Progress' });
    const resolved = await Query.countDocuments({ ...filter, status: 'Resolved' });
    const rejected = await Query.countDocuments({ ...filter, status: 'Rejected' });
    
    // Get counts for each query type
    const trafficViolation = await Query.countDocuments({ ...filter, query_type: 'Traffic Violation' });
    const trafficCongestion = await Query.countDocuments({ ...filter, query_type: 'Traffic Congestion' });
    const accident = await Query.countDocuments({ ...filter, query_type: 'Accident' });
    const roadDamage = await Query.countDocuments({ ...filter, query_type: 'Road Damage' });
    const illegalParking = await Query.countDocuments({ ...filter, query_type: 'Illegal Parking' });
    const suggestion = await Query.countDocuments({ ...filter, query_type: 'Suggestion' });
    const joinRequest = await Query.countDocuments({ ...filter, query_type: 'Join Request' });
    const generalReport = await Query.countDocuments({ ...filter, query_type: 'General Report' });

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    const recentQueries = await Query.countDocuments({ ...filter, timestamp: { $gte: thirtyDaysAgo}});
    const recentResolved = await Query.countDocuments({
      ...filter,
      status: 'Resolved',
      resolved_at: { $gte: thirtyDaysAgo }
    });
    
    // Get daily counts for the past month for a chart
    const dailyCounts = await Query.aggregate([
      { 
        $match: { 
          timestamp: { $gte: thirtyDaysAgo } 
        } 
      },
      {
        $group: {
          _id: { 
            $dateToString: { format: "%Y-%m-%d", date: "$timestamp" } 
          },
          count: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } }
    ]);
    
    return res.status(200).json({
      success: true,
      stats: {
        total: pending + inProgress + resolved + rejected,
        byStatus: { pending, inProgress, resolved, rejected },
        byType: { 
          trafficViolation,
          trafficCongestion,
          accident,
          roadDamage, 
          illegalParking,
          suggestion,
          joinRequest,
          generalReport
        },
        recent: {
          totalQueries: recentQueries,
          resolvedQueries: recentResolved,
          dailyCounts
        }
      }
    });
  } catch (error) {
    console.error('Error fetching query statistics:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
};

// New function to get statistics by division (for main dashboard)
exports.getStatisticsByDivision = async (req, res) => {
  try {
    // Get all divisions
    const divisions = await Division.find().select('name code');
    
    // For each division, get the statistics
    const divisionStats = await Promise.all(
      divisions.map(async (division) => {
        // Filter by this division
        const filter = { division: division._id };
        
        // Get counts by status
        const pending = await Query.countDocuments({ ...filter, status: 'Pending' });
        const inProgress = await Query.countDocuments({ ...filter, status: 'In Progress' });
        const resolved = await Query.countDocuments({ ...filter, status: 'Resolved' });
        const rejected = await Query.countDocuments({ ...filter, status: 'Rejected' });
        
        // Get total for this division
        const total = pending + inProgress + resolved + rejected;
        
        // Get resolution rate
        const resolutionRate = total > 0 ? (resolved / total * 100).toFixed(1) : 0;
        
        return {
          division: {
            id: division._id,
            name: division.name,
            code: division.code
          },
          total,
          byStatus: { pending, inProgress, resolved, rejected },
          resolutionRate
        };
      })
    );
    
    return res.status(200).json({
      success: true,
      divisionStats
    });
  } catch (error) {
    console.error('Error fetching division statistics:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
};

