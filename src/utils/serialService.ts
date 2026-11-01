/**
 * Serial Service for Arduino Home Automation.
 * Supports:
 * 1. Physical Arduino connection via Web Serial API (Chrome / Edge)
 * 2. High-fidelity virtual Arduino simulation engine (realistic ACK, PONG, roundtrip latency)
 */

import { parseArduinoResponse, SerialResponseParsed } from './homeAutomationParser';
import { audioFX } from './audioFX';

export interface SerialLogEntry {
  id: string;
  timestamp: string;
  direction: 'TX' | 'RX' | 'SYS' | 'ERR';
  text: string;
  latencyMs?: number;
}

export type LogListener = (entry: SerialLogEntry) => void;
export type StateListener = (pin: number, state: boolean, speed?: number) => void;
export type ConnectionListener = (connected: boolean, mode: 'hardware' | 'simulated' | 'disconnected', portName: string) => void;

class SerialCommunicationService {
  private port: any = null;
  private reader: any = null;
  private writer: any = null;
  private isConnected: boolean = false;
  private mode: 'hardware' | 'simulated' | 'disconnected' = 'disconnected';
  private portName: string = '';

  private logListeners: Set<LogListener> = new Set();
  private stateListeners: Set<StateListener> = new Set();
  private connectionListeners: Set<ConnectionListener> = new Set();
  private logHistory: SerialLogEntry[] = [];

  // Internal simulated Arduino states
  private simStates: Record<number, boolean> = {
    7: false, // Living Room Light
    6: false, // Fan
    5: false, // AC
    4: false, // Kitchen
    3: false, // Plug
    2: false, // Night Lamp
  };
  private simFanSpeed: number = 0;
  private lastPingSentTime: number = 0;
  public lastSerialRtt: number = 2.1; // Default realistic local USB RTT in ms

  constructor() {
    // Auto-connect to high-fidelity simulation on boot
    this.startSimulation();
  }

  public getLogHistory(): SerialLogEntry[] {
    return [...this.logHistory];
  }

  public subscribeLog(listener: LogListener): () => void {
    this.logListeners.add(listener);
    // Send existing history to new listener
    this.logHistory.forEach((entry) => listener(entry));
    return () => this.logListeners.delete(listener);
  }

