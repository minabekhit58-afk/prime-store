require("dotenv").config();
const express = require("express");
const session = require("express-session");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const { createClient } = require("@supabase/supabase-js");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;
const required = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "ADMIN_PASSWORD", "SESSION_SECRET"];
const missing = required.filter(k => !process.env[k]);
if (missing.length) {
  console.error("Missing required environment variables:", missing.join(", "));
  console.error("Copy .env.example to .env and fill in the values.");
  process.exit(1);
}
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});
app.set("trust proxy", 1);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: "100kb" }));
app.use(express.urlencoded({ extended: false, limit: "20kb" }));
app.use(session({
  name: "prime.sid",
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 8 * 60 * 60 * 1000 }
}));
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: "draft-7", legacyHeaders: false });
const orderLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 15, standardHeaders: "draft-7", legacyHeaders: false });
app.use(express.static(path.join(__dirname, "public")));

function adminOnly(req, res, next) {
  if (req.session && req.session.isAdmin) return next();
  return res.status(401).json({ error: "يلزم تسجيل دخول الإدارة." });
}
const clean = v => typeof v === "string" ? v.trim() : "";

app.get("/api/config", (req, res) => {
  res.json({ whatsappNumber: (process.env.WHATSAPP_NUMBER || "201206770572").replace(/\D/g, "") });
});

app.get("/api/products", async (req, res) => {
  const { data, error } = await supabase.from("products").select("id,name,description,price,image_url,category,stock,is_active,created_at").eq("is_active", true).order("created_at", { ascending: false });
  if (error) return res.status(500).json({ error: "تعذر تحميل المنتجات حاليًا." });
  res.json(data || []);
});

app.post("/api/orders", orderLimiter, async (req, res) => {
  const customer_name = clean(req.body.customer_name);
  const phone = clean(req.body.phone);
  const address = clean(req.body.address);
  const items = Array.isArray(req.body.items) ? req.body.items : [];
  if (customer_name.length < 2 || customer_name.length > 100) return res.status(400).json({ error: "اكتب اسمًا صحيحًا." });
  if (phone.length < 7 || phone.length > 25) return res.status(400).json({ error: "اكتب رقم هاتف صحيحًا." });
  if (address.length < 5 || address.length > 500) return res.status(400).json({ error: "اكتب عنوانًا كاملًا." });
  if (!items.length || items.length > 30) return res.status(400).json({ error: "السلة فارغة أو تحتوي على منتجات كثيرة." });

  const quantities = new Map();
  for (const item of items) {
    const id = Number(item.id), qty = Number(item.quantity);
    if (!Number.isSafeInteger(id) || id <= 0 || !Number.isSafeInteger(qty) || qty < 1 || qty > 50) return res.status(400).json({ error: "بيانات أحد المنتجات غير صحيحة." });
    quantities.set(id, (quantities.get(id) || 0) + qty);
  }
  const ids = [...quantities.keys()];
  const { data: products, error: pErr } = await supabase.from("products").select("id,name,price,stock,is_active").in("id", ids).eq("is_active", true);
  if (pErr || !products || products.length !== ids.length) return res.status(400).json({ error: "بعض المنتجات لم تعد متاحة. حدّث الصفحة وحاول مجددًا." });

  let total = 0;
  const orderItems = [];
  for (const p of products) {
    const quantity = quantities.get(p.id);
    if (Number(p.stock) < quantity) return res.status(400).json({ error: `الكمية المتاحة من ${p.name} غير كافية.` });
    const price = Number(p.price);
    total += price * quantity;
    orderItems.push({ product_id: p.id, product_name: p.name, quantity, unit_price: price });
  }
  const { data: order, error: oErr } = await supabase.from("orders").insert({ customer_name, phone, address, total: Number(total.toFixed(2)), status: "new" }).select("id,customer_name,phone,address,total,created_at").single();
  if (oErr || !order) return res.status(500).json({ error: "تعذر حفظ الطلب. حاول مرة أخرى." });
  const rows = orderItems.map(item => ({ ...item, order_id: order.id }));
  const { error: iErr } = await supabase.from("order_items").insert(rows);
  if (iErr) {
    await supabase.from("orders").delete().eq("id", order.id);
    return res.status(500).json({ error: "تعذر حفظ تفاصيل الطلب. حاول مرة أخرى." });
  }
  res.status(201).json({
    success: true,
    orderId: order.id,
    total: order.total,
    whatsappNumber: (process.env.WHATSAPP_NUMBER || "201206770572").replace(/\D/g, ""),
    customer: { name: customer_name, phone, address },
    items: orderItems.map(x => ({ name: x.product_name, quantity: x.quantity, price: x.unit_price }))
  });
});

