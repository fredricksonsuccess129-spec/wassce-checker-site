require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const Stripe = require('stripe');
const nodemailer = require('nodemailer');
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();
const port = process.env.PORT || 3000;
const dbFile = process.env.DATABASE_FILE || './db.sqlite';

// Initialize DB
if (!fs.existsSync(dbFile)) {
  fs.writeFileSync(dbFile, '');
}
const db = new Database(dbFile);
const initSql = fs.readFileSync(path.join(__dirname, 'init_db.sql'), 'utf8');
db.exec(initSql);

// Setup middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Stripe
const stripe = Stripe(process.env.STRIPE_SECRET_KEY || '');

// Nodemailer transporter (will throw only when used if config missing)
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || '',
  port: parseInt(process.env.SMTP_PORT || '587'),
  secure: false,
  auth: {
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || ''
  }
});

// Helper: get unused code for product
function getUnusedCode(product_id) {
  const row = db.prepare('SELECT * FROM codes WHERE product_id = ? AND sold = 0 LIMIT 1').get(product_id);
  return row || null;
}

// API: get products
app.get('/api/products', (req, res) => {
  const rows = db.prepare('SELECT * FROM products').all();
  res.json(rows);
});

// API: create checkout session (client calls to create Stripe Checkout)
app.post('/api/create-checkout-session', async (req, res) => {
  try {
    const { productId, buyerEmail } = req.body;
    const product = db.prepare('SELECT * FROM products WHERE id = ?').get(productId);
    if (!product) return res.status(404).json({ error: 'Product not found' });

    // Create Stripe Checkout session
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'ghs',
          product_data: {
            name: product.name,
            description: product.description || ''
          },
          unit_amount: product.price_cents
        },
        quantity: 1
      }],
      mode: 'payment',
      success_url: process.env.STRIPE_SUCCESS_URL + '?session_id={CHECKOUT_SESSION_ID}',
      cancel_url: process.env.STRIPE_CANCEL_URL,
      metadata: {
        product_id: String(productId),
        buyer_email: buyerEmail || ''
      }
    });

    // record an order placeholder
    const order_id = uuidv4();
    db.prepare(`INSERT INTO orders (order_id, stripe_session_id, product_id, amount_cents, currency, buyer_email)
                VALUES (?, ?, ?, ?, ?, ?)`)
      .run(order_id, session.id, productId, product.price_cents, product.currency || 'GHS', buyerEmail || '');

    res.json({ url: session.url, sessionId: session.id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'server error' });
  }
});

