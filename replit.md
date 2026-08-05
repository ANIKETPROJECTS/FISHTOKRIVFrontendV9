# FishTokri

A mobile-first, full-stack web application for an online fresh fish, seafood, and meat retailer based in Mumbai. Provides a premium, app-like storefront for customers and a protected admin panel for inventory and order management.

## Tech Stack

- **Frontend**: React 18, TypeScript, Vite, Tailwind CSS, Framer Motion
- **Backend**: Node.js, Express 5
- **Database**: MongoDB with Mongoose ODM
- **Auth**: Passport.js (local strategy) with session-based auth via connect-mongo
- **State/Data**: TanStack Query (React Query), React Context (cart)
- **Routing**: wouter
- **UI Components**: Radix UI / shadcn-ui, Lucide icons, Embla Carousel

## Project Structure

- `client/` — React frontend (Vite)
  - `src/components/storefront/` — Customer-facing components
  - `src/components/admin/` — Admin panel components
  - `src/components/ui/` — Shared Radix/shadcn UI components
  - `src/pages/storefront/` — Storefront pages (Home, Product Detail, Profile)
  - `src/pages/admin/` — Admin pages (Dashboard, Orders, Products)
  - `src/hooks/` — Custom React hooks
  - `src/context/` — Cart context
- `server/` — Express backend
  - `index.ts` — Entry point, middleware setup
  - `routes.ts` — API route definitions (all data routes are hub-aware via X-Hub-DB header)
  - `db.ts` — Minimal placeholder (no default DB connection)
  - `adminDb.ts` — `fishtokri_admin` DB connection; stores SuperHub, SubHub, admin Users, sessions
  - `hubConnections.ts` — Per-location DB connection cache; provides Product, Section, Carousel, Category, Combo models per hub
  - `ordersDb.ts` — Shared `orders` DB connection
  - `customerDb.ts` — Shared `customers` DB connection
  - `storage.ts` — Data access layer for user auth, orders, and customers
  - `auth.ts` — Passport.js authentication (sessions stored in fishtokri_admin)
  - `vite.ts` — Vite dev server middleware (development only)
  - `static.ts` — Static file serving (production only)
  - `imageStore.ts` — In-memory image storage
- `shared/` — Shared TypeScript types and Zod schemas
- `script/` — Build scripts

## Database Architecture

The app uses **multiple MongoDB databases** — one per hub (location), plus shared admin/orders/customers databases:

| Database | Purpose |
|---|---|
| `fishtokri_admin` | Admin users, sessions, SuperHub & SubHub config |
| `orders` | All customer orders (shared across hubs) |
| `customers` | Customer profiles and addresses (shared) |
| `<hub-dbName>` | Per-location products, sections, carousel, categories, combos |

Each storefront API request includes an `X-Hub-DB` header (set by the frontend based on the selected location) to route reads and writes to the correct hub database. No "fishtokri" default database is created.

Per-hub collections include: products, sections, carousel, categories, combos, and **timeslots**. Timeslots are auto-seeded with defaults on first fetch if the hub DB has none.

## Environment Variables

- `MONGODB_URI` — MongoDB connection string (required, set as a secret)
- `SESSION_SECRET` — Express session secret (required — `server/auth.ts` reads it as `process.env.SESSION_SECRET!`; missing it breaks session setup at boot)
- `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` — Razorpay payment credentials (secrets)
- `VITE_RAZORPAY_KEY_ID` — Razorpay publishable key exposed to the client bundle (shared env var, not a secret — same key as `RAZORPAY_KEY_ID`)
- `VITE_GOOGLE_MAPS_API_KEY` — Google Maps key exposed to the client bundle (shared env var, restricted by domain, not a secret)
- `ADMARK_API_KEY` / `ADMARK_PHONE_NUMBER_ID` — WhatsApp/messaging credentials (secrets)
- `PORT` — Server port (defaults to 5000)

Note: this project previously had live credentials committed in plaintext inside `.replit` (`[userenv.shared]`). They have been removed from that file and replaced with proper Replit Secrets / env vars. Because those values were exposed in git history, consider rotating the MongoDB password and Razorpay/Admark/AiSensy keys.

## Running the App

- **Development**: `npm run dev` — starts the Express server with Vite middleware (bound to the "Start application" workflow)
- **Build**: `npm run build` — builds the frontend to `dist/public`
- **Production**: `npm start` — serves the built frontend + API

## Replit Setup (last verified 2026-07-19)

### 1. Install dependencies
```
npm install
```
The `dev` script uses `tsx` from `node_modules/.bin/tsx` — always run `npm install` after a fresh import or clone before starting the workflow.

The development command loads the existing app environment from `ecosystem.config.cjs` and keeps Replit's preview port at `5000`. The ecosystem file is also used by the existing production/PM2 setup.

### 2. Configure environment variables
All required values are documented in `.env.example`. On Replit, set them as **Secrets / env vars** (never commit plaintext credentials):

| Variable | Where to set | Notes |
|---|---|---|
| `MONGODB_URI` | Replit Secret | Full connection string incl. credentials |
| `SESSION_SECRET` | Replit Secret | Long random string |
| `RAZORPAY_KEY_ID` | Replit Secret | Live key from Razorpay dashboard |
| `RAZORPAY_KEY_SECRET` | Replit Secret | Secret from Razorpay dashboard |
| `VITE_RAZORPAY_KEY_ID` | Replit env var | Same value as `RAZORPAY_KEY_ID`; baked into client bundle |
| `VITE_GOOGLE_MAPS_API_KEY` | Replit env var | Domain-restricted; baked into client bundle |
| `ADMARK_API_KEY` | Replit Secret | WhatsApp notifications (optional) |
| `ADMARK_PHONE_NUMBER_ID` | Replit env var | Admark sender phone number ID |

### 3. Start the app
Run the **Start application** workflow (or `npm run dev`). On a healthy boot you should see:
```
Connected to fishtokri_admin DB
Connected to orders DB
Connected to customers DB
Connected to hub DB: <hub-name>
5:xx:xx AM [express] serving on port 5000
```

The 401s logged by the browser on `/api/auth/me` for unauthenticated users are expected and not an error — the client checks session state on every load.

## Key Features

### Customer Storefront
- Dynamic product browsing with category filters (Fish, Prawns, Chicken, Mutton, Masalas, etc.)
- Carousel banners, "Today's Fresh Catch" hero section
- Shopping cart with slide-up drawer and order request flow, including **delivery time slot selection**
- Instant Delivery option (via Porter) with ₹49 extra charge shown clearly in cart and bill
- Scheduled delivery slots (Morning, Midday, Afternoon, Evening) stored in per-hub `timeslots` collection
- Availability badges, combo specials
- Homepage sections driven by MongoDB `sections` collection — fully dynamic

### Admin Panel
- Secure login (session-based auth)
- Dashboard with summary statistics and availability toggles
- Full CRUD for products and categories
- Order management (pending/confirmed)
- Carousel slide management
- **Sections management** (`/admin/sections`) — create/edit/delete homepage sections; sections have a `type` ("products" or "combos"), `sortOrder`, and `isActive` toggle
- Products have a `sectionId` field to assign them to a specific homepage section
