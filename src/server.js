// ============================================================
//  Server bootstrap.
// ============================================================
import app from './app.js';
import { env, assertProdSecrets } from './config/env.js';
import { connectDB } from './config/db.js';
import { sweepExpiredTrips } from './utils/tripLifecycle.js';

assertProdSecrets();

const SWEEP_INTERVAL_MS = 15 * 60 * 1000;

function runTripSweep() {
  sweepExpiredTrips().catch((err) => {
    // eslint-disable-next-line no-console
    console.error('Trip lifecycle sweep failed:', err);
  });
}

async function start() {
  try {
    await connectDB();
    const server = app.listen(env.port, () => {
      // eslint-disable-next-line no-console
      console.log(`\n🚀 SastiTripWale API running on http://localhost:${env.port}`);
      console.log(`   Env: ${env.nodeEnv} | Razorpay: ${env.razorpay.enabled ? 'live' : 'test-mode'} | Email: ${env.email.enabled ? 'on' : 'console'}\n`);
    });

    runTripSweep();
    const sweepTimer = setInterval(runTripSweep, SWEEP_INTERVAL_MS);
    sweepTimer.unref();

    const shutdown = (signal) => {
      // eslint-disable-next-line no-console
      console.log(`\n${signal} received - shutting down...`);
      server.close(() => process.exit(0));
    };
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('❌ Failed to start server:', err);
    process.exit(1);
  }
}

start();
