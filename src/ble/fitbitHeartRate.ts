import {
  HeartRateSample,
  HeartRateSourceType,
  HeartRateStatus,
} from '../shared/types';
import {
  BLE_HEART_RATE_MEASUREMENT_CHAR_UUID,
  BLE_HEART_RATE_SERVICE_UUID,
  parseHeartRateMeasurement,
} from './heartRateParser';

// Minimal Web Bluetooth structural interfaces so TypeScript compiles without extra global libs
interface BleCharacteristic extends EventTarget {
  value?: DataView;
  startNotifications(): Promise<BleCharacteristic>;
  stopNotifications(): Promise<BleCharacteristic>;
}

interface BleService {
  getCharacteristic(uuid: number): Promise<BleCharacteristic>;
}

interface BleGattServer {
  connected: boolean;
  connect(): Promise<BleGattServer>;
  disconnect(): void;
  getPrimaryService(uuid: number): Promise<BleService>;
}

interface BleDevice extends EventTarget {
  name?: string;
  gatt?: BleGattServer;
}

interface NavigatorWithBluetooth extends Navigator {
  bluetooth?: {
    requestDevice(options: {
      filters: Array<{ services: number[] }>;
      optionalServices?: string[];
    }): Promise<BleDevice>;
  };
}

export interface MatchHeartRateSummary {
  sampleCount: number;
  averageBpm: number | null;
  peakBpm: number | null;
  isDemo: boolean;
}

export interface HeartRateManagerState {
  status: HeartRateStatus;
  source: HeartRateSourceType;
  deviceName: string | null;
  currentBpm: number | null;
  isDemo: boolean;
  statusDetail: string;
}

const STALE_TIMEOUT_MS = 6500;

export class FitbitHeartRateManager {
  private status: HeartRateStatus = 'idle';
  private source: HeartRateSourceType = 'none';
  private deviceName: string | null = null;
  private currentBpm: number | null = null;
  private statusDetail = 'Not connected';

  private device: BleDevice | null = null;
  private characteristic: BleCharacteristic | null = null;
  private lastSampleAtMs = 0;
  private staleWatchdogId: number | null = null;

  // Demo heart rate generator state
  private demoIntervalId: number | null = null;
  private demoExertion = 0;
  private demoFloatBpm = 82;

  // Match recording state
  private recordingMatch = false;
  private matchSamples: HeartRateSample[] = [];

  private onUpdate?: (state: HeartRateManagerState) => void;

  private boundOnCharacteristicChanged = (ev: Event) => {
    const target = ev.target as BleCharacteristic | null;
    if (!target?.value) return;
    const now = Date.now();
    const parsed = parseHeartRateMeasurement(target.value, now);
    if (!parsed) return;

    this.lastSampleAtMs = now;
    this.currentBpm = parsed.bpm;
    if (this.status !== 'connected') {
      this.status = 'connected';
    }
    this.statusDetail = parsed.sensorContactDetected
      ? `Live BLE (${this.deviceName || 'Fitbit Air'})`
      : 'Sensor contact weak';

    if (this.recordingMatch) {
      this.matchSamples.push(parsed);
    }
    this.notify();
  };

  private boundOnDisconnected = () => {
    this.cleanupBleListeners(false);
    this.currentBpm = null;
    this.status = 'disconnected';
    this.source = 'none';
    this.statusDetail = 'Fitbit Air disconnected — match continues';
    this.notify();
  };

  constructor(onUpdate?: (state: HeartRateManagerState) => void) {
    this.onUpdate = onUpdate;
    if (!this.isWebBluetoothSupported()) {
      this.status = 'unsupported';
      this.statusDetail =
        'Web Bluetooth requires Chrome or Edge on localhost or HTTPS.';
    }
  }

  public isWebBluetoothSupported(): boolean {
    if (typeof window === 'undefined' || typeof navigator === 'undefined') {
      return false;
    }
    const nav = navigator as NavigatorWithBluetooth;
    return Boolean(window.isSecureContext && nav.bluetooth?.requestDevice);
  }

  public async connectFitbitAir(): Promise<boolean> {
    this.stopDemoMode(false);
    this.cleanupBleListeners(false);

    if (!this.isWebBluetoothSupported()) {
      this.status = 'unsupported';
      this.statusDetail =
        'Unsupported browser. Open in desktop Chrome or Edge on localhost.';
      this.notify();
      return false;
    }

    const nav = navigator as NavigatorWithBluetooth;
    this.status = 'pairing';
    this.source = 'fitbit_ble';
    this.statusDetail = 'Select your Fitbit Air in the browser pairing prompt...';
    this.notify();

    try {
      const device = await nav.bluetooth!.requestDevice({
        filters: [{ services: [BLE_HEART_RATE_SERVICE_UUID] }],
      });

      this.device = device;
      this.deviceName = device.name || 'Fitbit Air';
      device.addEventListener(
        'gattserverdisconnected',
        this.boundOnDisconnected
      );

      if (!device.gatt) {
        throw new Error('Selected BLE device does not expose a GATT server.');
      }

      this.statusDetail = `Connecting to ${this.deviceName}...`;
      this.notify();

      const server = await device.gatt.connect();
      const service = await server.getPrimaryService(
        BLE_HEART_RATE_SERVICE_UUID
      );
      const characteristic = await service.getCharacteristic(
        BLE_HEART_RATE_MEASUREMENT_CHAR_UUID
      );

      this.characteristic = characteristic;
      characteristic.addEventListener(
        'characteristicvaluechanged',
        this.boundOnCharacteristicChanged
      );
      await characteristic.startNotifications();

      this.lastSampleAtMs = Date.now();
      this.status = 'connected';
      this.source = 'fitbit_ble';
      this.statusDetail = `Connected to ${this.deviceName} — awaiting first pulse...`;
      this.startStaleWatchdog();
      this.notify();
      return true;
    } catch (err) {
      this.cleanupBleListeners(false);
      const domErr = err as DOMException;
      if (domErr?.name === 'NotFoundError') {
        this.status = 'idle';
        this.source = 'none';
        this.statusDetail = 'Pairing canceled.';
      } else {
        this.status = 'disconnected';
        this.source = 'none';
        this.statusDetail = `Pairing failed: ${domErr?.message || 'Unable to connect'}`;
      }
      this.notify();
      return false;
    }
  }

