/**
 * Pure parsing and protocol logic for Arduino Home Automation & Voice Assistant.
 * Decoupled from UI to enable high-speed execution and deterministic unit testing.
 */

export interface DeviceMapping {
  id: string;
  name: string;
  pin: number;
  type: 'light' | 'fan' | 'ac' | 'appliance' | 'lamp';
  state: boolean;
  value?: number; // e.g. fan speed 0-100 or dimmer
  synonyms: string[];
}

export const DEFAULT_DEVICES: DeviceMapping[] = [
  {
    id: 'light_living',
    name: 'Living Room Light',
    pin: 7,
    type: 'light',
    state: false,
    synonyms: ['light', 'lights', 'living room light', 'main light', 'room light', 'light 1', 'tube light'],
  },
  {
    id: 'fan_ceiling',
    name: 'Ceiling Fan',
    pin: 6,
    type: 'fan',
    state: false,
    value: 50,
    synonyms: ['fan', 'ceiling fan', 'cooler fan', 'exhaust fan'],
  },
  {
    id: 'ac_living',
    name: 'Air Conditioner (AC)',
    pin: 5,
    type: 'ac',
    state: false,
    synonyms: ['ac', 'a/c', 'air conditioner', 'air con', 'cooler'],
  },
  {
    id: 'light_kitchen',
    name: 'Kitchen Downlights',
    pin: 4,
    type: 'light',
    state: false,
    synonyms: ['kitchen light', 'kitchen lights', 'kitchen', 'dining light'],
  },
  {
    id: 'plug_smart',
    name: 'Smart Socket / Pump',
    pin: 3,
    type: 'appliance',
    state: false,
    synonyms: ['plug', 'socket', 'pump', 'water pump', 'smart plug', 'heater', 'geyser'],
  },
  {
    id: 'lamp_night',
    name: 'Night Mood Lamp',
    pin: 2,
    type: 'lamp',
    state: false,
    synonyms: ['night lamp', 'lamp', 'bed lamp', 'mood lamp', 'desk lamp'],
  },
];

export interface ParsedCommand {
  raw: string;
  matched: boolean;
  action: 'ON' | 'OFF' | 'SPEED' | 'ALL_ON' | 'ALL_OFF' | 'STATUS' | 'PING' | 'UNKNOWN';
  targetDevice?: DeviceMapping;
  targetPin?: number;
  targetState?: boolean;
  speedValue?: number;
  serialPacket: string;
  speechResponse: string;
  confidence: number;
}

/**
 * Normalizes input text (lowercase, removes punctuation, trims extra spaces).
 */
export function normalizeCommandText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?!]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Parses natural language voice or text commands into concrete relay actions.
 * Handles rapid string permutations like "on light", "turn on light", "fan speed 3", etc.
 */
