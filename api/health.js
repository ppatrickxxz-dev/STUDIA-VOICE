import { healthPayload } from '../services/api/health.mjs';

export default function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.status(200).json(healthPayload(process.env.VERCEL_GIT_COMMIT_SHA || 'local'));
}

