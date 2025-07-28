const express = require("express");
const mongoose = require("mongoose");
const { ethers } = require("ethers");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

// MongoDB Atlas URI
const MONGODB_URI = "mongodb+srv://sahilsutar200412:password1234@cluster0.blclafw.mongodb.net/Web3";
mongoose.connect(MONGODB_URI)
  .then(() => console.log("✅ MongoDB Connected"))
  .catch(console.error);

// Wallet schema
const Wallet = mongoose.model("Wallet", new mongoose.Schema({
  name: String,
  address: String,
  privateKey: String,
  mnemonic: String,
}));

// VerifiedTx schema
const verifiedTxSchema = new mongoose.Schema({
  txHash: String,
  from: String,
  to: String,
  value: String,
  token: String,
  status: String,
}, { timestamps: true });

const VerifiedTx = mongoose.model("VerifiedTx", verifiedTxSchema);

// BSC Testnet Provider
const provider = new ethers.providers.JsonRpcProvider("https://bsc-testnet.drpc.org");

// Token contract addresses
const USDT_ADDRESS = "0x787A697324dbA4AB965C58CD33c13ff5eeA6295F";
const USDC_ADDRESS = "0x342e3aA1248AB77E319e3331C6fD3f1F2d4B36B1";

// ERC20 ABI
const ERC20_ABI = [
  "event Transfer(address indexed from, address indexed to, uint256 value)",
  "function transfer(address to, uint amount) returns (bool)",
  "function decimals() view returns (uint8)",
  "function balanceOf(address owner) view returns (uint)",
];

// ======== ROUTES ========