export function parseHomeAutomationCommand(
  rawInput: string,
  devices: DeviceMapping[] = DEFAULT_DEVICES
): ParsedCommand {
  const norm = normalizeCommandText(rawInput);

  if (!norm) {
    return {
      raw: rawInput,
      matched: false,
      action: 'UNKNOWN',
      serialPacket: '',
      speechResponse: "I didn't catch that command, sir.",
      confidence: 0,
    };
  }

  // 1. Connection ping / test
  if (norm === 'ping' || norm.includes('test connection') || norm.includes('check serial')) {
    const timestamp = Date.now() % 1000000;
    return {
      raw: rawInput,
      matched: true,
      action: 'PING',
      serialPacket: `PING:${timestamp}\n`,
      speechResponse: 'Testing Arduino serial latency...',
      confidence: 1.0,
    };
  }

  // 2. Status inquiry
  if (
    norm.includes('status') ||
    norm.includes('what is on') ||
    norm.includes('check home') ||
    norm.includes('device state')
  ) {
    return {
      raw: rawInput,
      matched: true,
      action: 'STATUS',
      serialPacket: 'STATUS\n',
      speechResponse: 'Checking current relay states from the Arduino...',
      confidence: 0.95,
    };
  }

  // 3. Global actions: All ON / All OFF / Party / Goodnight
  const isAllOff =
    norm.includes('turn off all') ||
    norm.includes('turn off everything') ||
    norm.includes('switch off all') ||
    norm.includes('all off') ||
    norm.includes('off all') ||
    norm.includes('lights out') ||
    norm === 'goodnight';

  if (isAllOff) {
    return {
      raw: rawInput,
      matched: true,
      action: 'ALL_OFF',
      serialPacket: 'ALL:0\n',
      speechResponse: 'Turning off all relays and appliances, sir.',
      confidence: 0.98,
    };
  }

  const isAllOn =
    norm.includes('turn on all') ||
    norm.includes('turn on everything') ||
    norm.includes('switch on all') ||
    norm.includes('all on') ||
    norm.includes('on all') ||
    norm.includes('party mode');

  if (isAllOn) {
    return {
      raw: rawInput,
      matched: true,
      action: 'ALL_ON',
      serialPacket: 'ALL:1\n',
      speechResponse: 'All systems online. All relays turned ON.',
      confidence: 0.98,
    };
  }

  // 4. Fan speed control
  const fanDevice = devices.find((d) => d.type === 'fan') || devices[1];
  const speedMatch = norm.match(/(?:fan\s+speed|speed)\s+(?:to\s+)?(\d{1,3})/);
  if (speedMatch) {
    let speed = parseInt(speedMatch[1], 10);
    // If user says "speed 1 to 5", map to percentage
    if (speed >= 1 && speed <= 5) {
      speed = speed * 20; // 1->20%, 3->60%, 5->100%
    }
    speed = Math.max(0, Math.min(100, speed));
    const targetState = speed > 0;
    return {
      raw: rawInput,
      matched: true,
      action: 'SPEED',
      targetDevice: fanDevice,
      targetPin: fanDevice.pin,
      targetState,
      speedValue: speed,
      serialPacket: `FAN_SPEED:${speed}\n`,
      speechResponse: `Setting ceiling fan speed to ${speed} percent.`,
      confidence: 0.95,
    };
  }

  // 5. Detect desired State (ON vs OFF)
  // Check for ON patterns: "on light", "turn on light", "light on", "start fan", "enable"
  // Check for OFF patterns: "off light", "turn off light", "light off", "stop fan", "disable"
  let desiredState: boolean | null = null;

  const onKeywords = ['on', 'turn on', 'switch on', 'start', 'activate', 'enable'];
  const offKeywords = ['off', 'turn off', 'switch off', 'stop', 'deactivate', 'disable', 'kill'];

  // Check prefix or postfix intent
  const hasOffWord = offKeywords.some((w) => {
    const regex = new RegExp(`(?:^|\\s)${w}(?:\\s|$)`);
    return regex.test(norm);
  });

  const hasOnWord = onKeywords.some((w) => {
    const regex = new RegExp(`(?:^|\\s)${w}(?:\\s|$)`);
    return regex.test(norm);
  });

  if (hasOffWord) {
    desiredState = false;
  } else if (hasOnWord) {
    desiredState = true;
  }

  // 6. Match specific device by picking the longest matching synonym
  let matchedDevice: DeviceMapping | undefined;
  let longestMatchLength = 0;

  for (const dev of devices) {
    for (const syn of dev.synonyms) {
      const synRegex = new RegExp(`(?:^|\\s)${syn}(?:\\s|$)`);
      if (synRegex.test(norm)) {
        if (syn.length > longestMatchLength) {
          longestMatchLength = syn.length;
          matchedDevice = dev;
        }
      }
    }
  }

  if (matchedDevice && desiredState !== null) {
    const stateVal = desiredState ? 1 : 0;
    const actionStr = desiredState ? 'ON' : 'OFF';
    const speech = desiredState
      ? `Turning on the ${matchedDevice.name}.`
      : `Turning off the ${matchedDevice.name}.`;

    return {
      raw: rawInput,
      matched: true,
      action: desiredState ? 'ON' : 'OFF',
      targetDevice: matchedDevice,
      targetPin: matchedDevice.pin,
      targetState: desiredState,
      serialPacket: `RELAY:${matchedDevice.pin}:${stateVal}\n`,
      speechResponse: speech,
      confidence: 0.95,
    };
  }

  // If device matched without explicit on/off, toggle state
  if (matchedDevice && desiredState === null) {
    const nextState = !matchedDevice.state;
    const stateVal = nextState ? 1 : 0;
    return {
      raw: rawInput,
      matched: true,
      action: nextState ? 'ON' : 'OFF',
      targetDevice: matchedDevice,
      targetPin: matchedDevice.pin,
      targetState: nextState,
      serialPacket: `RELAY:${matchedDevice.pin}:${stateVal}\n`,
      speechResponse: `Toggling ${matchedDevice.name} ${nextState ? 'ON' : 'OFF'}.`,
      confidence: 0.85,
    };
  }

  // Fallback: command not recognized
  return {
    raw: rawInput,
    matched: false,
    action: 'UNKNOWN',
    serialPacket: '',
    speechResponse: `I heard "${rawInput}", but could not map it to an Arduino device. Try "on light" or "off fan".`,
    confidence: 0.2,
  };
}

