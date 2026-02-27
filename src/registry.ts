import type { Carrier, CarrierCode } from './types/tracking.js';

export class CarrierRegistry {
  private carriers = new Map<CarrierCode, Carrier>();

  register(carrier: Carrier): void {
    this.carriers.set(carrier.code, carrier);
  }

  get(code: CarrierCode): Carrier | undefined {
    return this.carriers.get(code);
  }

  list(): CarrierCode[] {
    return [...this.carriers.keys()];
  }
}