  public startDemoMode(): void {
    this.cleanupBleListeners(false);
    this.stopDemoMode(false);

    this.source = 'demo';
    this.status = 'connected';
    this.deviceName = 'Simulated Sensor (Demo data)';
    this.demoFloatBpm = 84;
    this.demoExertion = 0.1;
    this.currentBpm = 84;
    this.statusDetail = 'Demo data — simulated heart rate active';
    this.notify();

    this.demoIntervalId = window.setInterval(() => {
      // Decay exertion gradually and approach target simulated BPM
      this.demoExertion = Math.max(0.05, this.demoExertion * 0.91);
      const targetBpm = 78 + this.demoExertion * 82 + (Math.random() - 0.5) * 4;
      this.demoFloatBpm += (targetBpm - this.demoFloatBpm) * 0.28;
      const bpm = Math.round(Math.max(65, Math.min(176, this.demoFloatBpm)));
      this.currentBpm = bpm;

      if (this.recordingMatch) {
        this.matchSamples.push({
          bpm,
          is16Bit: false,
          sensorContactSupported: false,
          sensorContactDetected: true,
          timestampMs: Date.now(),
          isDemo: true,
        });
      }
      this.notify();
    }, 1000);
  }

  public notifyExertion(amount: number): void {
    if (this.source === 'demo') {
      this.demoExertion = Math.min(1, this.demoExertion + amount);
    }
  }

  public disconnect(): void {
    this.stopDemoMode(false);
    this.cleanupBleListeners(true);
    this.currentBpm = null;
    this.source = 'none';
    this.deviceName = null;
    this.status = this.isWebBluetoothSupported() ? 'idle' : 'unsupported';
    this.statusDetail = this.isWebBluetoothSupported()
      ? 'Disconnected'
      : 'Web Bluetooth requires Chrome or Edge on localhost.';
    this.notify();
  }

  public beginMatchRecording(): void {
    this.matchSamples = [];
    this.recordingMatch = true;
    // Capture immediate sample if already live
    if (this.status === 'connected' && this.currentBpm !== null) {
      this.matchSamples.push({
        bpm: this.currentBpm,
        is16Bit: false,
        sensorContactSupported: false,
        sensorContactDetected: true,
        timestampMs: Date.now(),
        isDemo: this.source === 'demo',
      });
    }
  }

  public endMatchRecording(): MatchHeartRateSummary {
    this.recordingMatch = false;
    return this.getMatchSummary();
  }

  public getMatchSamples(): readonly HeartRateSample[] {
    return this.matchSamples;
  }

  public getMatchSummary(): MatchHeartRateSummary {
    if (this.matchSamples.length === 0) {
      return {
        sampleCount: 0,
        averageBpm: null,
        peakBpm: null,
        isDemo: this.source === 'demo',
      };
    }

    let sum = 0;
    let peak = 0;
    let anyDemo = false;
    for (const s of this.matchSamples) {
      sum += s.bpm;
      if (s.bpm > peak) peak = s.bpm;
      if (s.isDemo) anyDemo = true;
    }

    return {
      sampleCount: this.matchSamples.length,
      averageBpm: Math.round(sum / this.matchSamples.length),
      peakBpm: peak,
      isDemo: anyDemo,
    };
  }

  public getState(): HeartRateManagerState {
    return {
      status: this.status,
      source: this.source,
      deviceName: this.deviceName,
      currentBpm: this.currentBpm,
      isDemo: this.source === 'demo',
      statusDetail: this.statusDetail,
    };
  }

  private startStaleWatchdog(): void {
    this.stopStaleWatchdog();
    this.staleWatchdogId = window.setInterval(() => {
      if (this.source !== 'fitbit_ble') return;
      if (
        this.status === 'connected' &&
        Date.now() - this.lastSampleAtMs > STALE_TIMEOUT_MS
      ) {
        this.status = 'stale';
        this.statusDetail =
          'Stale HR signal — ensure Share heart rate stays active on phone.';
        this.notify();
      }
    }, 1000);
  }

  private stopStaleWatchdog(): void {
    if (this.staleWatchdogId !== null) {
      window.clearInterval(this.staleWatchdogId);
      this.staleWatchdogId = null;
    }
  }

  private stopDemoMode(emit: boolean): void {
    if (this.demoIntervalId !== null) {
      window.clearInterval(this.demoIntervalId);
      this.demoIntervalId = null;
    }
    if (emit) this.notify();
  }

  private cleanupBleListeners(disconnectGatt: boolean): void {
    this.stopStaleWatchdog();

    if (this.characteristic) {
      this.characteristic.removeEventListener(
        'characteristicvaluechanged',
        this.boundOnCharacteristicChanged
      );
      void this.characteristic.stopNotifications().catch(() => {});
      this.characteristic = null;
    }

    if (this.device) {
      this.device.removeEventListener(
        'gattserverdisconnected',
        this.boundOnDisconnected
      );
      if (disconnectGatt && this.device.gatt?.connected) {
        try {
          this.device.gatt.disconnect();
        } catch {
          // Ignore disconnect errors
        }
      }
      this.device = null;
    }
  }

  private notify(): void {
    this.onUpdate?.(this.getState());
  }
}