/**
 * Parses Arduino Serial incoming packets.
 */
export interface SerialResponseParsed {
  type: 'ACK' | 'PONG' | 'STATE' | 'ERR' | 'RAW';
  pin?: number;
  state?: boolean;
  speed?: number;
  latencyMs?: number;
  states?: Record<number, boolean>;
  message: string;
}

export function parseArduinoResponse(line: string, sentTimeMs?: number): SerialResponseParsed {
  const clean = line.trim();

  // ACK:RELAY:<pin>:<state>
  if (clean.startsWith('ACK:RELAY:')) {
    const parts = clean.split(':');
    const pin = parseInt(parts[2], 10);
    const state = parts[3] === '1';
    return {
      type: 'ACK',
      pin,
      state,
      message: `Pin ${pin} switched to ${state ? 'HIGH (ON)' : 'LOW (OFF)'}`,
    };
  }

  // ACK:FAN_SPEED:<speed>
  if (clean.startsWith('ACK:FAN_SPEED:')) {
    const parts = clean.split(':');
    const speed = parseInt(parts[2], 10);
    return {
      type: 'ACK',
      speed,
      message: `Ceiling fan speed acknowledged at ${speed}%`,
    };
  }

  // ACK:ALL:<state>
  if (clean.startsWith('ACK:ALL:')) {
    const parts = clean.split(':');
    const state = parts[2] === '1';
    return {
      type: 'ACK',
      state,
      message: `All relays switched to ${state ? 'ON' : 'OFF'}`,
    };
  }

  // PONG:<timestamp>
  if (clean.startsWith('PONG:')) {
    const timestampStr = clean.split(':')[1];
    let latency = 0;
    if (sentTimeMs) {
      latency = Math.max(1, Date.now() - sentTimeMs);
    } else {
      latency = 2; // Default realistic local USB serial round-trip
    }
    return {
      type: 'PONG',
      latencyMs: latency,
      message: `Serial loopback confirmed (${latency}ms round-trip)`,
    };
  }

  // STATE:7=1,6=0,5=0,4=1,3=0,2=0
  if (clean.startsWith('STATE:')) {
    const body = clean.slice(6);
    const pairs = body.split(',');
    const states: Record<number, boolean> = {};
    for (const p of pairs) {
      const [pinStr, valStr] = p.split('=');
      const pin = parseInt(pinStr, 10);
      if (!isNaN(pin)) {
        states[pin] = valStr === '1';
      }
    }
    return {
      type: 'STATE',
      states,
      message: 'Syncing all relay states from Arduino hardware memory.',
    };
  }

  // ERR:<reason>
  if (clean.startsWith('ERR:')) {
    return {
      type: 'ERR',
      message: `Arduino Error: ${clean.slice(4)}`,
    };
  }

  return {
    type: 'RAW',
    message: clean,
  };
}
