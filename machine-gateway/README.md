# Ironvale Universal CNC Gateway

This edge service sits on the factory LAN and sends normalized machine data to IDMS. It is designed so the IDMS UI does not care which CNC controller is used.

## Supported connection styles

- `mtconnect` — recommended when the machine/controller exposes an MTConnect Agent.
- `http-json` — for a vendor gateway or PLC that exposes JSON over HTTP.
- `modbus-tcp` — for PLC/IO based machine signals where register mapping is available.
- `simulator` — for testing the IDMS dashboard before connecting a real machine.

For FANUC, use an MTConnect Agent where available, or a FANUC FOCAS/FOCAS2 based edge collector supplied/installed on the Windows machine connected to the controller. The gateway only needs the normalized JSON output; the cloud IDMS never needs direct access to the CNC LAN.

## Quick start

1. Copy `config.example.json` to `config.json`.
2. Put the gateway PC on the same factory LAN as the CNC machines.
3. Set `idmsIngestUrl` to your deployed IDMS `/api/cnc` endpoint and set a strong `machineGatewayKey`.
4. Add each machine with the correct adapter and address.
5. Run:

```bash
node gateway.mjs
```

The gateway polls machines locally and pushes only small normalized state/event payloads to IDMS.

## Normalized data

Each machine can report:

- connection / online state
- machine mode and status
- program name/number
- part count
- good/reject count when available
- cycle start/end and actual cycle time
- alarm code/text
- tool number and tool life/count when available
- spindle/load/optional feed data

Tool life in IDMS is calculated from part count against the tool-life standard configured for the part/operation/tool. The gateway does not write fake tool-life values when the controller does not expose them.
