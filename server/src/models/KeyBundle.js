import mongoose from 'mongoose';

const KeyBundleSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      unique: true,
      required: true,
    },
    identityKey: {
      type: String,
      required: true,
    },
    signedPreKey: {
      keyId: { type: Number, required: true },
      publicKey: { type: String, required: true },
      signature: { type: String, required: true },
    },
    oneTimePreKeys: [
      {
        keyId: { type: Number, required: true },
        publicKey: { type: String, required: true },
        used: { type: Boolean, default: false },
      },
    ],
  },
  { timestamps: true }
);

export default mongoose.model('KeyBundle', KeyBundleSchema);
