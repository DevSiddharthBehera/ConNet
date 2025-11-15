const { mongoose } = require("../db");
const { Schema } = mongoose;

const UserSchema = new Schema({
  username: { type: String, required: true, unique: true, index: true },
  password: { type: String, required: true },
  displayName: { type: String },
  avatar: { type: String },
  oauth: {
    provider: String,
    providerId: String,
    email: String,
  },
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.models.User || mongoose.model("User", UserSchema);
