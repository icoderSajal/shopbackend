require("dotenv").config();
const express = require("express"),
  cors = require("cors"),
  mongoose = require("mongoose"),
  bcrypt = require("bcryptjs"),
  jwt = require("jsonwebtoken");
const { User, Product, Vendor, Purchase, Payment, Order } = require("./models");
const { shipping, sms } = require("./utils");
const app = express();
app.use(cors({ origin: process.env.CLIENT_URL }));
app.use(express.json({ limit: "5mb" }));
const wrap = (f) => (q, r) =>
  f(q, r).catch((e) => r.status(400).json({ message: e.message }));
const auth = async (q, r, n) => {
  try {
    q.user = await User.findById(
      jwt.verify(
        (q.headers.authorization || "").slice(7),
        process.env.JWT_SECRET,
      ).id,
    );
    if (!q.user) throw 0;
    n();
  } catch {
    r.status(401).json({ message: "Please login" });
  }
};
const admin = (q, r, n) =>
  q.user.role === "admin" ? n() : r.status(403).json({ message: "Admin only" });
const token = (u) => ({
  token: jwt.sign({ id: u._id }, process.env.JWT_SECRET, { expiresIn: "30d" }),
  user: { id: u._id, name: u.name, phone: u.phone, role: u.role },
});
const A = [auth, admin];

app.post(
  "/api/auth/register",
  wrap(async (q, r) => {
    const { name, phone, password } = q.body;
    if (!/^\d{10}$/.test(phone) || !password || password.length < 6)
      throw new Error("Enter 10-digit mobile and 6+ char password");
    r.json(
      token(
        await User.create({
          name,
          phone,
          password: await bcrypt.hash(password, 10),
        }),
      ),
    );
  }),
);
app.post(
  "/api/auth/login",
  wrap(async (q, r) => {
    const u = await User.findOne({ phone: q.body.phone });
    if (!u || !(await bcrypt.compare(q.body.password, u.password)))
      throw new Error("Wrong mobile or password");
    r.json(token(u));
  }),
);

app.get(
  "/api/products",
  wrap(async (q, r) => {
    const f = { isActive: true };
    if (q.query.category) f.category = q.query.category;
    if (q.query.q) f.name = new RegExp(q.query.q, "i");
    r.json(await Product.find(f).sort("-createdAt"));
  }),
);
app.get(
  "/api/admin/products",
  ...A,
  wrap(async (q, r) => r.json(await Product.find().sort("-createdAt"))),
);
app.post(
  "/api/admin/products",
  ...A,
  wrap(async (q, r) => r.json(await Product.create(q.body))),
);
app.put(
  "/api/admin/products/:id",
  ...A,
  wrap(async (q, r) =>
    r.json(await Product.findByIdAndUpdate(q.params.id, q.body, { new: true })),
  ),
);
app.delete(
  "/api/admin/products/:id",
  ...A,
  wrap(async (q, r) => {
    await Product.findByIdAndDelete(q.params.id);
    r.json({ ok: 1 });
  }),
);
app.get(
  "/api/admin/low-stock",
  ...A,
  wrap(async (q, r) =>
    r.json(
      await Product.aggregate([
        { $unwind: "$variants" },
        {
          $match: {
            $expr: { $lte: ["$variants.stock", "$variants.lowStockLimit"] },
          },
        },
        {
          $project: {
            name: 1,
            category: 1,
            size: "$variants.size",
            stock: "$variants.stock",
            limit: "$variants.lowStockLimit",
          },
        },
      ]),
    ),
  ),
);
app.put(
  "/api/admin/stock",
  ...A,
  wrap(async (q, r) => {
    const { productId, variantId, qty } = q.body;
    await Product.updateOne(
      { _id: productId, "variants._id": variantId },
      { $inc: { "variants.$.stock": +qty } },
    );
    r.json({ ok: 1 });
  }),
);