app.post("/api/admin/login", loginLimiter, (req, res) => {
  const password = clean(req.body.password);
  if (!password || password.length > 200 || password !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: "كلمة المرور غير صحيحة." });
  }
  req.session.regenerate(err => {
    if (err) return res.status(500).json({ error: "تعذر تسجيل الدخول." });
    req.session.isAdmin = true;
    res.json({ success: true });
  });
});
app.post("/api/admin/logout", (req, res) => req.session.destroy(() => res.json({ success: true })));
app.get("/api/admin/me", (req, res) => res.json({ isAdmin: !!(req.session && req.session.isAdmin) }));

app.get("/api/admin/products", adminOnly, async (req, res) => {
  const { data, error } = await supabase.from("products").select("*").order("created_at", { ascending: false });
  if (error) return res.status(500).json({ error: "تعذر تحميل المنتجات." });
  res.json(data || []);
});
app.post("/api/admin/products", adminOnly, async (req, res) => {
  const b = req.body || {};
  const name = clean(b.name), description = clean(b.description), image_url = clean(b.image_url), category = clean(b.category) || "Accessories";
  const price = Number(b.price), stock = Number(b.stock);
  if (name.length < 2 || name.length > 150 || !Number.isFinite(price) || price < 0 || !Number.isSafeInteger(stock) || stock < 0) {
    return res.status(400).json({ error: "راجع الاسم والسعر والمخزون." });
  }
  if (image_url && !/^https:\/\/\S+/i.test(image_url)) return res.status(400).json({ error: "رابط الصورة يجب أن يبدأ بـ https://." });
  const { data, error } = await supabase.from("products").insert({ name, description, image_url, category, price, stock, is_active: b.is_active !== false }).select("*").single();
  if (error) return res.status(500).json({ error: "تعذر حفظ المنتج. تأكد من إعداد الجداول." });
  res.status(201).json(data);
});
app.patch("/api/admin/products/:id", adminOnly, async (req, res) => {
  const b = req.body || {}, update = {};
  if (b.name !== undefined) update.name = clean(b.name);
  if (b.description !== undefined) update.description = clean(b.description);
  if (b.category !== undefined) update.category = clean(b.category) || "Accessories";
  if (b.image_url !== undefined) {
    const url = clean(b.image_url);
    if (url && !/^https:\/\/\S+/i.test(url)) return res.status(400).json({ error: "رابط الصورة يجب أن يبدأ بـ https://." });
    update.image_url = url;
  }
  if (b.price !== undefined) { const n = Number(b.price); if (!Number.isFinite(n) || n < 0) return res.status(400).json({ error: "السعر غير صحيح." }); update.price = n; }
  if (b.stock !== undefined) { const n = Number(b.stock); if (!Number.isSafeInteger(n) || n < 0) return res.status(400).json({ error: "المخزون غير صحيح." }); update.stock = n; }
  if (b.is_active !== undefined) update.is_active = !!b.is_active;
  const { data, error } = await supabase.from("products").update(update).eq("id", req.params.id).select("*").single();
  if (error) return res.status(500).json({ error: "تعذر تعديل المنتج." });
  res.json(data);
});
app.delete("/api/admin/products/:id", adminOnly, async (req, res) => {
  const { error } = await supabase.from("products").update({ is_active: false }).eq("id", req.params.id);
  if (error) return res.status(500).json({ error: "تعذر إخفاء المنتج." });
  res.json({ success: true });
});
app.get("/api/admin/orders", adminOnly, async (req, res) => {
  const { data, error } = await supabase.from("orders").select("id,customer_name,phone,address,total,status,created_at,order_items(id,product_name,quantity,unit_price)").order("created_at", { ascending: false }).limit(200);
  if (error) return res.status(500).json({ error: "تعذر تحميل الطلبات." });
  res.json(data || []);
});
app.patch("/api/admin/orders/:id", adminOnly, async (req, res) => {
  const allowed = ["new", "confirmed", "shipped", "completed", "cancelled"];
  const status = clean(req.body.status);
  if (!allowed.includes(status)) return res.status(400).json({ error: "حالة الطلب غير صحيحة." });
  const { data, error } = await supabase.from("orders").update({ status }).eq("id", req.params.id).select("id,status").single();
  if (error) return res.status(500).json({ error: "تعذر تحديث حالة الطلب." });
  res.json(data);
});

app.get("/admin", (req, res) => res.sendFile(path.join(__dirname, "public", "admin.html")));
app.get("*", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));
app.listen(PORT, () => console.log(`PRIME STORE running on port ${PORT}`));
