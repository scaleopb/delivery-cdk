import type { Carrier, TrackingResult, TrackingEvent, TrackingStatus } from '../types/tracking.js';

const FEDEX_API_BASE = 'https://apis.fedex.com';

interface FedExConfig {
  clientId: string;
  clientSecret: string;
}

let cachedToken: { token: string; expiresAt: number } | null = null;

async function getAccessToken(config: FedExConfig): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt) {
    return cachedToken.token;
  }

  const res = await fetch(`${FEDEX_API_BASE}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: config.clientId,
      client_secret: config.clientSecret,
    }),
  });

  if (!res.ok) {
    throw new Error(`FedEx auth failed: ${res.status} ${await res.text()}`);
  }

  const data = await res.json();
  cachedToken = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in - 60) * 1000,
  };
  return cachedToken.token;
}

function mapFedExStatus(statusCode: string): TrackingStatus {
  const map: Record<string, TrackingStatus> = {
    PU: 'picked_up',
    IT: 'in_transit',
    OD: 'out_for_delivery',
    DL: 'delivered',
    DE: 'exception',
    SE: 'exception',
  };
  return map[statusCode] ?? 'unknown';
}

function parseEvents(scanEvents: any[]): TrackingEvent[] {
  return scanEvents.map((event: any) => ({
    timestamp: event.date ?? event.eventTimestamp ?? '',
    status: mapFedExStatus(event.derivedStatusCode ?? event.eventType ?? ''),
    location: [
      event.scanLocation?.city,
      event.scanLocation?.stateOrProvinceCode,
      event.scanLocation?.countryCode,
    ]
      .filter(Boolean)
      .join(', '),
    description: event.eventDescription ?? event.description ?? '',
  }));
}

export function createFedExCarrier(config: FedExConfig): Carrier {
  return {
    code: 'fedex',
    name: 'FedEx',

    async track(trackingNumber: string): Promise<TrackingResult> {
      const token = await getAccessToken(config);

      const res = await fetch(`${FEDEX_API_BASE}/track/v1/trackingnumbers`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          includeDetailedScans: true,
          trackingInfo: [
            {
              trackingNumberInfo: { trackingNumber },
            },
          ],
        }),
      });

      if (!res.ok) {
        throw new Error(`FedEx tracking failed: ${res.status} ${await res.text()}`);
      }

      const data = await res.json();
      const result = data.output?.completeTrackResults?.[0]?.trackResults?.[0];

      if (!result) {
        throw new Error(`No tracking data found for ${trackingNumber}`);
      }

      const latestStatus = result.latestStatusDetail;
      const events = parseEvents(result.scanEvents ?? result.dateAndTimes ?? []);

      return {
        carrier: 'fedex',
        trackingNumber,
        status: mapFedExStatus(latestStatus?.derivedCode ?? latestStatus?.statusCode ?? ''),
        estimatedDelivery: result.estimatedDeliveryTimeWindow?.window?.ends ?? null,
        events,
      };
    },
  };
}