// Create Wallet
app.post("/api/create", async (req, res) => {
  try {
    const wallet = ethers.Wallet.createRandom();
    const newWallet = new Wallet({
      name: req.body.name,
      address: wallet.address,
      privateKey: wallet.privateKey,
      mnemonic: wallet.mnemonic.phrase,
    });
    await newWallet.save();
    res.json(newWallet);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Fetch Wallet
app.get("/api/fetch/:name", async (req, res) => {
  try {
    const wallet = await Wallet.findOne({ name: req.params.name });
    if (!wallet) return res.status(404).json({ error: "Wallet not found" });
    res.json(wallet);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get Balances
app.post("/api/balance", async (req, res) => {
  try {
    const { address } = req.body;
    const usdt = new ethers.Contract(USDT_ADDRESS, ERC20_ABI, provider);
    const usdc = new ethers.Contract(USDC_ADDRESS, ERC20_ABI, provider);

    const bnbBalance = await provider.getBalance(address);
    const usdtBalance = await usdt.balanceOf(address);
    const usdcBalance = await usdc.balanceOf(address);

    const usdtDecimals = await usdt.decimals();
    const usdcDecimals = await usdc.decimals();

    res.json({
      bnb: ethers.utils.formatEther(bnbBalance),
      usdt: ethers.utils.formatUnits(usdtBalance, usdtDecimals),
      usdc: ethers.utils.formatUnits(usdcBalance, usdcDecimals),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Send BNB, USDT, or USDC and save hash immediately
app.post("/api/send", async (req, res) => {
  try {
    const { privateKey, to, amount, token } = req.body;
    const wallet = new ethers.Wallet(privateKey, provider);
    let tx, value;

    if (token === "bnb") {
      value = ethers.utils.parseEther(amount);
      tx = await wallet.sendTransaction({ to, value });

      await new VerifiedTx({
        txHash: tx.hash,
        from: wallet.address,
        to,
        value: amount,
        token: "bnb",
        status: "Pending"
      }).save();

      return res.json({ txHash: tx.hash });
    }

    const tokenAddress = token === "usdt" ? USDT_ADDRESS : USDC_ADDRESS;
    const contract = new ethers.Contract(tokenAddress, ERC20_ABI, wallet);
    const decimals = await contract.decimals();
    value = ethers.utils.parseUnits(amount, decimals);

    tx = await contract.transfer(to, value);

    await new VerifiedTx({
      txHash: tx.hash,
      from: wallet.address,
      to,
      value: amount,
      token,
      status: "Pending"
    }).save();

    res.json({ txHash: tx.hash });
  } catch (err) {
    console.error("❌ Send Token Error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// Cancel Pending Transaction (manual user action)
app.post("/api/cancel", async (req, res) => {
  try {
    const { txHash } = req.body;
    const tx = await VerifiedTx.findOne({ txHash });
    if (!tx) return res.status(404).json({ error: "Transaction not found" });
    if (tx.status !== "Pending")
      return res.status(400).json({ error: "Only pending transactions can be cancelled" });

    tx.status = "Cancelled";
    await tx.save();
    console.log(`❌ Transaction cancelled: ${txHash}`);
    res.json({ message: "Transaction cancelled successfully", txHash });
  } catch (err) {
    console.error("❌ Cancel Error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// Verify transaction manually
app.post("/api/verify", async (req, res) => {
  try {
    const { txHash } = req.body;

    let tx = null;
    for (let i = 0; i < 5; i++) {
      tx = await provider.getTransaction(txHash);
      if (tx) break;
      await new Promise(r => setTimeout(r, 1000));
    }

    if (!tx) return res.status(404).json({ error: "Transaction not found after retries" });

    const receipt = await provider.getTransactionReceipt(txHash);
    let token = "bnb";
    let value = tx.value ? ethers.utils.formatEther(tx.value) : "0";

    if (tx.data && tx.data.startsWith("0xa9059cbb")) {
      const tokenAddress = tx.to.toLowerCase();
      const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, provider);
      const decimals = await tokenContract.decimals();
      const decoded = ethers.utils.defaultAbiCoder.decode(["address", "uint256"], "0x" + tx.data.slice(10));
      value = ethers.utils.formatUnits(decoded[1], decimals);

      if (tokenAddress === USDT_ADDRESS.toLowerCase()) token = "usdt";
      else if (tokenAddress === USDC_ADDRESS.toLowerCase()) token = "usdc";
      else token = "erc20";
    }

    const status = receipt.status === 1 ? "Success" : "Failed";

    await VerifiedTx.findOneAndUpdate(
      { txHash },
      { from: tx.from, to: tx.to, value, token, status },
      { upsert: true, new: true }
    );

    console.log("✅ Verified & updated:", txHash);
    res.json({ from: tx.from, to: tx.to, value, token, status });
  } catch (err) {
    console.error("❌ Verification Error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// Fetch history
app.get("/api/history/:address", async (req, res) => {
  try {
    const { address } = req.params;
    const transactions = await VerifiedTx.find({
      $or: [{ from: address }, { to: address }]
    }).sort({ createdAt: -1 });
    res.json(transactions);
  } catch (err) {
    console.error("❌ History Fetch Error:", err.message);
    res.status(500).json({ error: "Failed to fetch transaction history" });
  }
});

// ======== AUTO LISTENER (for incoming/outgoing txs) ========
async function startListeners() {
  const wallets = await Wallet.find({});
  const walletAddresses = wallets.map(w => w.address.toLowerCase());

  const usdt = new ethers.Contract(USDT_ADDRESS, ERC20_ABI, provider);
  const usdc = new ethers.Contract(USDC_ADDRESS, ERC20_ABI, provider);

  async function handleTokenTransfer(tokenName, decimals, from, to, value, event) {
    if (walletAddresses.includes(to.toLowerCase()) || walletAddresses.includes(from.toLowerCase())) {
      const amount = ethers.utils.formatUnits(value, decimals);
      const receipt = await event.getTransactionReceipt();
      const status = receipt.status === 1 ? "Success" : "Failed";
      const exists = await VerifiedTx.findOne({ txHash: event.transactionHash });
      if (!exists) {
        await new VerifiedTx({
          txHash: event.transactionHash,
          from,
          to,
          value: amount,
          token: tokenName,
          status
        }).save();
        console.log(`📥 Auto saved ${tokenName} tx: ${event.transactionHash}`);
      }
    }
  }

  const usdtDecimals = await usdt.decimals();
  const usdcDecimals = await usdc.decimals();

  usdt.on("Transfer", (from, to, value, event) =>
    handleTokenTransfer("usdt", usdtDecimals, from, to, value, event)
  );
  usdc.on("Transfer", (from, to, value, event) =>
    handleTokenTransfer("usdc", usdcDecimals, from, to, value, event)
  );

  provider.on("pending", async (txHash) => {
    try {
      const tx = await provider.getTransaction(txHash);
      if (tx && tx.to && walletAddresses.includes(tx.to.toLowerCase())) {
        const receipt = await provider.getTransactionReceipt(txHash);
        if (!receipt) return;
        const exists = await VerifiedTx.findOne({ txHash });
        if (!exists) {
          await new VerifiedTx({
            txHash,
            from: tx.from,
            to: tx.to,
            value: ethers.utils.formatEther(tx.value),
            token: "bnb",
            status: receipt.status === 1 ? "Success" : "Failed"
          }).save();
          console.log(`📥 Auto saved BNB tx: ${txHash}`);
        }
      }
    } catch {}
  });

  console.log("🔄 Auto listeners started...");
}
startListeners();

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));

// sahgsgc