  public subscribeState(listener: StateListener): () => void {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  public subscribeConnection(listener: ConnectionListener): () => void {
    this.connectionListeners.add(listener);
    listener(this.isConnected, this.mode, this.portName);
    return () => this.connectionListeners.delete(listener);
  }

  private notifyLog(direction: 'TX' | 'RX' | 'SYS' | 'ERR', text: string, latencyMs?: number) {
    const entry: SerialLogEntry = {
      id: Math.random().toString(36).substring(2, 9),
      timestamp: new Date().toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }) + '.' + String(Date.now() % 1000).padStart(3, '0'),
      direction,
      text,
      latencyMs,
    };
    this.logHistory.push(entry);
    if (this.logHistory.length > 300) this.logHistory.shift();
    this.logListeners.forEach((fn) => fn(entry));
  }

  private notifyConnection() {
    this.connectionListeners.forEach((fn) => fn(this.isConnected, this.mode, this.portName));
  }

  public startSimulation() {
    this.mode = 'simulated';
    this.isConnected = true;
    this.portName = 'Virtual COM3 (Simulated Arduino Uno @ 115200)';
    this.notifyConnection();
    this.notifyLog('SYS', 'Virtual Arduino bridge initialized at 115200 baud.');
    this.notifyLog('RX', 'READY:JARVIS_ARDUINO_V2.0');
  }

  /**
   * Connect to physical Arduino board using Web Serial API.
   */
  public async connectHardware(): Promise<{ success: boolean; message: string }> {
    if (!('serial' in navigator)) {
      this.notifyLog('ERR', 'Web Serial API not supported by this browser. Use Chrome or Edge, or enjoy the simulation mode.');
      return {
        success: false,
        message: 'Web Serial is not supported in this browser. Please use Google Chrome or Microsoft Edge.',
      };
    }

    try {
      this.notifyLog('SYS', 'Prompting user to select Arduino USB COM port...');
      const serialNav = (navigator as unknown as { serial: any }).serial;
      this.port = await serialNav.requestPort();

      await this.port.open({ baudRate: 115200 });
      this.isConnected = true;
      this.mode = 'hardware';
      const info = this.port.getInfo ? this.port.getInfo() : {};
      this.portName = `USB Serial (VID: ${info.usbVendorId?.toString(16) || '2341'}, PID: ${info.usbProductId?.toString(16) || '0043'})`;

      this.notifyConnection();
      this.notifyLog('SYS', `Connected to physical Arduino on ${this.portName} at 115200 baud!`);

      // Start read loop
      this.startHardwareReadLoop();

      // Handshake
      await this.sendPacket('STATUS\n');
      this.measurePing();

      return { success: true, message: `Connected to ${this.portName}` };
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      this.notifyLog('ERR', `Failed to open Arduino port: ${errMsg}`);
      return { success: false, message: errMsg };
    }
  }

  public async disconnect() {
    if (this.mode === 'hardware' && this.port) {
      try {
        if (this.reader) await this.reader.cancel();
        if (this.writer) await this.writer.close();
        await this.port.close();
      } catch {}
    }
    this.port = null;
    this.isConnected = false;
    this.mode = 'disconnected';
    this.portName = '';
    this.notifyConnection();
    this.notifyLog('SYS', 'Serial connection terminated.');
  }

  private async startHardwareReadLoop() {
    while (this.port && this.port.readable && this.isConnected) {
      try {
        const textDecoder = new TextDecoderStream();
        const readableStreamClosed = this.port.readable.pipeTo(textDecoder.writable);
        this.reader = textDecoder.readable.getReader();

        let buffer = '';
        while (true) {
          const { value, done } = await this.reader.read();
          if (done) break;
          if (value) {
            buffer += value;
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';
            for (const line of lines) {
              const clean = line.trim();
              if (clean) this.handleIncomingLine(clean);
            }
          }
        }
      } catch (err) {
        this.notifyLog('ERR', `Serial read error: ${err}`);
        break;
      }
    }
  }

  public async sendPacket(packet: string): Promise<boolean> {
    const cleanPacket = packet.endsWith('\n') ? packet : packet + '\n';
    this.notifyLog('TX', cleanPacket.trim());

    if (cleanPacket.startsWith('PING')) {
      this.lastPingSentTime = performance.now();
    }

    if (this.mode === 'hardware' && this.port && this.port.writable) {
      try {
        const textEncoder = new TextEncoderStream();
        const writableStreamClosed = textEncoder.readable.pipeTo(this.port.writable);
        const writer = textEncoder.writable.getWriter();
        await writer.write(cleanPacket);
        await writer.close();
        return true;
      } catch (err) {
        this.notifyLog('ERR', `Hardware TX error: ${err}`);
        return false;
      }
    }

    // Handle in Virtual Simulation
    if (this.mode === 'simulated') {
      this.simulateIncomingResponse(cleanPacket);
      return true;
    }

    return false;
  }

  /**
   * Simulates Arduino firmware execution with 1-3ms realistic round-trip latency.
   */
  private simulateIncomingResponse(outgoing: string) {
    const cmd = outgoing.trim();
    // Simulate realistic hardware latency (1.5 - 4ms)
    const simulatedDelay = Math.floor(Math.random() * 3) + 2;

    setTimeout(() => {
      // 1. RELAY:<pin>:<state>
      if (cmd.startsWith('RELAY:')) {
        const parts = cmd.split(':');
        const pin = parseInt(parts[1], 10);
        const state = parts[2] === '1';
        this.simStates[pin] = state;
        audioFX.playRelayClick(state);
        this.handleIncomingLine(`ACK:RELAY:${pin}:${state ? 1 : 0}`);
      }
      // 2. FAN_SPEED:<speed>
      else if (cmd.startsWith('FAN_SPEED:')) {
        const speed = parseInt(cmd.split(':')[1], 10);
        this.simFanSpeed = speed;
        this.simStates[6] = speed > 0;
        audioFX.playRelayClick(speed > 0);
        this.handleIncomingLine(`ACK:FAN_SPEED:${speed}`);
      }
      // 3. ALL:<state>
      else if (cmd.startsWith('ALL:')) {
        const state = cmd.split(':')[1] === '1';
        Object.keys(this.simStates).forEach((p) => {
          this.simStates[parseInt(p, 10)] = state;
        });
        if (!state) this.simFanSpeed = 0;
        audioFX.playRelayClick(state);
        this.handleIncomingLine(`ACK:ALL:${state ? 1 : 0}`);
      }
      // 4. STATUS
      else if (cmd.toUpperCase() === 'STATUS') {
        const stateStr = Object.entries(this.simStates)
          .map(([p, s]) => `${p}=${s ? 1 : 0}`)
          .join(',');
        this.handleIncomingLine(`STATE:${stateStr}`);
      }
      // 5. PING
      else if (cmd.startsWith('PING')) {
        this.handleIncomingLine(`PONG:${cmd.split(':')[1] || '0'}`);
      }
      // 6. RESET
      else if (cmd.toUpperCase() === 'RESET') {
        Object.keys(this.simStates).forEach((p) => {
          this.simStates[parseInt(p, 10)] = false;
        });
        this.simFanSpeed = 0;
        audioFX.playRelayClick(false);
        this.handleIncomingLine('ACK:RESET');
      } else {
        this.handleIncomingLine(`ERR:UNKNOWN_COMMAND:${cmd}`);
      }
    }, simulatedDelay);
  }

  private handleIncomingLine(line: string) {
    let rtt: number | undefined = undefined;

    if (line.startsWith('PONG')) {
      if (this.lastPingSentTime > 0) {
        this.lastSerialRtt = Math.max(1, Math.round((performance.now() - this.lastPingSentTime) * 10) / 10);
        rtt = this.lastSerialRtt;
        this.lastPingSentTime = 0;
      } else {
        this.lastSerialRtt = 2.1;
        rtt = 2.1;
      }
    }

    this.notifyLog('RX', line, rtt);

    const parsed: SerialResponseParsed = parseArduinoResponse(line);
    if (parsed.type === 'ACK') {
      if (parsed.pin !== undefined && parsed.state !== undefined) {
        this.stateListeners.forEach((fn) => fn(parsed.pin!, parsed.state!));
      } else if (parsed.speed !== undefined) {
        this.stateListeners.forEach((fn) => fn(6, parsed.speed! > 0, parsed.speed));
      } else if (parsed.state !== undefined) {
        // ALL
        [7, 6, 5, 4, 3, 2].forEach((pin) => {
          this.stateListeners.forEach((fn) => fn(pin, parsed.state!));
        });
      }
    } else if (parsed.type === 'STATE' && parsed.states) {
      Object.entries(parsed.states).forEach(([pinStr, state]) => {
        this.stateListeners.forEach((fn) => fn(parseInt(pinStr, 10), state));
      });
    }
  }

  public measurePing() {
    this.sendPacket(`PING:${Date.now() % 1000000}\n`);
  }

  public getMode() {
    return this.mode;
  }

  public getPortName() {
    return this.portName;
  }
}

export const serialService = new SerialCommunicationService();
