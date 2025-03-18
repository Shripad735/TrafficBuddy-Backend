const Query = require('../models/Query');
const Session = require('../models/Session');

// Get dashboard summary statistics
exports.getDashboardSummary = async (req, res) => {
  try {
    // Get total queries
    const totalQueries = await Query.countDocuments();
    
    // Get total users (unique user_ids from queries)
    const uniqueUsers = await Query.distinct('user_id');
    const userCount = uniqueUsers.length;
    
    // Get active sessions (modified in the last day)
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const activeSessions = await Session.countDocuments({
      last_interaction: { $gte: yesterday }
    });
    
    // Get queries by status
    const pendingQueries = await Query.countDocuments({ status: 'Pending' });
    const inProgressQueries = await Query.countDocuments({ status: 'In Progress' });
    const resolvedQueries = await Query.countDocuments({ status: 'Resolved' });
    const rejectedQueries = await Query.countDocuments({ status: 'Rejected' });
    
    // Get queries by type
    const queryTypes = await Query.aggregate([
      { $group: { _id: '$query_type', count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ]);
    
    // Get most recent queries
    const recentQueries = await Query.find()
      .sort({ timestamp: -1 })
      .limit(5);
      
    // Get most active users
    const activeUsers = await Query.aggregate([
      { $group: { _id: '$user_id', count: { $sum: 1 }, userName: { $first: '$user_name' } } },
      { $sort: { count: -1 } },
      { $limit: 5 }
    ]);
    
    // Get queries per day (past week)
    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
    
    const queriesPerDay = await Query.aggregate([
      { 
        $match: { 
          timestamp: { $gte: oneWeekAgo } 
        } 
      },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$timestamp" } },
          count: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } }
    ]);
    
    // Build and send response
    return res.status(200).json({
      success: true,
      data: {
        totalQueries,
        userCount,
        activeSessions,
        queryStatus: {
          pending: pendingQueries,
          inProgress: inProgressQueries,
          resolved: resolvedQueries,
          rejected: rejectedQueries
        },
        queryTypes,
        recentQueries,
        activeUsers,
        queriesPerDay
      }
    });
  } catch (error) {
    console.error('Error fetching dashboard summary:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
};

// Get recent activity for dashboard
exports.getRecentActivity = async (req, res) => {
  try {
    const { limit = 10 } = req.query;
    
    // Get most recent queries
    const recentQueries = await Query.find()
      .sort({ timestamp: -1 })
      .limit(parseInt(limit));
    
    return res.status(200).json({
      success: true,
      data: recentQueries
    });
  } catch (error) {
    console.error('Error fetching recent activity:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
};

// Get geolocated queries for map display
exports.getMapData = async (req, res) => {
  try {
    // Only get queries that have valid location data
    const geoQueries = await Query.find({
      'location.latitude': { $ne: null },
      'location.longitude': { $ne: null }
    }).select('query_type location status timestamp description photo_url');
    
    return res.status(200).json({
      success: true,
      data: geoQueries
    });
  } catch (error) {
    console.error('Error fetching map data:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
};