// Stripe webhook endpoint for checkout.session.completed
app.post('/webhook', bodyParser.raw({ type: 'application/json' }), (req, res) => {
  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  let event;

  try {
    if (webhookSecret) {
      event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
    } else {
      event = JSON.parse(req.body.toString());
    }
  } catch (err) {
    console.error('Webhook signature verification failed.', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const product_id = session.metadata?.product_id || null;
    const buyer_email = session.metadata?.buyer_email || session.customer_details?.email || '';

    // Find unused code
    const code = getUnusedCode(product_id);
    const order = db.prepare('SELECT * FROM orders WHERE stripe_session_id = ?').get(session.id);

    if (!code) {
      console.warn('No unused code available for product', product_id);
      // Could send admin alert email here
    } else {
      // Mark code sold
      db.prepare('UPDATE codes SET sold = 1, sold_at = CURRENT_TIMESTAMP, order_id = ?, buyer_email = ? WHERE id = ?')
        .run(order ? order.order_id : 'n/a', buyer_email, code.id);

      // Update order record: fulfilled & buyer_email
      db.prepare('UPDATE orders SET fulfilled = 1, buyer_email = ? WHERE stripe_session_id = ?')
        .run(buyer_email, session.id);

      // Send email to buyer containing the code
      const mailOptions = {
        from: process.env.EMAIL_FROM,
        to: buyer_email,
        subject: `Your WASSCE checker: ${code.code}`,
        text: `Thank you for your purchase!\n\nHere is your checker code:\n\n${code.code}\n\nInstructions:\nUse it on our site to check results.\n\nIf you have an issue reply to this email.`,
        html: `<p>Thank you for your purchase!</p><p><strong>Your checker code:</strong></p><pre>${code.code}</pre><p>Instructions:<br>Use it on our site to check results.</p>`
      };

      transporter.sendMail(mailOptions).then(info => {
        console.log('Email sent:', info.messageId);
      }).catch(err => {
        console.error('Email error:', err);
      });
    }
  }

  res.json({ received: true });
});

// Admin basic routes (simple auth via header)
function adminAuth(req, res, next) {
  const user = process.env.ADMIN_USER;
  const pass = process.env.ADMIN_PASS;
  const auth = req.headers.authorization;
  if (!auth) return res.status(401).send('Missing auth');
  const parts = auth.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Basic') return res.status(401).send('Bad auth');
  const decoded = Buffer.from(parts[1], 'base64').toString();
  const [u, p] = decoded.split(':');
  if (u === user && p === pass) {
    return next();
  }
  return res.status(403).send('Forbidden');
}

// Admin API: upload codes (bulk)
app.post('/admin/api/upload-codes', adminAuth, (req, res) => {
  const { productId, codes } = req.body; // codes: array of strings
  if (!productId || !Array.isArray(codes)) return res.status(400).json({ error: 'Missing data' });

  const insert = db.prepare('INSERT OR IGNORE INTO codes (product_id, code) VALUES (?, ?)');
  const txn = db.transaction((arr) => {
    for (const c of arr) insert.run(productId, c.trim());
  });
  txn(codes);
  res.json({ ok: true, uploaded: codes.length });
});

// Admin API: list orders
app.get('/admin/api/orders', adminAuth, (req, res) => {
  const all = db.prepare('SELECT * FROM orders ORDER BY created_at DESC LIMIT 200').all();
  res.json(all);
});

// Admin API: list codes
app.get('/admin/api/codes', adminAuth, (req, res) => {
  const productId = req.query.productId || null;
  let rows;
  if (productId) rows = db.prepare('SELECT * FROM codes WHERE product_id = ? ORDER BY id DESC LIMIT 500').all(productId);
  else rows = db.prepare('SELECT * FROM codes ORDER BY id DESC LIMIT 500').all();
  res.json(rows);
});

// Admin API: create product
app.post('/admin/api/product', adminAuth, (req, res) => {
  const { name, description, price_cents } = req.body;
  if (!name || !price_cents) return res.status(400).json({ error: 'Missing fields' });
  const result = db.prepare('INSERT INTO products (name, description, price_cents) VALUES (?, ?, ?)').run(name, description || '', price_cents);
  res.json({ ok: true, id: result.lastInsertRowid });
});

// Admin API: analytics dashboard data
app.get('/admin/api/analytics', adminAuth, (req, res) => {
  try {
    const totalSales = db.prepare(`
      SELECT SUM(amount_cents) AS total
      FROM orders
      WHERE fulfilled = 1
    `).get();

    const totalSold = db.prepare(`
      SELECT COUNT(*) AS sold
      FROM codes
      WHERE sold = 1
    `).get();

    const salesByProduct = db.prepare(`
      SELECT p.name,
             COUNT(o.id) AS count,
             SUM(o.amount_cents) AS revenue
      FROM orders o
      JOIN products p ON p.id = o.product_id
      WHERE o.fulfilled = 1
      GROUP BY p.id
      ORDER BY revenue DESC
    `).all();

    const salesLast30 = db.prepare(`
      SELECT DATE(created_at) AS day,
             SUM(amount_cents) AS revenue
      FROM orders
      WHERE created_at >= DATE('now','-30 day')
        AND fulfilled = 1
      GROUP BY DATE(created_at)
      ORDER BY day ASC
    `).all();

    const recentOrders = db.prepare(`
      SELECT * FROM orders
      ORDER BY created_at DESC
      LIMIT 20
    `).all();

    return res.json({
      totalSales: totalSales.total || 0,
      totalSold: totalSold.sold || 0,
      salesByProduct,
      salesLast30,
      recentOrders
    });

  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'analytics error' });
  }
});

// Fallback: serve index.html for client-side routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start
app.listen(port, () => {
  console.log(`Server listening on http://localhost:${port}`);
});
