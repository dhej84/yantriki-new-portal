# Yantriki Travel Expense Portal v2

Node.js / Express / PostgreSQL — Domestic + International travel expense management with approval workflow.

## Project structure

```
yantriki/
├── server.js               ← Express app entry point
├── db.js                   ← PostgreSQL pool
├── mailer.js               ← Nodemailer workflow emails
├── schema.sql              ← Run once to set up DB
├── .env.example            ← Copy to .env and fill in
├── package.json
├── middleware/
│   └── auth.js             ← requireAuth, requireRole
├── routes/
│   ├── auth.js             ← /api/auth/*
│   ├── trips.js            ← /api/trips/*
│   ├── workflow.js         ← /api/workflow/:id/*
│   ├── fx.js               ← /api/fx/* (live FX rates)
│   └── files.js            ← /api/files/* (upload/download)
└── public/
    ├── login.html          ← Login page  → /login
    └── app.html            ← Main portal → /app
```

## Quick start

```bash
# 1. Install dependencies
npm install

# 2. Create your .env
cp .env.example .env
# Edit .env — set DATABASE_URL, SESSION_SECRET, EMAIL_* vars

# 3. Create the database and run schema
createdb yantriki_travel
psql -d yantriki_travel -f schema.sql

# 4. Start dev server
npm run dev

# 5. Open browser
open http://localhost:3000
```

## Default credentials (dev only — change in prod)

| Username    | Password | Role      |
|-------------|----------|-----------|
| admin       | admin    | Admin     |
| traveller1  | admin    | Traveller |
| reviewer1   | admin    | Reviewer  |
| approver1   | admin    | Approver  |
| accounts1   | admin    | Accounts  |
| director1   | admin    | Director  |

## API reference

### Auth
| Method | Endpoint              | Description         |
|--------|-----------------------|---------------------|
| POST   | /api/auth/login       | Login               |
| POST   | /api/auth/logout      | Logout              |
| GET    | /api/auth/me          | Current user        |
| GET    | /api/auth/users       | List all users      |
| POST   | /api/auth/users       | Create user (admin) |

### Trips
| Method | Endpoint          | Description          |
|--------|-------------------|----------------------|
| GET    | /api/trips        | List trips           |
| GET    | /api/trips/:id    | Get trip + lines     |
| POST   | /api/trips        | Create trip          |
| PUT    | /api/trips/:id    | Update trip          |
| DELETE | /api/trips/:id    | Soft delete          |

### Workflow
| Method | Endpoint                     | Role needed         |
|--------|------------------------------|---------------------|
| POST   | /api/workflow/:id/submit     | Traveller           |
| POST   | /api/workflow/:id/return     | Reviewer / Approver |
| POST   | /api/workflow/:id/review     | Reviewer            |
| POST   | /api/workflow/:id/approve    | Approver            |
| POST   | /api/workflow/:id/paid       | Accounts / Director |
| GET    | /api/workflow/:id/history    | Any                 |

### Files
| Method | Endpoint                        | Description       |
|--------|---------------------------------|-------------------|
| POST   | /api/files/upload/:tripId       | Upload attachment |
| GET    | /api/files/:attachmentId        | Download file     |
| DELETE | /api/files/:attachmentId        | Delete file       |
| GET    | /api/files/trip/:tripId         | List attachments  |

### FX Rates
| Method | Endpoint          | Description              |
|--------|-------------------|--------------------------|
| GET    | /api/fx           | All cached rates         |
| GET    | /api/fx/:currency | Single rate (e.g. /USD)  |
| POST   | /api/fx/refresh   | Force refresh (admin)    |

## Deploy to Render

1. Push this repo to GitHub
2. New Web Service on render.com → connect your repo
3. Set all env vars from `.env.example` in Render dashboard
4. Add a PostgreSQL database on Render, copy the connection string to `DATABASE_URL`
5. Add a Build Command: `npm install && psql $DATABASE_URL -f schema.sql`
6. Start Command: `npm start`

## GoDaddy DNS → Render

In GoDaddy DNS Management:
- Type: `CNAME`
- Host: `travel` (or `@` for root)
- Value: `your-app.onrender.com`
- TTL: 1 hour

SSL is auto-provisioned by Render via Let's Encrypt.
