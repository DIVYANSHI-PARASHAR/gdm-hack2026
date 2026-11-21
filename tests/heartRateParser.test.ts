import { describe, expect, it } from 'vitest';
import { parseHeartRateMeasurement } from '../src/ble/heartRateParser';

function makeDataView(bytes: number[]): DataView {
  return new DataView(new Uint8Array(bytes).buffer);
}

describe('BLE Heart Rate Measurement (0x2A37) parser', () => {
  it('parses 8-bit UINT8 BPM values when flags bit 0 is 0', () => {
    // flags = 0x06 (8-bit, sensor contact supported & detected), BPM = 134
    const sample = parseHeartRateMeasurement(makeDataView([0x06, 134]), 5000);
    expect(sample).not.toBeNull();
    expect(sample?.bpm).toBe(134);
    expect(sample?.is16Bit).toBe(false);
    expect(sample?.sensorContactSupported).toBe(true);
    expect(sample?.sensorContactDetected).toBe(true);
    expect(sample?.isDemo).toBe(false);
  });

  it('parses 16-bit UINT16 little-endian BPM values when flags bit 0 is 1', () => {
    // flags = 0x01 (16-bit), little-endian 0x0102 = 258 -> wait: 258 <= 260! Let's test 195 (0x00C3 -> [0xC3, 0x00]) and 256 ([0x00, 0x01])
    const s195 = parseHeartRateMeasurement(makeDataView([0x01, 0xc3, 0x00]), 6000);
    expect(s195).not.toBeNull();
    expect(s195?.bpm).toBe(195);
    expect(s195?.is16Bit).toBe(true);

    const s256 = parseHeartRateMeasurement(makeDataView([0x01, 0x00, 0x01]), 6100);
    expect(s256).not.toBeNull();
    expect(s256?.bpm).toBe(256);
    expect(s256?.is16Bit).toBe(true);
  });

  it('detects sensor contact lost when flags bits 1-2 equal 0b10', () => {
    // flags = 0x04 (bits 1-2 = 0b10 -> supported, NOT detected)
    const sample = parseHeartRateMeasurement(makeDataView([0x04, 78]), 7000);
    expect(sample?.sensorContactSupported).toBe(true);
    expect(sample?.sensorContactDetected).toBe(false);
  });

  it('rejects truncated or out-of-range BLE packets gracefully', () => {
    expect(parseHeartRateMeasurement(makeDataView([]))).toBeNull();
    expect(parseHeartRateMeasurement(makeDataView([0x00]))).toBeNull();
    // 16-bit flag set but only 2 bytes present
    expect(parseHeartRateMeasurement(makeDataView([0x01, 0x80]))).toBeNull();
    // 0 BPM or > 260 BPM rejected
    expect(parseHeartRateMeasurement(makeDataView([0x00, 0]))).toBeNull();
    expect(parseHeartRateMeasurement(makeDataView([0x01, 0x2c, 0x01]))).toBeNull(); // 300 BPM
  });
});
