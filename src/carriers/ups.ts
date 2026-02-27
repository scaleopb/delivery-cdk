import type { Carrier, TrackingResult, TrackingEvent, TrackingStatus } from '../types/tracking.js';

const UPS_API_BASE = 'https://onlinetools.ups.com';

interface UPSConfig {
  clientId: string;
  clientSecret: string;
}

let cachedToken: { token: string; expiresAt: number } | null = null;

async function getAccessToken(config: UPSConfig): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt) {
    return cachedToken.token;
  }

  const credentials = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64');

  const res = await fetch(`${UPS_API_BASE}/security/v1/oauth/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${credentials}`,
    },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
    }),
  });

  if (!res.ok) {
    throw new Error(`UPS auth failed: ${res.status} ${await res.text()}`);
  }

  const data = await res.json();
  cachedToken = {
    token: data.access_token,
    expiresAt: Date.now() + (Number(data.expires_in) - 60) * 1000,
  };
  return cachedToken.token;
}

function mapUPSStatus(statusCode: string, statusType: string): TrackingStatus {
  const typeMap: Record<string, TrackingStatus> = {
    D: 'delivered',
    I: 'in_transit',
    P: 'picked_up',
    M: 'pending',
    O: 'out_for_delivery',
    X: 'exception',
  };

  if (typeMap[statusType]) {
    return typeMap[statusType];
  }

  const codeMap: Record<string, TrackingStatus> = {
    SR: 'pending',
    MP: 'pending',
    DP: 'in_transit',
    AR: 'in_transit',
    IT: 'in_transit',
    OT: 'out_for_delivery',
    DL: 'delivered',
    RS: 'exception',
    DN: 'exception',
    NA: 'exception',
  };

  return codeMap[statusCode] ?? 'unknown';
}

function parseEvents(activities: any[]): TrackingEvent[] {
  return activities.map((activity: any) => {
    const location = [
      activity.location?.address?.city,
      activity.location?.address?.stateProvince,
      activity.location?.address?.countryCode,
    ]
      .filter(Boolean)
      .join(', ');

    const timestamp =
      activity.date && activity.time
        ? `${activity.date.slice(0, 4)}-${activity.date.slice(4, 6)}-${activity.date.slice(6, 8)}T${activity.time.slice(0, 2)}:${activity.time.slice(2, 4)}:${activity.time.slice(4, 6)}`
        : activity.date ?? '';

    return {
      timestamp,
      status: mapUPSStatus(activity.status?.code ?? '', activity.status?.type ?? ''),
      location,
      description: activity.status?.description ?? '',
    };
  });
}

export function createUPSCarrier(config: UPSConfig): Carrier {
  return {
    code: 'ups',
    name: 'UPS',

    async track(trackingNumber: string): Promise<TrackingResult> {
      const token = await getAccessToken(config);

      const res = await fetch(
        `${UPS_API_BASE}/api/track/v1/details/${encodeURIComponent(trackingNumber)}`,
        {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${token}`,
            transId: `track-${Date.now()}`,
            transactionSrc: 'delivery-cdk',
          },
        }
      );

      if (!res.ok) {
        throw new Error(`UPS tracking failed: ${res.status} ${await res.text()}`);
      }

      const data = await res.json();
      const shipment = data.trackResponse?.shipment?.[0];
      const pkg = shipment?.package?.[0];

      if (!pkg) {
        throw new Error(`No tracking data found for ${trackingNumber}`);
      }

      const currentStatus = pkg.currentStatus ?? pkg.activity?.[0]?.status;
      const activities = pkg.activity ?? [];

      return {
        carrier: 'ups',
        trackingNumber,
        status: mapUPSStatus(currentStatus?.code ?? '', currentStatus?.type ?? ''),
        estimatedDelivery: pkg.deliveryDate?.[0]?.date ?? shipment?.deliveryDate?.[0]?.date ?? null,
        events: parseEvents(activities),
      };
    },
  };
}
