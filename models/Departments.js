const mongoose = require('mongoose');

const DepartmentSchema = new mongoose.Schema({
    name: { type: String, required: true },
    email: { type: String, required: true },
    alternate_email: { type: String }
});

module.exports = mongoose.model('Department', DepartmentSchema);