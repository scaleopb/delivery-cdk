import type { Carrier, TrackingResult, TrackingStatus } from '../types/tracking.js';

const NOVA_POSHTA_API = 'https://api.novaposhta.ua/v2.0/json/';

interface NovaPoshtaConfig {
  apiKey: string;
}

interface NovaPoshtaTrackingData {
  StatusCode?: number;
  Status?: string;
  TrackingUpdateDate?: string;
  DateScan?: string;
  DateCreated?: string;
  CityRecipient?: string;
  WarehouseRecipient?: string;
  ScheduledDeliveryDate?: string;
}

interface NovaPoshtaResponse {
  success: boolean;
  data: NovaPoshtaTrackingData[];
  errors: string[];
}

function mapNovaPoshtaStatus(statusCode: number): TrackingStatus {
  if (statusCode === 1) return 'pending';
  if (statusCode === 2) return 'exception';
  if (statusCode === 3) return 'unknown';
  if (statusCode >= 4 && statusCode <= 8) return 'in_transit';
  if (statusCode >= 9 && statusCode <= 12) return 'delivered';
  if (statusCode === 41) return 'in_transit';
  if (statusCode === 101) return 'out_for_delivery';
  if (statusCode === 102 || statusCode === 103) return 'exception';
  if (statusCode === 104) return 'in_transit';
  if (statusCode === 105 || statusCode === 106) return 'exception';
  if (statusCode === 111) return 'exception';
  if (statusCode === 112) return 'in_transit';
  return 'unknown';
}

export function createNovaPoshtaCarrier(config: NovaPoshtaConfig): Carrier {
  return {
    code: 'nova_poshta',
    name: 'Nova Poshta',

    async track(trackingNumber: string): Promise<TrackingResult> {
      if (!trackingNumber || trackingNumber.length > 50) {
        throw new Error(`Invalid Nova Poshta tracking number: ${trackingNumber}`);
      }

      const res = await fetch(NOVA_POSHTA_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiKey: config.apiKey,
          modelName: 'TrackingDocument',
          calledMethod: 'getStatusDocuments',
          methodProperties: {
            Documents: [{ DocumentNumber: trackingNumber }],
          },
        }),
      });

      if (!res.ok) {
        throw new Error(`Nova Poshta API request failed: ${res.status}`);
      }

      const data: NovaPoshtaResponse = await res.json();

      if (!data.success) {
        throw new Error(`Nova Poshta API error: ${data.errors.join(', ') || 'unknown error'}`);
      }

      const tracking = data.data[0];
      if (!tracking) {
        throw new Error(`No tracking data found for ${trackingNumber}`);
      }

      const statusCode = tracking.StatusCode ?? 0;
      const status = mapNovaPoshtaStatus(statusCode);
      const timestamp = tracking.TrackingUpdateDate || tracking.DateScan || tracking.DateCreated || '';
      const location = [tracking.CityRecipient, tracking.WarehouseRecipient]
        .filter(Boolean)
        .join(', ');

      return {
        carrier: 'nova_poshta',
        trackingNumber,
        status,
        estimatedDelivery: tracking.ScheduledDeliveryDate || null,
        events: [
          {
            timestamp,
            status,
            location,
            description: tracking.Status ?? '',
          },
        ],
      };
    },
  };
}
