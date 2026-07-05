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
import path from 'path';
import { fileURLToPath } from 'url';

import { env } from './config/env.js';
import apiRoutes from './routes/index.js';
import { notFound, errorHandler } from './middleware/error.js';
import { generalLimiter } from './middleware/rateLimiters.js';
import { UPLOAD_ROOT } from './middleware/upload.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
app.use(
  cors()
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

// --- Static: uploaded files (images/docs stored on this backend) ---
app.use(
  `/${env.upload.dir}`,
  express.static(UPLOAD_ROOT, {
    maxAge: '7d',
    setHeaders: (res) => res.set('Cross-Origin-Resource-Policy', 'cross-origin'),
  })
);

// --- API ---
app.use('/api', generalLimiter, apiRoutes);

app.get('/', (req, res) => {
  res.json({ success: true, service: 'SastiTripWale API', docs: '/api/health' });
});

// --- 404 + errors ---
app.use(notFound);
app.use(errorHandler);

export default app;
