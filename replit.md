# CampusBite

CampusBite lets campus customers order ahead and track pickup tokens while canteen staff manage the menu, orders, and kitchen display.

## Run & Operate

- `pnpm --filter @workspace/campusbite run dev` — run the customer and staff web app
- `pnpm --filter @workspace/api-server run dev` — run the API server
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- SQLite file defaults to `artifacts/api-server/.data/campusbite.sqlite`; override with `CAMPUSBITE_DB_PATH`.
- Set `CAMPUSBITE_ADMIN_EMAIL` and the `CAMPUSBITE_ADMIN_PASSWORD` secret to create or update the staff login at API startup. `SESSION_SECRET` is also required.

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: SQLite via Node's built-in `node:sqlite` API
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `lib/api-spec/openapi.yaml` is the API contract.
- `artifacts/api-server/src/lib/campus-db.ts` owns the CampusBite SQLite schema and sample menu.
- `artifacts/api-server/src/lib/campus-auth.ts` owns hashed passwords and server-side sessions.
- `artifacts/api-server/src/lib/campus-orders.ts` owns order transitions, analytics, and daily token allocation.
- `artifacts/campusbite/src/` is the web application.

## Architecture decisions

- The app data store is SQLite as requested; do not switch CampusBite to the workspace PostgreSQL scaffold without a product decision.
- Daily tokens use an SQLite write transaction and a unique `(token_date, token_number)` constraint to prevent duplicates.
- Normal registration always creates a customer. Admin identities are bootstrapped only from environment configuration.

## Product

Customers browse and order canteen food, receive sequential daily pickup tokens, and track status. Staff manage orders and menu availability, with kitchen and ready-token screens for in-canteen displays.

## User preferences

No additional project-specific preferences recorded.

## Gotchas

- Keep the admin password in Replit Secrets; do not add demo credentials to the client or source code.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
