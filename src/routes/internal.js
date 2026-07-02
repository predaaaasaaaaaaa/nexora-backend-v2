import express from 'express';
import { reconcileTelemetry } from '../controllers/reconcileTelemetry.js';

const router = express.Router();

// Internal, cron-only telemetry reconcile guard. Not part of the public API:
// the handler itself requires `Authorization: Bearer $CRON_SECRET` (which
// Vercel Cron attaches automatically) and refuses everything else. Vercel Cron
// issues GET; POST is accepted too for manual runs with the same secret.
router.get('/reconcile-telemetry', reconcileTelemetry);
router.post('/reconcile-telemetry', reconcileTelemetry);

export default router;
