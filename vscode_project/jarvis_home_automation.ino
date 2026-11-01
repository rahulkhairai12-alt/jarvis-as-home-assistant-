/*
  JARVIS HOME AUTOMATION - ARDUINO FIRMWARE V2.0
  Compatible with Arduino Uno / Nano / Mega / ESP32
  Baud: 115200
*/

#include <EEPROM.h>

const bool ACTIVE_LOW_RELAY = true; // True for standard active-LOW relay boards

const int RELAY_PINS[] = {7, 6, 5, 4, 3, 2};
const int NUM_RELAYS = sizeof(RELAY_PINS) / sizeof(RELAY_PINS[0]);
const int FAN_PWM_PIN = 9;

bool relayStates[NUM_RELAYS];
int currentFanSpeed = 0;
String inputString = "";
bool stringComplete = false;

void applyRelayState(int pin, bool turnOn) {
  if (ACTIVE_LOW_RELAY) {
    digitalWrite(pin, turnOn ? LOW : HIGH);
  } else {
    digitalWrite(pin, turnOn ? HIGH : LOW);
  }
}

int getRelayIndex(int pin) {
  for (int i = 0; i < NUM_RELAYS; i++) {
    if (RELAY_PINS[i] == pin) return i;
  }
  return -1;
}

void setup() {
  Serial.begin(115200);
  while (!Serial) { ; }
  inputString.reserve(64);

  for (int i = 0; i < NUM_RELAYS; i++) {
    pinMode(RELAY_PINS[i], OUTPUT);
    relayStates[i] = false;
    applyRelayState(RELAY_PINS[i], false);
  }

  pinMode(FAN_PWM_PIN, OUTPUT);
  analogWrite(FAN_PWM_PIN, 0);

  Serial.println("READY:JARVIS_ARDUINO_V2.0");
}

void loop() {
  while (Serial.available()) {
    char inChar = (char)Serial.read();
    if (inChar == '\n' || inChar == '\r') {
      if (inputString.length() > 0) {
        stringComplete = true;
      }
    } else {
      inputString += inChar;
    }
  }

  if (stringComplete) {
    processCommand(inputString);
    inputString = "";
    stringComplete = false;
  }
}

void processCommand(String cmd) {
  cmd.trim();

  // RELAY:<pin>:<state>
  if (cmd.startsWith("RELAY:")) {
    int firstColon = cmd.indexOf(':');
    int secondColon = cmd.indexOf(':', firstColon + 1);
    if (secondColon != -1) {
      int pin = cmd.substring(firstColon + 1, secondColon).toInt();
      int val = cmd.substring(secondColon + 1).toInt();
      bool state = (val == 1);
      int idx = getRelayIndex(pin);
      if (idx != -1) {
        relayStates[idx] = state;
        applyRelayState(pin, state);
        Serial.print("ACK:RELAY:");
        Serial.print(pin);
        Serial.print(":");
        Serial.println(state ? "1" : "0");
      } else {
        Serial.print("ERR:INVALID_PIN:");
        Serial.println(pin);
      }
    }
  }

  // FAN_SPEED:<speed_0_to_100>
  else if (cmd.startsWith("FAN_SPEED:")) {
    int val = cmd.substring(10).toInt();
    val = constrain(val, 0, 100);
    currentFanSpeed = val;
    int pwmVal = map(val, 0, 100, 0, 255);
    analogWrite(FAN_PWM_PIN, pwmVal);

    int fanRelayIdx = getRelayIndex(6);
    if (fanRelayIdx != -1) {
      relayStates[fanRelayIdx] = (val > 0);
      applyRelayState(6, val > 0);
    }
    Serial.print("ACK:FAN_SPEED:");
    Serial.println(val);
  }

  // ALL:<state>
  else if (cmd.startsWith("ALL:")) {
    int val = cmd.substring(4).toInt();
    bool state = (val == 1);
    for (int i = 0; i < NUM_RELAYS; i++) {
      relayStates[i] = state;
      applyRelayState(RELAY_PINS[i], state);
    }
    if (!state) {
      analogWrite(FAN_PWM_PIN, 0);
      currentFanSpeed = 0;
    }
    Serial.print("ACK:ALL:");
    Serial.println(state ? "1" : "0");
  }

  // STATUS
  else if (cmd.equalsIgnoreCase("STATUS")) {
    Serial.print("STATE:");
    for (int i = 0; i < NUM_RELAYS; i++) {
      Serial.print(RELAY_PINS[i]);
      Serial.print("=");
      Serial.print(relayStates[i] ? "1" : "0");
      if (i < NUM_RELAYS - 1) Serial.print(",");
    }
    Serial.println();
  }

  // PING:<id>
  else if (cmd.startsWith("PING")) {
    Serial.print("PONG");
    if (cmd.length() > 4) {
      Serial.print(cmd.substring(4));
    }
    Serial.println();
  }

  // RESET
  else if (cmd.equalsIgnoreCase("RESET")) {
    for (int i = 0; i < NUM_RELAYS; i++) {
      relayStates[i] = false;
      applyRelayState(RELAY_PINS[i], false);
    }
    analogWrite(FAN_PWM_PIN, 0);
    Serial.println("ACK:RESET");
  }

  else {
    Serial.print("ERR:UNKNOWN_COMMAND:");
    Serial.println(cmd);
  }
}
