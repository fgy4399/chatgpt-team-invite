# ChatGPT Team Invitation Code Management System

A ChatGPT Team invitation code management and automated invitation tool built with Next.js + Prisma: Users submit “invitation code + email address,” and the system automatically initiates Team invitations with status tracking. Administrators can generate/revoke invitation codes, manage multiple Teams, and synchronize member counts with available slots.

## Key Features

- Admin Dashboard: Login, invitation code generation/revocation, data overview
- Invitation Workflow: Email binding for codes, retry capability, automatic consumption upon success
- Multi-Team Management: Priority settings, quota limits, member count synchronization (with concurrency restrictions)
- Subscription Status: Displays seats/expiration/renewal status with auto-renewal cancellation support
- Status Page: View invitation processing progress and results (successful/failed/in progress)
- Storage: Default SQLite (local/small-scale deployment), optional Turso/libsql

## Tech Stack

- Next.js 16 (App Router)
- Prisma + SQLite (`better-sqlite3`)/Turso (libsql)
- TypeScript + ESLint

## Quick Start (Local Development)

```bash
cp .env.example .env
npm install
npx prisma migrate dev
npm run dev
```

Access:
- User Page: `http://localhost:3000/`
- Admin Dashboard: `http://localhost:3000/admin`

## Environment Variables

Use `.env.example` as reference (this project won't commit your `.env`).

| Variable | Required | Description |
| --- | --- | --- |
| `JWT_SECRET` | ✅ | Admin JWT signing key (recommended ≥ 32-character random string) |
| `ADMIN_USERNAME` | ✅* | Only used for “initial admin account creation” (effective when no Admin exists in the database) |
| `ADMIN_PASSWORD` | ✅* | Same as above |
| `DATABASE_URL` | Optional | Recommended for production; local default `prisma/dev.db` |
| `DATABASE_AUTH_TOKEN` | Optional | Authentication token for Turso/libsql |
| `LOG_LEVEL` | Optional | `debug/info/warn/error` |

Notes:
- Must configure Team in the backend and provide full Cookies (including `__Secure-next-auth.session-token`) to support automatic Access Token refresh.
- Modifying `ADMIN_USERNAME/ADMIN_PASSWORD` does not update existing admin accounts (only effective during initial setup).

## Automatic Access Token Refresh

- The system automatically refreshes the Access Token when it nears expiration (depends on backend-configured Cookies).
- If Cookies lack the Session Token (`__Secure-next-auth.session-token`), refresh will fail and block related operations.

## Database and Migration

- Local development defaults to SQLite: `prisma/dev.db`
- Migration (development): `npx prisma migrate dev`
- Migration (production): `npx prisma migrate deploy`

## Build and Run

```bash
npm run build
npm run start
```

> Note: Next.js 16 build

Translated with DeepL.com (free version)
