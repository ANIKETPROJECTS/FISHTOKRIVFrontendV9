import mongoose from "mongoose";

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) throw new Error("MONGODB_URI must be set.");

export const adminConnection = mongoose.createConnection(MONGODB_URI, {
  dbName: "fishtokri_admin",
});

adminConnection.on("connected", () => console.log("Connected to fishtokri_admin DB"));
adminConnection.on("error", (err) => console.error("Admin DB connection error:", err));

const superHubSchema = new mongoose.Schema({
  name: { type: String, required: true },
  location: { type: String, default: null },
  imageUrl: { type: String, default: null },
  status: { type: String, default: "Active" },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

const pincodeEntrySchema = new mongoose.Schema(
  {
    pincode: { type: String, required: true },
    charge: { type: Number, default: 0 },
    timeDelay: { type: Number, default: 0 },
  },
  { _id: true }
);

const subHubSchema = new mongoose.Schema({
  superHubId: { type: mongoose.Schema.Types.ObjectId, ref: "SuperHub", required: true },
  name: { type: String, required: true },
  location: { type: String, default: null },
  imageUrl: { type: String, default: null },
  pincodes: { type: [pincodeEntrySchema], default: [] },
  status: { type: String, default: "Active" },
  dbName: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  password: { type: String, required: true },
});

export const SuperHubModel =
  adminConnection.models.SuperHub ||
  adminConnection.model("SuperHub", superHubSchema, "super_hubs");

export const SubHubModel =
  adminConnection.models.SubHub ||
  adminConnection.model("SubHub", subHubSchema, "sub_hubs");

export const UserModel =
  adminConnection.models.User ||
  adminConnection.model("User", userSchema, "users");

const otpSchema = new mongoose.Schema({
  phone: { type: String, required: true, unique: true },
  otp: { type: String, required: true },
  expiresAt: { type: Date, required: true, index: { expires: 0 } },
});

export const OtpModel =
  adminConnection.models.Otp ||
  adminConnection.model("Otp", otpSchema, "otps");
