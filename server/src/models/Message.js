import mongoose from 'mongoose';

const { Schema } = mongoose;

const MessageSchema = new Schema(
  {
    chatId: { type: Schema.Types.ObjectId, required: true, index: true },
    senderId: { type: Schema.Types.ObjectId, required: true, index: true },
    encryptedPayload: { type: String, required: true },
  },
  { timestamps: true }
);

MessageSchema.index({ chatId: 1, createdAt: 1, _id: 1 });

export default mongoose.model('Message', MessageSchema);
