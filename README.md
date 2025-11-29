[README.md](https://github.com/user-attachments/files/23833231/README.md)
# WASSCE Checkers — Node.js + Express project

This project is a ready-to-run website for selling WASSCE result checkers (single-use codes).
It includes:
- Frontend: static pages (home, shop, admin, analytics).
- Backend: Node.js + Express server with SQLite (better-sqlite3).
- Stripe Checkout integration (webhook) to mark orders fulfilled.
- Nodemailer for emailing purchased checker codes.
- Admin endpoints for uploading codes, creating products, and viewing analytics.

## Quick local setup

1. Install Node.js (v18+ recommended).
2. Clone or extract this project.
3. Copy `.env.example` to `.env` and fill values (Stripe keys, SMTP, admin credentials).
4. Install dependencies:
```bash
npm install
```
5. (Optional) Add a product and codes:
   - Use the admin endpoints or an SQLite GUI.
   - Example: create product with price_cents = 50000 (GHS 500.00).

6. Start server:
```bash
npm run dev
# or
npm start
```

7. Visit:
- Home: http://localhost:3000/
- Shop: http://localhost:3000/shop
- Admin: http://localhost:3000/admin.html
- Analytics: http://localhost:3000/admin-analytics.html

## Notes
- Use Stripe test keys in development and follow Stripe docs to forward webhooks:
  `stripe listen --forward-to localhost:3000/webhook`
- Do NOT commit `.env` to version control.
- For production, replace Basic Auth with a proper auth system and switch to PostgreSQL for scale.

## Deployment suggestions
- Render.com or Railway.app: good for Node.js + SQLite or provide PostgreSQL.
- Heroku (requires buildpack); consider using PostgreSQL add-on.
- Docker: containerize the app and deploy to any cloud provider.

