import mongoose from 'mongoose';

const { Schema } = mongoose;

const ChatSchema = new Schema(
  {
    participants: [{ type: Schema.Types.ObjectId, ref: 'User', required: true }],
    title: { type: String },
  },
  { timestamps: true }
);

ChatSchema.statics.isMember = async function isMember(chatId, userId) {
  if (!chatId || !userId) {
    return false;
  }
  try {
    const chatObjectId = typeof chatId === 'string' ? new mongoose.Types.ObjectId(chatId) : chatId;
    const userObjectId = typeof userId === 'string' ? new mongoose.Types.ObjectId(userId) : userId;
    const exists = await this.exists({ _id: chatObjectId, participants: userObjectId });
    return Boolean(exists);
  } catch {
    return false;
  }
};

export default mongoose.models.Chat || mongoose.model('Chat', ChatSchema);
