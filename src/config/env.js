// ============================================================
//  Centralised environment config.
//  Reads process.env once, applies sane defaults, and exposes
//  feature flags so the rest of the app never touches process.env.
// ============================================================
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// backend/.env  (this file lives in backend/src/config)
// In DEVELOPMENT: override so your local .env wins over stale global shell vars.
// In PRODUCTION (Render/host): do NOT override - the platform's dashboard env
// vars must win, even if a .env file was accidentally committed to the repo.
dotenv.config({
  path: path.resolve(__dirname, '../../.env'),
  override: process.env.NODE_ENV !== 'production',
});

const bool = (v) => String(v).toLowerCase() === 'true';
const int = (v, d) => (Number.isFinite(parseInt(v, 10)) ? parseInt(v, 10) : d);

export const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  isProd: process.env.NODE_ENV === 'production',
  port: int(process.env.PORT, 5000),

  // Support multiple comma-separated origins
  frontendUrls: (process.env.FRONTEND_URL || 'http://localhost:5173')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),

  mongoUri: process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/sastitripwale',

  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET || 'dev_access_secret_change_me',
    refreshSecret: process.env.JWT_REFRESH_SECRET || 'dev_refresh_secret_change_me',
    accessExpires: process.env.JWT_ACCESS_EXPIRES || '15m',
    refreshExpires: process.env.JWT_REFRESH_EXPIRES || '30d',
  },

  membershipFee: int(process.env.MEMBERSHIP_FEE, 99), // rupees

  razorpay: {
    keyId: process.env.RAZORPAY_KEY_ID || '',
    keySecret: process.env.RAZORPAY_KEY_SECRET || '',
    webhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET || '',
    get enabled() {
      return Boolean(this.keyId && this.keySecret);
    },
  },

  email: {
    host: process.env.EMAIL_HOST || 'smtp.gmail.com',
    port: int(process.env.EMAIL_PORT, 587),
    user: process.env.EMAIL_USER || '',
    pass: process.env.EMAIL_PASS || '',
    from: process.env.EMAIL_FROM || 'SastiTripWale <no-reply@sastitripwale.com>',
    get enabled() {
      return Boolean(this.user && this.pass);
    },
  },

  upload: {
    dir: process.env.UPLOAD_DIR || 'uploads',
    maxMb: int(process.env.MAX_UPLOAD_MB, 5),
  },

  pexels: {
    apiKey: process.env.PEXELS_API_KEY || '',
  },

  // Web Push (browser notifications). Dev-only fallback keys are provided so
  // this works out of the box locally - set real ones (`npx web-push
  // generate-vapid-keys`) in production.
  push: {
    publicKey: process.env.VAPID_PUBLIC_KEY || 'BK_gLY6DSG4QJf5VbAxgGcVNZ5x_7omalIT6RWXibI2mKPhY5HCpFXvUjJnyap65Wv1ce6gjVZ9J3SE_p6q11PM',
    privateKey: process.env.VAPID_PRIVATE_KEY || '_qSO7WrwEBbtE0k__f5VbkW129ANdDZWuEZz5a8h1MI',
    contactEmail: process.env.VAPID_CONTACT_EMAIL || 'admin@sastitripwale.com',
  },

  seed: {
    adminEmail: process.env.SEED_ADMIN_EMAIL || 'admin@sastitripwale.com',
    adminPassword: process.env.SEED_ADMIN_PASSWORD || 'Admin@123',
  },

  // Support chat AI auto-reply. Disabled (falls back to a "we'll reply
  // within 24 hours" message) whenever no key is configured.
  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY || '',
    get enabled() {
      return Boolean(this.apiKey);
    },
  },
};

// Loud warnings in production if critical secrets are still defaults.
export function assertProdSecrets() {
  if (!env.isProd) return;
  const weak = [];
  if (env.jwt.accessSecret.length < 32 || env.jwt.accessSecret.includes('change_me'))
    weak.push('JWT_ACCESS_SECRET');
  if (env.jwt.refreshSecret.length < 32 || env.jwt.refreshSecret.includes('change_me'))
    weak.push('JWT_REFRESH_SECRET');
  if (env.jwt.accessSecret === env.jwt.refreshSecret) weak.push('JWT secrets must differ');
  if (weak.length) {
    // eslint-disable-next-line no-console
    console.error('\n[SECURITY] Weak/duplicate secrets in production:', weak.join(', '));
    process.exit(1);
  }

  // Lower-severity than the JWT secrets above, so these warn rather than
  // hard-exit (unknown here whether Render's env already has them set -
  // crashing boot on an unverifiable assumption would be worse than the risk
  // itself). Set real values in the Render dashboard when you get a chance.
  const softWeak = [];
  if (env.push.publicKey.startsWith('BK_gLY6DSG4') || env.push.privateKey.startsWith('_qSO7WrwEBbt'))
    softWeak.push('VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY (still the shared dev default)');
  if (env.seed.adminPassword === 'Admin@123') softWeak.push('SEED_ADMIN_PASSWORD (still the default - never run the seed script against production with this)');
  if (softWeak.length) {
    // eslint-disable-next-line no-console
    console.warn('\n[SECURITY] Should be rotated in production:', softWeak.join(', '));
  }
}

export default env;
