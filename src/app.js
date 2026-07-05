// ============================================================
//  Express application — security middleware + routes.
// ============================================================
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import compression from 'compression';
import mongoSanitize from 'express-mongo-sanitize';
import hpp from 'hpp';

import { env } from './config/env.js';
import apiRoutes from './routes/index.js';
import { notFound, errorHandler } from './middleware/error.js';
import { generalLimiter } from './middleware/rateLimiters.js';
import { getFile } from './controllers/fileController.js';

const app = express();

// Behind a proxy (Railway/Render/Nginx) so rate-limit sees real IPs.
app.set('trust proxy', 1);

// --- Security headers ---
app.use(
  helmet({
    // Allow the uploaded images to be embedded by the separate frontend origin.
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    contentSecurityPolicy: false, // API only; frontend serves its own CSP
  })
);

// --- CORS (restricted to configured frontends) ---
// Normalise once so "https://x/" and "https://x" compare equal.
const allowedOrigins = env.frontendUrls.map((o) => o.replace(/\/+$/, ''));
app.use(
  cors({
    origin(origin, cb) {
      // No origin header = curl / server-to-server / mobile app → allow.
      if (!origin) return cb(null, true);
      if (allowedOrigins.includes(origin.replace(/\/+$/, ''))) return cb(null, true);
      // Deny cleanly — return false instead of throwing, so a blocked origin
      // gets a normal CORS rejection, NOT a 500 on the preflight.
      return cb(null, false);
    },
    credentials: true,
  })
);

// --- Body parsing (capture raw body for webhook signature checks) ---
app.use(
  express.json({
    limit: '1mb',
    verify: (req, res, buf) => {
      req.rawBody = buf;
    },
  })
);
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// --- NoSQL injection + HTTP param pollution protection ---
app.use(mongoSanitize());
app.use(hpp());

// --- Compression + logging ---
app.use(compression());
app.use(morgan(env.isProd ? 'combined' : 'dev'));

// --- Uploaded files (stored in MongoDB) — outside the rate limiter so image
//     heavy pages don't get throttled. ---
app.get('/api/files/:id', getFile);

// --- API ---
app.use('/api', generalLimiter, apiRoutes);

app.get('/', (req, res) => {
  res.json({ success: true, service: 'SastiTripWale API', docs: '/api/health' });
});

// --- 404 + errors ---
app.use(notFound);
app.use(errorHandler);

export default app;
