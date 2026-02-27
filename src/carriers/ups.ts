import type { Carrier, TrackingResult, TrackingEvent, TrackingStatus } from '../types/tracking.js';

const UPS_API_BASE = 'https://onlinetools.ups.com';

interface UPSConfig {
  clientId: string;
  clientSecret: string;
}

interface UPSAddress {
  city?: string;
  stateProvince?: string;
  countryCode?: string;
}

interface UPSStatus {
  code?: string;
  type?: string;
  description?: string;
}

interface UPSActivity {
  date?: string;
  time?: string;
  location?: { address?: UPSAddress };
  status?: UPSStatus;
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

  if (statusType in typeMap) {
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

function formatUPSDate(date: string): string {
  if (date.length !== 8) return date;
  return `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`;
}

function formatUPSTimestamp(date: string, time: string): string {
  const formattedDate = formatUPSDate(date);
  if (formattedDate === date) return date;
  if (time.length !== 6) return formattedDate;
  return `${formattedDate}T${time.slice(0, 2)}:${time.slice(2, 4)}:${time.slice(4, 6)}`;
}

function parseEvents(activities: UPSActivity[]): TrackingEvent[] {
  return activities.map((activity) => {
    const address = activity.location?.address;
    const location = [address?.city, address?.stateProvince, address?.countryCode]
      .filter(Boolean)
      .join(', ');

    const timestamp =
      activity.date && activity.time
        ? formatUPSTimestamp(activity.date, activity.time)
        : activity.date
          ? formatUPSDate(activity.date)
          : '';

    return {
      timestamp,
      status: mapUPSStatus(activity.status?.code ?? '', activity.status?.type ?? ''),
      location,
      description: activity.status?.description ?? '',
    };
  });
}

export function createUPSCarrier(config: UPSConfig): Carrier {
  let cachedToken: { token: string; expiresAt: number } | null = null;
  let tokenPromise: Promise<string> | null = null;

  async function fetchNewToken(): Promise<string> {
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
      throw new Error(`UPS auth failed: ${res.status}`);
    }

    const data = await res.json();

    if (!data.access_token) {
      throw new Error('UPS auth response missing access_token');
    }

    const expiresIn = Math.max(Number(data.expires_in) || 3600, 120);
    cachedToken = {
      token: data.access_token,
      expiresAt: Date.now() + (expiresIn - 60) * 1000,
    };
    return cachedToken.token;
  }

  async function getAccessToken(): Promise<string> {
    if (cachedToken && Date.now() < cachedToken.expiresAt) {
      return cachedToken.token;
    }
    if (!tokenPromise) {
      tokenPromise = fetchNewToken().finally(() => { tokenPromise = null; });
    }
    return tokenPromise;
  }

  return {
    code: 'ups',
    name: 'UPS',

    async track(trackingNumber: string): Promise<TrackingResult> {
      if (!trackingNumber || trackingNumber.length > 50) {
        throw new Error(`Invalid UPS tracking number: ${trackingNumber}`);
      }

      const token = await getAccessToken();

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
        throw new Error(`UPS tracking failed: ${res.status}`);
      }

      const data = await res.json();
      const shipment = data.trackResponse?.shipment?.[0];
      const pkg = shipment?.package?.[0];

      if (!pkg) {
        throw new Error(`No tracking data found for ${trackingNumber}`);
      }

      const currentStatus = pkg.currentStatus ?? pkg.activity?.[0]?.status;
      const activities: UPSActivity[] = pkg.activity ?? [];
      const rawDeliveryDate = pkg.deliveryDate?.[0]?.date ?? shipment?.deliveryDate?.[0]?.date ?? null;

      return {
        carrier: 'ups',
        trackingNumber,
        status: mapUPSStatus(currentStatus?.code ?? '', currentStatus?.type ?? ''),
        estimatedDelivery: rawDeliveryDate ? formatUPSDate(rawDeliveryDate) : null,
        events: parseEvents(activities),
      };
    },
  };
}
