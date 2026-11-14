const m = require("mongoose");
const S = m.Schema;
const O = S.Types.ObjectId;
const variant = {
  size: String,
  sku: String,
  price: Number,
  mrp: Number,
  stock: { type: Number, default: 0 },
  lowStockLimit: { type: Number, default: 10 },
  weightKg: { type: Number, default: 0.5 },
};
exports.User = m.model(
  "User",
  new S(
    {
      name: String,
      phone: { type: String, unique: true },
      password: String,
      role: { type: String, default: "customer" },
    },
    { timestamps: true },
  ),
);
exports.Product = m.model(
  "Product",
  new S(
    {
      name: String,
      category: String,
      brand: String,
      material: String,
      image: String,
      description: String,
      isActive: { type: Boolean, default: true },
      variants: [variant],
    },
    { timestamps: true },
  ),
);
exports.Vendor = m.model(
  "Vendor",
  new S(
    { name: String, phone: String, address: String, gstin: String },
    { timestamps: true },
  ),
);
exports.Purchase = m.model(
  "Purchase",
  new S(
    {
      vendor: { type: O, ref: "Vendor" },
      invoiceNo: String,
      items: [
        {
          product: { type: O, ref: "Product" },
          variantId: O,
          name: String,
          qty: Number,
          costPrice: Number,
        },
      ],
      total: Number,
      paid: Number,
    },
    { timestamps: true },
  ),
);
exports.Payment = m.model(
  "Payment",
  new S({
    type: { type: String, enum: ["in", "out"] },
    amount: Number,
    mode: { type: String, default: "cash" },
    party: String,
    note: String,
    ref: String,
    date: { type: Date, default: Date.now },
  }),
);
exports.Order = m.model(
  "Order",
  new S(
    {
      orderNo: Number,
      user: { type: O, ref: "User" },
      items: [
        {
          product: O,
          variantId: O,
          name: String,
          size: String,
          qty: Number,
          price: Number,
          weightKg: Number,
        },
      ],
      address: {
        name: String,
        phone: String,
        line1: String,
        city: String,
        pincode: String,
      },
      subtotal: Number,
      shipping: Number,
      distanceKm: Number,
      total: Number,
      paymentMethod: { type: String, default: "COD" },
      paymentStatus: { type: String, default: "pending" },
      status: { type: String, default: "placed" },
      history: [{ status: String, at: { type: Date, default: Date.now } }],
    },
    { timestamps: true },
  ),
);
