const { mongoose } = require("../db");
const { Schema } = mongoose;

const MessageSchema = new Schema({
  from: { type: Schema.Types.ObjectId, ref: "User", required: true },
  to: { type: String, required: true }, // userId or roomId
  content: { type: String },
  file: {
    url: String,
    fileName: String,
    mimeType: String,
    size: Number,
    storageBucket: String,
    storagePath: String,
  },
  meta: { type: Schema.Types.Mixed },
  createdAt: { type: Date, default: Date.now },
});

module.exports =
  mongoose.models.Message || mongoose.model("Message", MessageSchema);
