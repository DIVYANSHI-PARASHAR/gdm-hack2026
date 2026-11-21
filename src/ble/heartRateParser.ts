import { HeartRateSample } from '../shared/types';

export const BLE_HEART_RATE_SERVICE_UUID = 0x180d;
export const BLE_HEART_RATE_MEASUREMENT_CHAR_UUID = 0x2a37;

/**
 * Parses a standard Bluetooth Low Energy Heart Rate Measurement (0x2A37) packet.
 * Handles both 8-bit (UINT8) and 16-bit (UINT16 little-endian) BPM formats via flags bit 0,
 * as well as Sensor Contact status bits (bits 1-2).
 */
export function parseHeartRateMeasurement(
  data: DataView,
  timestampMs: number = Date.now()
): HeartRateSample | null {
  if (!data || data.byteLength < 2) {
    return null;
  }

  const flags = data.getUint8(0);
  const is16Bit = (flags & 0x01) === 0x01;

  let bpm: number;
  if (is16Bit) {
    if (data.byteLength < 3) {
      return null;
    }
    bpm = data.getUint16(1, true);
  } else {
    bpm = data.getUint8(1);
  }

  if (!Number.isFinite(bpm) || bpm <= 0 || bpm > 260) {
    return null;
  }

  const contactBits = (flags >> 1) & 0x03;
  const sensorContactSupported = contactBits === 0x02 || contactBits === 0x03;
  const sensorContactDetected = sensorContactSupported
    ? contactBits === 0x03
    : true;

  return {
    bpm,
    is16Bit,
    sensorContactSupported,
    sensorContactDetected,
    timestampMs,
    isDemo: false,
  };
}
