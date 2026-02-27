# delivery-cdk

Delivery tracking CDK — track packages across multiple carriers via a unified API.

## Supported carriers

- **FedEx** — via FedEx Track API v1

## Quick start

```bash
cp .env.example .env
# fill in your FedEx API credentials

npm install
npm run dev
```

## API

| Endpoint | Description |
|---|---|
| `GET /` | Service info + registered carriers |
| `GET /carriers` | List registered carriers |
| `GET /track/:carrier/:trackingNumber` | Track a package |

### Example

```bash
curl http://localhost:3000/track/fedex/123456789012
```
