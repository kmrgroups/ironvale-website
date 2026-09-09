# Ironvale IDMS — Universal CNC Monitoring Setup

## What you are getting

The IDMS now has a **Universal CNC Live Monitor** and a **factory-LAN edge gateway**. The IDMS dashboard uses one common data format, so changing the controller does not require redesigning the dashboard.

## Important architecture

Do NOT expose a CNC controller directly to the public internet.

Use:

CNC controller -> factory Ethernet -> Gateway PC -> HTTPS -> IDMS

The gateway should be installed on a Windows mini-PC/industrial PC on the same LAN/VLAN as the CNC machines.

## Controller strategy

1. FANUC: preferably expose data through an MTConnect Agent. If the FANUC installation only provides FOCAS/FOCAS2, install a FANUC FOCAS collector/bridge on the factory Windows PC and map its output to the gateway's normalized JSON adapter.
2. Siemens / Haas / Okuma / Mazak / Mitsubishi / other MTConnect-capable controllers: use the MTConnect adapter.
3. Controllers or PLCs with a JSON/HTTP gateway: use `http-json`.
4. PLC/IO signals available over Modbus TCP: add a Modbus adapter with the correct register map.
5. Any unsupported controller: create a small vendor adapter that outputs the same normalized fields. The IDMS UI and database do not change.

## IDMS deployment setting

Set a server environment variable:

`CNC_GATEWAY_KEY=<a long random secret>`

The gateway's `machineGatewayKey` must be exactly the same value.

The gateway posts to:

`https://YOUR-IDMS-DOMAIN/api/cnc/state`

## Gateway installation on Windows

Install Node.js LTS on the gateway PC.

Copy the `machine-gateway` folder to the PC.

Copy:

`config.example.json` -> `config.json`

Edit `config.json`.

Example:

```json
{
  "pollMs": 2000,
  "pushMs": 2000,
  "idmsIngestUrl": "https://your-domain.example/api/cnc",
  "machineGatewayKey": "same-secret-as-CNC_GATEWAY_KEY",
  "machines": [
    {
      "id": "CNC-01",
      "name": "FANUC CNC 01",
      "controller": "FANUC",
      "adapter": "mtconnect",
      "baseUrl": "http://192.168.1.101:5000",
      "devicePath": "/current",
      "idealCycleSec": 260,
      "toolLifeParts": 500
    }
  ]
}
```

Run:

`node gateway.mjs`

The gateway intentionally supports a `simulator` machine so the IDMS dashboard can be tested before connecting a real CNC.

## Production counting

The normalized `partCount` is the source of truth for completed parts. Each count change is recorded as `PART_COMPLETE` in `cnc_events`.

The IDMS can use:

`tool remaining parts = tool life limit - parts used`

For reliable manufacturing records, do not estimate a completed part merely from elapsed time. Prefer the controller's actual part counter or a proven cycle-complete signal.

## Ideal vs actual cycle

Configure the standard/ideal cycle per part and operation in IDMS. The gateway reports the machine's actual cycle where the controller exposes it. The dashboard shows the difference.

## Offline behaviour

If the gateway cannot reach a machine, it sends `OFFLINE` state. The IDMS does not treat an offline machine as producing parts.

## Before commissioning a real machine

Back up the database. Start with one CNC. Verify part count against the machine's own production counter for a complete shift. Then connect additional machines.