app.get(
  "/api/admin/vendors",
  ...A,
  wrap(async (q, r) => r.json(await Vendor.find().sort("name"))),
);
app.post(
  "/api/admin/vendors",
  ...A,
  wrap(async (q, r) => r.json(await Vendor.create(q.body))),
);
app.get(
  "/api/admin/purchases",
  ...A,
  wrap(async (q, r) =>
    r.json(
      await Purchase.find()
        .populate("vendor", "name")
        .sort("-createdAt")
        .limit(100),
    ),
  ),
);
app.post(
  "/api/admin/purchases",
  ...A,
  wrap(async (q, r) => {
    const { vendor, invoiceNo, items, paid = 0 } = q.body;
    const total = items.reduce((s, i) => s + i.qty * i.costPrice, 0);
    for (const i of items)
      await Product.updateOne(
        { _id: i.product, "variants._id": i.variantId },
        { $inc: { "variants.$.stock": +i.qty } },
      );
    const p = await Purchase.create({ vendor, invoiceNo, items, total, paid });
    const v = await Vendor.findById(vendor);
    if (paid > 0)
      await Payment.create({
        type: "out",
        amount: paid,
        party: v?.name,
        note: "Purchase " + (invoiceNo || p._id),
        ref: String(p._id),
      });
    r.json(p);
  }),
);
app.get(
  "/api/admin/payments",
  ...A,
  wrap(async (q, r) => r.json(await Payment.find().sort("-date").limit(200))),
);
app.post(
  "/api/admin/payments",
  ...A,
  wrap(async (q, r) => r.json(await Payment.create(q.body))),
);

app.post(
  "/api/shipping",
  auth,
  wrap(async (q, r) => {
    const { items, pincode } = q.body;
    let sub = 0,
      w = 0;
    for (const i of items) {
      const p = await Product.findById(i.productId),
        v = p.variants.id(i.variantId);
      sub += v.price * i.qty;
      w += v.weightKg * i.qty;
    }
    r.json({ subtotal: sub, weight: w, ...(await shipping(pincode, w, sub)) });
  }),
);
app.post(
  "/api/orders",
  auth,
  wrap(async (q, r) => {
    const { items, address } = q.body;
    if (!items?.length) throw new Error("Cart is empty");
    const lines = [];
    let sub = 0,
      w = 0;
    for (const i of items) {
      const p = await Product.findById(i.productId),
        v = p?.variants.id(i.variantId);
      if (!v || v.stock < i.qty)
        throw new Error(`${p?.name || "Item"} is out of stock`);
      lines.push({
        product: p._id,
        variantId: v._id,
        name: p.name,
        size: v.size,
        qty: i.qty,
        price: v.price,
        weightKg: v.weightKg,
      });
      sub += v.price * i.qty;
      w += v.weightKg * i.qty;
    }
    const sh = await shipping(address.pincode, w, sub);
    const orderNo = 1000 + (await Order.countDocuments()) + 1;
    for (const l of lines)
      await Product.updateOne(
        { _id: l.product, "variants._id": l.variantId },
        { $inc: { "variants.$.stock": -l.qty } },
      );
    const o = await Order.create({
      orderNo,
      user: q.user._id,
      items: lines,
      address,
      subtotal: sub,
      shipping: sh.shipping,
      distanceKm: sh.distanceKm,
      total: sub + sh.shipping,
      history: [{ status: "placed" }],
    });
    sms(
      address.phone || q.user.phone,
      `Order #${orderNo} placed. Total Rs ${o.total} (Cash on Delivery). Track it in My Orders.`,
    );
    r.json(o);
  }),
);
app.get(
  "/api/orders/mine",
  auth,
  wrap(async (q, r) =>
    r.json(await Order.find({ user: q.user._id }).sort("-createdAt")),
  ),
);
app.get(
  "/api/admin/orders",
  ...A,
  wrap(async (q, r) =>
    r.json(
      await Order.find(q.query.status ? { status: q.query.status } : {})
        .sort("-createdAt")
        .limit(200),
    ),
  ),
);
app.put(
  "/api/admin/orders/:id/status",
  ...A,
  wrap(async (q, r) => {
    const o = await Order.findById(q.params.id),
      s = q.body.status;
    o.status = s;
    o.history.push({ status: s });
    if (s === "delivered" && o.paymentStatus !== "paid") {
      o.paymentStatus = "paid";
      await Payment.create({
        type: "in",
        amount: o.total,
        party: o.address.name,
        note: "COD order #" + o.orderNo,
        ref: String(o._id),
      });
    }
    if (s === "cancelled")
      for (const l of o.items)
        await Product.updateOne(
          { _id: l.product, "variants._id": l.variantId },
          { $inc: { "variants.$.stock": l.qty } },
        );
    await o.save();
    sms(o.address.phone, `Order #${o.orderNo} is now ${s}.`);
    r.json(o);
  }),
);

