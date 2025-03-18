const mongoose = require('mongoose');

const connectDB = async () => {
  try {
    const connection = await mongoose.connect(
      'mongodb+srv://new-user-01:admin123@cluster0.ajmvl.mongodb.net/traffic_buddy?retryWrites=true&w=majority&appName=Cluster0',
      { 
        useNewUrlParser: true, 
        useUnifiedTopology: true 
      }
    );
    
    console.log(`MongoDB Connected: ${connection.connection.host}`);
    return connection;
  } catch (error) {
    console.error(`Error connecting to MongoDB: ${error.message}`);
    process.exit(1);
  }
};

module.exports = connectDB;