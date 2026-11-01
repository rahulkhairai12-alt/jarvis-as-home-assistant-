# 🚀 JARVIS AI Voice Assistant + Arduino Home Automation System

This guide walks you through connecting your **Arduino Uno / Nano / Mega / ESP32** to your 4-channel or 8-channel relay board, configuring your API keys in VS Code, and running the voice assistant.

---

## 🔌 1. Hardware Wiring Diagram

### Pin Assignments
| Appliance | Arduino Pin | Relay Board Pin | Relay Type |
|---|---|---|---|
| **Living Room Light** | Digital Pin 7 | IN1 | Relay 1 (Active-LOW) |
| **Ceiling Fan** | Digital Pin 6 | IN2 | Relay 2 (Active-LOW) |
| **Air Conditioner** | Digital Pin 5 | IN3 | Relay 3 (Active-LOW) |
| **Kitchen Downlights** | Digital Pin 4 | IN4 | Relay 4 (Active-LOW) |
| **Smart Socket / Pump** | Digital Pin 3 | IN5 | Relay 5 (Active-LOW) |
| **Night Mood Lamp** | Digital Pin 2 | IN6 | Relay 6 (Active-LOW) |
| **Fan PWM Dimmer** | PWM Pin 9 | MOSFET / Triac Gate | PWM 0–100% |

### Power Supply Connections
1. Connect Arduino **5V** to Relay Board **VCC**.
2. Connect Arduino **GND** to Relay Board **GND**.
3. Plug the Arduino USB cable into your PC.

> ⚠️ **AC Mains Safety Warning:** When connecting 110V/220V household appliances to the relay contacts (Common & Normally Open), always turn off your mains circuit breaker first! Ensure all exposed high-voltage connections are housed inside an insulated electrical enclosure box.

---

## 💻 2. Arduino Firmware Upload

1. Open Arduino IDE or VS Code with the PlatformIO extension.
2. Open `jarvis_home_automation.ino`.
3. Select your board (e.g. **Arduino Uno**) and the correct COM Port.
4. Click **Upload** (Ctrl + U).
5. **CRITICAL:** Close the Arduino IDE Serial Monitor before running the Python script, or Windows will throw a `PermissionError: Access is denied` port collision.

---

## ⚡ 3. Running in VS Code

1. Open this project directory in VS Code:
   ```bash
   code .
   ```
2. Install Python dependencies:
   ```bash
   pip install -r requirements.txt
   ```
3. Edit `config/api_keys.json` and paste your **Gemini** and **OpenRouter** API keys.
4. Press **F5** in VS Code (or run `python main.py`).

---

## 🎙️ 4. Tested Voice Commands

| You Say | Pin Triggered | Arduino Action |
|---|---|---|
| *"On light"* or *"Turn on living room light"* | Pin 7 | `RELAY:7:1` -> Light ON |
| *"Off light"* or *"Turn off light"* | Pin 7 | `RELAY:7:0` -> Light OFF |
| *"On fan"* | Pin 6 | `RELAY:6:1` -> Fan ON |
| *"Fan speed 3"* or *"Fan speed 80"* | Pin 9 + 6 | `FAN_SPEED:80` -> 80% PWM |
| *"Turn on AC"* | Pin 5 | `RELAY:5:1` -> AC ON |
| *"Kitchen light off"* | Pin 4 | `RELAY:4:0` -> Kitchen OFF |
| *"Party mode"* or *"All on"* | All Pins | `ALL:1` -> All Relays ON |
| *"Goodnight"* or *"Turn off everything"* | All Pins | `ALL:0` -> All Relays OFF |
| *"Status"* | Query | Returns relay states from Arduino |
| *"Ping"* or *"Test connection"* | RTT Test | Reports Serial & Network latency in ms |