app.get(
  "/api/admin/dashboard",
  ...A,
  wrap(async (q, r) => {
    const t = new Date();
    t.setHours(0, 0, 0, 0);
    const sum = async (f) =>
      (
        await Payment.aggregate([
          { $match: f },
          { $group: { _id: null, s: { $sum: "$amount" } } },
        ])
      )[0]?.s || 0;
    const today = await Order.aggregate([
      { $match: { createdAt: { $gte: t }, status: { $ne: "cancelled" } } },
      { $group: { _id: null, s: { $sum: "$total" }, n: { $sum: 1 } } },
    ]);
    r.json({
      todaySales: today[0]?.s || 0,
      todayOrders: today[0]?.n || 0,
      pending: await Order.countDocuments({
        status: { $in: ["placed", "confirmed", "packed"] },
      }),
      cashIn: await sum({ type: "in" }),
      cashOut: await sum({ type: "out" }),
      products: await Product.countDocuments(),
    });
  }),
);
app.get(
  "/api/admin/report",
  ...A,
  wrap(async (q, r) => {
    const y = +q.query.year || new Date().getFullYear(),
      mo = +q.query.month || new Date().getMonth() + 1,
      a = new Date(y, mo - 1, 1),
      b = new Date(y, mo, 1);
    const days = await Order.aggregate([
      {
        $match: {
          createdAt: { $gte: a, $lt: b },
          status: { $ne: "cancelled" },
        },
      },
      {
        $group: {
          _id: { $dayOfMonth: "$createdAt" },
          sales: { $sum: "$total" },
          orders: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]);
    const top = await Order.aggregate([
      {
        $match: {
          createdAt: { $gte: a, $lt: b },
          status: { $ne: "cancelled" },
        },
      },
      { $unwind: "$items" },
      {
        $group: {
          _id: "$items.name",
          qty: { $sum: "$items.qty" },
          amount: { $sum: { $multiply: ["$items.qty", "$items.price"] } },
        },
      },
      { $sort: { amount: -1 } },
      { $limit: 10 },
    ]);
    const pur = await Purchase.aggregate([
      { $match: { createdAt: { $gte: a, $lt: b } } },
      { $group: { _id: null, s: { $sum: "$total" } } },
    ]);
    r.json({
      days,
      top,
      purchases: pur[0]?.s || 0,
      sales: days.reduce((s, d) => s + d.sales, 0),
      orders: days.reduce((s, d) => s + d.orders, 0),
    });
  }),
);

mongoose
  .connect(process.env.MONGO_URI)
  .then(async () => {
    if (!(await User.findOne({ role: "admin" }))) {
      await User.create({
        name: "Admin",
        phone: process.env.ADMIN_PHONE,
        password: await bcrypt.hash(process.env.ADMIN_PASSWORD, 10),
        role: "admin",
      });
      console.log("Admin created");
    }
    app.listen(process.env.PORT || 5000, () => console.log("API running"));
  })
  .catch((e) => console.error("DB error", e.message));
