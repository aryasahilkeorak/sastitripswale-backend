// ============================================================
//  Server bootstrap.
// ============================================================
import app from './app.js';
import { env, assertProdSecrets } from './config/env.js';
import { connectDB } from './config/db.js';
import { sweepExpiredTrips } from './utils/tripLifecycle.js';
import { sweepDocumentReminders } from './utils/documentReminders.js';

assertProdSecrets();

const SWEEP_INTERVAL_MS = 15 * 60 * 1000;
// Coarser than the trip sweep - documentReminders.js itself caps each user
// to one notification/day, so checking every couple hours is plenty to
// catch everyone promptly without extra DB load.
const DOC_REMINDER_INTERVAL_MS = 2 * 60 * 60 * 1000;

function runTripSweep() {
  sweepExpiredTrips().catch((err) => {
    // eslint-disable-next-line no-console
    console.error('Trip lifecycle sweep failed:', err);
  });
}

function runDocumentReminderSweep() {
  sweepDocumentReminders()
    .then(({ checked, sent }) => {
      if (sent) {
        // eslint-disable-next-line no-console
        console.log(`Document reminder sweep: ${sent}/${checked} incomplete members reminded`);
      }
    })
    .catch((err) => {
      // eslint-disable-next-line no-console
      console.error('Document reminder sweep failed:', err.message);
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

    runDocumentReminderSweep();
    const docReminderTimer = setInterval(runDocumentReminderSweep, DOC_REMINDER_INTERVAL_MS);
    docReminderTimer.unref();

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
