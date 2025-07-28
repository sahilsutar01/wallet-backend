const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// ✅ Connect to MongoDB
mongoose.connect('mongodb+srv://sahilsutar200412:password1234@cluster0.blclafw.mongodb.net/Web3?retryWrites=true&w=majority')
  .then(() => console.log('✅ MongoDB connected'))
  .catch(err => console.error('❌ MongoDB error:', err.message));

// ✅ Wallet Schema
const WalletSchema = new mongoose.Schema({
  address: String,
  privateKey: String,
  mnemonic: String,
});

const WalletModel = mongoose.model('Wallet', WalletSchema);

// ✅ Save wallet from frontend
app.post('/api/wallet', async (req, res) => {
  try {
    const { address, privateKey, mnemonic } = req.body;

    const newWallet = new WalletModel({ address, privateKey, mnemonic });
    const saved = await newWallet.save();

    console.log("✅ Wallet saved:", saved._id);
    res.status(200).json(saved);
  } catch (err) {
    console.error('❌ Wallet save error:', err.message);
    res.status(500).json({ error: 'Failed to save wallet' });
  }
});

app.listen(5000, () => {
  console.log('✅ Server running on port 5000');
});
