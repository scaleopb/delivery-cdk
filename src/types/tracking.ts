export type CarrierCode = 'fedex' | 'ups' | 'dhl' | 'usps' | 'nova_poshta';

export type TrackingStatus =
  | 'pending'
  | 'picked_up'
  | 'in_transit'
  | 'out_for_delivery'
  | 'delivered'
  | 'exception'
  | 'unknown';

export interface TrackingEvent {
  timestamp: string;
  status: TrackingStatus;
  location: string;
  description: string;
}

export interface TrackingResult {
  carrier: CarrierCode;
  trackingNumber: string;
  status: TrackingStatus;
  estimatedDelivery: string | null;
  events: TrackingEvent[];
}

export interface Carrier {
  code: CarrierCode;
  name: string;
  track(trackingNumber: string): Promise<TrackingResult>;
}
