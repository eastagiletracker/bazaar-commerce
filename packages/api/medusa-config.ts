import { loadEnv } from '@medusajs/framework/utils'
import { withMercur } from '@mercurjs/core'
import fs from 'fs'
import path from 'path'

loadEnv(process.env.NODE_ENV || 'development', process.cwd())

// Resolves where a dashboard app lives:
// - in the source tree (development): ../../apps/<name>
// - in the production build artifact: hosts that deploy only `.medusa/server` (for example
//   Medusa Cloud) get the panels bundled into ./dashboards/<name> by
//   scripts/bundle-dashboards.mjs during `build`. The compiled config runs from the
//   artifact root, so __dirname points there.
const dashboardAppDir = (name: string) => {
  const bundled = path.join(__dirname, 'dashboards', name)
  return fs.existsSync(bundled) ? bundled : path.join(__dirname, `../../apps/${name}`)
}

// Without a real Redis, Medusa silently substitutes a fake instance, an
// in-memory lock and a local event bus. The payout and COD reconciliation jobs
// need a queue that survives a restart, so fail loudly instead of degrading.
const redisUrl = process.env.REDIS_URL
if (!redisUrl) {
  throw new Error(
    'REDIS_URL is not set. Start the dev stack with `docker compose up -d` ' +
      'and check packages/api/.env.'
  )
}

module.exports = withMercur({
  projectConfig: {
    databaseUrl: process.env.DATABASE_URL,
    redisUrl,
    http: {
      storeCors: process.env.STORE_CORS!,
      adminCors: process.env.ADMIN_CORS!,
      vendorCors: process.env.VENDOR_CORS!,
      authCors: process.env.AUTH_CORS!,
      jwtSecret: process.env.JWT_SECRET || "supersecret",
      cookieSecret: process.env.COOKIE_SECRET || "supersecret",
    }
  },
  featureFlags: {
    seller_registration: true
  },
  modules: [
    // Pakistan settlement ledger: double-entry accounting, COD courier
    // reconciliation and the exception queue. Mercur's payout pipeline assumes
    // an authorized card payment it can capture; COD has no authorization, so
    // the money path lives here.
    {
      resolve: './src/modules/settlement',
    },
    // Buyer confirmation before dispatch. RTO runs 20-40% on Pakistani COD and
    // the seller pays freight in both directions, so asking the buyer "still
    // want it?" before the parcel moves is the cheapest lever against it. Holds
    // dispatch until the answer is yes. See docs/marketplace/order-confirmation.md.
    {
      resolve: './src/modules/order-confirmation',
    },
    // Digital fulfilment: the encrypted code vault and the fraud gate in front
    // of it. A released code cannot be recalled, so unlike the parcel gate
    // above, this one holds on doubt rather than releasing.
    // Needs PK_VAULT_KEY set in production; see docs/marketplace/digital-products.md.
    {
      resolve: './src/modules/digital-fulfilment',
    },
    // Payout rail. Stripe Connect, which Mercur ships by default, does not
    // serve Pakistan-registered businesses, so we register our own provider.
    // The module accepts exactly one provider, which is fine while we are
    // Pakistan-only. Until a PSP is contracted this runs the mock driver —
    // which models pending KYC and failed disbursements rather than pretending
    // every payout succeeds. See docs/marketplace/phase0-decisions.md.
    {
      resolve: '@mercurjs/core/modules/payout',
      options: {
        providers: [
          {
            resolve: './src/providers/payout-pakistan',
            id: 'pakistan',
            options: {
              driver: process.env.PK_PSP_DRIVER ?? 'mock',
              autoActivate: process.env.PK_PSP_AUTO_ACTIVATE === 'true',
              onboardingReturnUrl: `${process.env.MERCUR_VENDOR_URL ?? ''}/settings/payouts`,
            },
          },
        ],
      },
    },
    // Redis-backed infrastructure. The payout pipeline runs on scheduled jobs
    // and events, so these must be durable rather than in-process.
    {
      resolve: '@medusajs/medusa/cache-redis',
      options: { redisUrl },
    },
    {
      resolve: '@medusajs/medusa/event-bus-redis',
      options: { redisUrl },
    },
    {
      resolve: '@medusajs/medusa/workflow-engine-redis',
      options: { redis: { redisUrl } },
    },
    {
      resolve: '@medusajs/medusa/locking',
      options: {
        providers: [
          {
            resolve: '@medusajs/medusa/locking-redis',
            id: 'locking-redis',
            is_default: true,
            options: { redisUrl },
          },
        ],
      },
    },
    {
      resolve: '@mercurjs/core/modules/admin-ui',
      options: {
        appDir: dashboardAppDir('admin'),
        path: '/dashboard',
        // Must match apps/admin's vite port. The module defaults to 7000,
        // which macOS AirPlay Receiver squats on — the proxy then returns a
        // bare 403 from AirTunes and the panel looks broken.
        viteDevServerPort: Number(process.env.ADMIN_DEV_PORT ?? 3103),
      }
    },
    {
      resolve: '@mercurjs/core/modules/vendor-ui',
      options: {
        appDir: dashboardAppDir('vendor'),
        path: '/seller',
        // Must match apps/vendor's vite port (see the admin-ui note above).
        viteDevServerPort: Number(process.env.VENDOR_DEV_PORT ?? 3102),
      }
    },
    {
      resolve: '@medusajs/medusa/file',
      options: {
        providers: [
          {
            resolve: '@medusajs/medusa/file-local',
            id: 'local',
            options: {
              // The local provider bakes this into every uploaded file URL.
              // It must be the publicly reachable origin in production, or
              // images resolve to localhost and render broken.
              backend_url: process.env.FILE_BACKEND_URL || 'http://localhost:9000/static',
            },
          },
        ],
      },
    },
  ],
})
