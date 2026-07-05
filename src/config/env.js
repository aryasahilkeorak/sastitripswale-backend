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
// override: true → values in .env win over any pre-existing shell env vars.
// Safe for deployment: hosts (Railway/Render/etc.) have no committed .env file,
// so their dashboard-provided vars are still used. This prevents a stray global
// var (e.g. a leftover MONGODB_URI) from silently overriding your local config.
dotenv.config({ path: path.resolve(__dirname, '../../.env'), override: true });

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

  seed: {
    adminEmail: process.env.SEED_ADMIN_EMAIL || 'admin@sastitripwale.com',
    adminPassword: process.env.SEED_ADMIN_PASSWORD || 'Admin@123',
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
}

export default env;
