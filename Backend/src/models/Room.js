const { mongoose } = require("../db");
const { Schema } = mongoose;

const RoomSchema = new Schema({
  name: { type: String },
  members: [{ type: Schema.Types.ObjectId, ref: "User" }],
  isGroup: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.models.Room || mongoose.model("Room", RoomSchema);
