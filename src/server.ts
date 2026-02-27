import { Hono } from 'hono';
import { logger } from 'hono/logger';
import { CarrierRegistry } from './registry.js';
import { createFedExCarrier, createUPSCarrier } from './carriers/index.js';
import type { CarrierCode } from './types/tracking.js';

const app = new Hono();
const registry = new CarrierRegistry();

// --- Register carriers ---
const fedexClientId = process.env.FEDEX_CLIENT_ID;
const fedexClientSecret = process.env.FEDEX_CLIENT_SECRET;

if (fedexClientId && fedexClientSecret) {
  registry.register(
    createFedExCarrier({ clientId: fedexClientId, clientSecret: fedexClientSecret })
  );
}

const upsClientId = process.env.UPS_CLIENT_ID;
const upsClientSecret = process.env.UPS_CLIENT_SECRET;

if (upsClientId && upsClientSecret) {
  registry.register(
    createUPSCarrier({ clientId: upsClientId, clientSecret: upsClientSecret })
  );
}

// --- Middleware ---
app.use('*', logger());

// --- Routes ---
app.get('/', (c) =>
  c.json({
    service: 'delivery-cdk',
    carriers: registry.list(),
  })
);

app.get('/carriers', (c) => c.json({ carriers: registry.list() }));

app.get('/track/:carrier/:trackingNumber', async (c) => {
  const carrierCode = c.req.param('carrier') as CarrierCode;
  const trackingNumber = c.req.param('trackingNumber');

  const carrier = registry.get(carrierCode);
  if (!carrier) {
    return c.json({ error: `Carrier "${carrierCode}" not registered` }, 404);
  }

  try {
    const result = await carrier.track(trackingNumber);
    return c.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Tracking failed';
    return c.json({ error: message }, 502);
  }
});

export default app;
