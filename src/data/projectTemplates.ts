/**
 * Full project templates for the VS Code Home Automation & Arduino Voice Assistant.
 * Exportable as individual files or a complete packaged ZIP.
 */

export const ARDUINO_CONTROLLER_PY = `"""
=============================================================================
JARVIS HOME AUTOMATION - ARDUINO ASYNC SERIAL CONTROLLER
=============================================================================
High-performance, asynchronous serial communication protocol to interface
Python voice assistants with Arduino relay boards.

Key Features:
- Asynchronous non-blocking serial queue (zero audio lag or thread freezing)
- Automatic USB COM port discovery (Windows COMx, Mac /dev/tty.*, Linux /dev/ttyUSB*)
- Fast-path string parsing: translates voice commands to relay pin packets
- Active-LOW relay driver support (standard 4/8-channel relay modules)
- Real-time Serial RTT (Round-Trip Time) latency measurement via PING/PONG
- Descriptive, colorized logging with actionable connection diagnostics
=============================================================================
"""

import sys
import time
import queue
import threading
import re
import logging
from typing import Optional, Dict, Tuple, Callable
import serial
import serial.tools.list_ports

# Colorized logging setup
class ColorFormatter(logging.Formatter):
    GREY     = "\\x1b[38;20m"
    CYAN     = "\\x1b[36;20m"
    GREEN    = "\\x1b[32;20m"
    YELLOW   = "\\x1b[33;20m"
    RED      = "\\x1b[31;20m"
    BOLD_RED = "\\x1b[31;1m"
    RESET    = "\\x1b[0m"

    FORMATS = {
        logging.DEBUG:    GREY + "[DEBUG] %(message)s" + RESET,
        logging.INFO:     CYAN + "[INFO] %(message)s" + RESET,
        logging.WARNING:  YELLOW + "[WARN] %(message)s" + RESET,
        logging.ERROR:    RED + "[ERROR] %(message)s" + RESET,
        logging.CRITICAL: BOLD_RED + "[CRITICAL] %(message)s" + RESET,
    }

    def format(self, record):
        log_fmt = self.FORMATS.get(record.levelno, self.GREY + "%(message)s" + RESET)
        formatter = logging.Formatter(f"%(asctime)s {log_fmt}", "%H:%M:%S")
        return formatter.format(record)

logger = logging.getLogger("ArduinoController")
logger.setLevel(logging.INFO)
if not logger.handlers:
    ch = logging.StreamHandler()
    ch.setFormatter(ColorFormatter())
    logger.addHandler(ch)

# Default Device to Relay Pin Map
DEFAULT_DEVICE_PINS = {
    "light":       {"pin": 7, "name": "Living Room Light", "type": "light"},
    "fan":         {"pin": 6, "name": "Ceiling Fan",       "type": "fan", "pwm_pin": 9},
    "ac":          {"pin": 5, "name": "Air Conditioner",   "type": "ac"},
    "kitchen":     {"pin": 4, "name": "Kitchen Downlights","type": "light"},
    "plug":        {"pin": 3, "name": "Smart Socket/Pump", "type": "plug"},
    "lamp":        {"pin": 2, "name": "Night Mood Lamp",   "type": "lamp"},
}

class ArduinoBridge:
    def __init__(
        self,
        port: str = "AUTO",
        baud_rate: int = 115200,
        active_low: bool = True,
        on_state_change: Optional[Callable[[int, bool], None]] = None,
        on_log: Optional[Callable[[str], None]] = None
    ):
        self.requested_port = port
        self.baud_rate = baud_rate
        self.active_low = active_low
        self.on_state_change = on_state_change
        self.on_log = on_log

        self.ser: Optional[serial.Serial] = None
        self.is_connected = False
        self.port_name = ""

        # Relay state cache {pin: bool}
        self.relay_states: Dict[int, bool] = {
            7: False, 6: False, 5: False, 4: False, 3: False, 2: False
        }
        self.fan_speed = 0

        # Latency metrics (in milliseconds)
        self.last_serial_rtt: float = 0.0
        self._ping_sent_time: float = 0.0

        # Asynchronous queues and worker threads
        self._tx_queue: queue.Queue = queue.Queue()
        self._running = True
        self._io_thread = threading.Thread(target=self._io_worker, daemon=True)
        self._io_thread.start()

    def _log_msg(self, msg: str, level: str = "info"):
        getattr(logger, level)(msg)
        if self.on_log:
            self.on_log(f"[{level.upper()}] {msg}")

    def find_arduino_port(self) -> Optional[str]:
        """Automatically discovers Arduino or USB-to-Serial converter ports."""
        ports = list(serial.tools.list_ports.comports())
        if not ports:
            return None

        arduino_keywords = [
            "arduino", "ch340", "ch341", "ftdi", "cp210", "usb serial",
            "usbmodem", "ttyusb", "ttyacm"
        ]

        for p in ports:
            desc = f"{p.device} {p.description} {p.manufacturer or ''}".lower()
            if any(k in desc for k in arduino_keywords):
                return p.device

        # Fallback to first available port
        return ports[0].device

    def connect(self) -> bool:
        """Establishes low-latency serial connection with Arduino."""
        target_port = self.requested_port
        if target_port == "AUTO" or not target_port:
            target_port = self.find_arduino_port()
            if not target_port:
                self._log_msg(
                    "No Arduino USB port detected! Connect your board or check device drivers.",
                    "error"
                )
                return False

        try:
            self._log_msg(f"Connecting to Arduino on {target_port} at {self.baud_rate} baud...")
            self.ser = serial.Serial(
                port=target_port,
                baudrate=self.baud_rate,
                timeout=0.1,
                write_timeout=0.5
            )
            # Allow Arduino bootloader to initialize (DTR reset delay)
            time.sleep(1.8)
            self.ser.reset_input_buffer()
            self.ser.reset_output_buffer()

            self.port_name = target_port
            self.is_connected = True
            self._log_msg(f"Connected to Arduino on {target_port} successfully!", "info")

            # Request hardware status and test latency
            self.send_raw("STATUS\\n")
            self.measure_latency()
            return True

        except serial.SerialException as e:
            err_str = str(e)
            if "PermissionError" in err_str or "Access is denied" in err_str:
                self._log_msg(
                    f"Port {target_port} is busy! Please close the Arduino IDE Serial Monitor.",
                    "error"
                )
            else:
                self._log_msg(f"Failed to open port {target_port}: {e}", "error")
            self.is_connected = False
            return False

    def _io_worker(self):
        """Dedicated background thread for non-blocking serial TX and RX."""
        while self._running:
            if not self.is_connected or not self.ser or not self.ser.is_open:
                time.sleep(0.5)
                continue

            # Process Outgoing Packets (TX)
            try:
                while not self._tx_queue.empty():
                    packet = self._tx_queue.get_nowait()
                    self.ser.write(packet.encode("utf-8"))
                    self.ser.flush()
                    self._log_msg(f"TX -> {packet.strip()}", "debug")
            except Exception as e:
                self._log_msg(f"TX write failure: {e}", "error")
                self.is_connected = False

            # Process Incoming Packets (RX)
            try:
                if self.ser and self.ser.in_waiting > 0:
                    raw_line = self.ser.readline().decode("utf-8", errors="ignore").strip()
                    if raw_line:
                        self._handle_incoming_line(raw_line)
            except Exception as e:
                self._log_msg(f"RX read failure: {e}", "error")
                self.is_connected = False

            time.sleep(0.005) # 5ms polling for ultra low latency

    def _handle_incoming_line(self, line: str):
        """Parses response lines from Arduino firmware."""
        self._log_msg(f"RX <- {line}", "debug")

        # PONG:<id> (Round trip latency)
        if line.startswith("PONG"):
            if self._ping_sent_time > 0:
                self.last_serial_rtt = round((time.time() - self._ping_sent_time) * 1000, 2)
                self._ping_sent_time = 0
                self._log_msg(f"Serial RTT Latency: {self.last_serial_rtt}ms", "info")

        # ACK:RELAY:<pin>:<state>
        elif line.startswith("ACK:RELAY:"):
            parts = line.split(":")
            if len(parts) >= 4:
                pin = int(parts[2])
                state = parts[3] == "1"
                self.relay_states[pin] = state
                self._log_msg(f"Relay Pin {pin} confirmed {('ON' if state else 'OFF')}", "info")
                if self.on_state_change:
                    self.on_state_change(pin, state)

        # ACK:FAN_SPEED:<speed>
        elif line.startswith("ACK:FAN_SPEED:"):
            speed = int(line.split(":")[2])
            self.fan_speed = speed
            self.relay_states[6] = speed > 0
            self._log_msg(f"Fan speed confirmed at {speed}%", "info")

        # STATE:7=1,6=0,5=0,4=1,3=0,2=0
        elif line.startswith("STATE:"):
            body = line[6:]
            pairs = body.split(",")
            for p in pairs:
                if "=" in p:
                    pin_str, val_str = p.split("=")
                    pin = int(pin_str)
                    self.relay_states[pin] = (val_str == "1")
            self._log_msg("Relay states synchronized from Arduino memory.", "info")

        # ERR:<message>
        elif line.startswith("ERR:"):
            self._log_msg(f"Arduino firmware reported error: {line[4:]}", "warning")

    def send_raw(self, packet: str):
        """Queues a raw string packet to be sent to Arduino."""
        if not packet.endswith("\\n"):
            packet += "\\n"
        self._tx_queue.put(packet)

    def set_relay(self, pin: int, state: bool):
        """Sets a relay pin to ON (True) or OFF (False)."""
        val = 1 if state else 0
        self.send_raw(f"RELAY:{pin}:{val}\\n")

    def set_fan_speed(self, speed_pct: int):
        """Sets fan speed 0-100% via PWM pin 9 and Relay 6."""
        speed = max(0, min(100, speed_pct))
        self.send_raw(f"FAN_SPEED:{speed}\\n")

    def set_all(self, state: bool):
        """Turns all relays ON or OFF simultaneously."""
        val = 1 if state else 0
        self.send_raw(f"ALL:{val}\\n")

    def measure_latency(self):
        """Sends a PING packet to measure round-trip serial communication latency."""
        self._ping_sent_time = time.time()
        self.send_raw(f"PING:{int(self._ping_sent_time * 1000) % 1000000}\\n")

    # -------------------------------------------------------------------------
    # Fast-Path Voice String Parser
    # -------------------------------------------------------------------------
    def parse_and_execute_voice_command(self, text: str) -> Tuple[bool, str]:
        """
        Parses natural voice text like 'on light', 'fan off', 'kitchen light on'.
        Executes the serial command immediately for ultra-low latency.
        Returns: (success: bool, speech_feedback: str)
        """
        clean = text.lower().strip()
        clean = re.sub(r"[.,\\/#!$%\\^&\\*;:{}=\\-_'~()?]", " ", clean)
        clean = " ".join(clean.split())

        # 1. PING / Diagnostic
        if "ping" in clean or "test connection" in clean:
            self.measure_latency()
            return True, f"Testing serial link. Last round trip was {self.last_serial_rtt}ms."

        # 2. Status
        if "status" in clean or "what is on" in clean or "check appliances" in clean:
            self.send_raw("STATUS\\n")
            active = [name for dev, info in DEFAULT_DEVICE_PINS.items() 
                      if self.relay_states.get(info["pin"], False) 
                      for name in [info["name"]]]
            if not active:
                return True, "All home appliances and relays are currently OFF, sir."
            return True, f"Currently ON: {', '.join(active)}."

        # 3. Global All On / All Off
        if any(p in clean for p in ["turn off all", "turn off everything", "all off", "goodnight", "lights out"]):
            self.set_all(False)
            return True, "Turning off all relays and lights, sir."

        if any(p in clean for p in ["turn on all", "turn on everything", "all on", "party mode"]):
            self.set_all(True)
            return True, "Activating all circuits. Everything is ON."

        # 4. Fan Speed
        speed_match = re.search(r"(?:fan\\s+speed|speed)\\s+(?:to\\s+)?(\\d{1,3})", clean)
        if speed_match:
            spd = int(speed_match.group(1))
            if 1 <= spd <= 5:
                spd = spd * 20
            spd = max(0, min(100, spd))
            self.set_fan_speed(spd)
            return True, f"Setting ceiling fan speed to {spd} percent."

        # 5. Desired State (ON vs OFF)
        target_state: Optional[bool] = None
        if any(re.search(rf"\\b{w}\\b", clean) for w in ["on", "start", "activate", "enable"]):
            target_state = True
        elif any(re.search(rf"\\b{w}\\b", clean) for w in ["off", "stop", "deactivate", "disable", "kill"]):
            target_state = False

        # 6. Device Matching (Longest Synonym Match)
        matched_key = None
        longest_len = 0

        synonym_map = {
            "light":   ["living room light", "main light", "light 1", "light", "lights"],
            "fan":     ["ceiling fan", "cooler fan", "fan"],
            "ac":      ["air conditioner", "air con", "cooler", "ac"],
            "kitchen": ["kitchen light", "kitchen lights", "kitchen"],
            "plug":    ["smart plug", "water pump", "socket", "plug", "pump", "heater"],
            "lamp":    ["night lamp", "bed lamp", "mood lamp", "lamp"],
        }

        for dev_key, syns in synonym_map.items():
            for s in syns:
                if re.search(rf"\\b{re.escape(s)}\\b", clean):
                    if len(s) > longest_len:
                        longest_len = len(s)
                        matched_key = dev_key

        if matched_key:
            dev_info = DEFAULT_DEVICE_PINS[matched_key]
            pin = dev_info["pin"]
            dev_name = dev_info["name"]

            # If no explicit on/off was spoken, toggle current state
            if target_state is None:
                target_state = not self.relay_states.get(pin, False)

            self.set_relay(pin, target_state)
            action_verb = "turned ON" if target_state else "turned OFF"
            return True, f"I have {action_verb} the {dev_name}."

        return False, "Command not recognized as a home automation directive."

    def close(self):
        """Safely shuts down the serial port and threads."""
        self._running = False
        if self.ser and self.ser.is_open:
            try:
                self.ser.close()
            except Exception:
                pass
        self._log_msg("Arduino bridge closed.", "info")


# Global bridge singleton
arduino = ArduinoBridge()

if __name__ == "__main__":
    print("=" * 60)
    print("  JARVIS Home Automation - Arduino Bridge Standalone Test")
    print("=" * 60)
    if arduino.connect():
        print("Connected! Testing command: 'on light'...")
        ok, reply = arduino.parse_and_execute_voice_command("on light")
        print(f"Reply: {reply}")
        time.sleep(1)
        print("Testing command: 'off light'...")
        ok, reply = arduino.parse_and_execute_voice_command("off light")
        print(f"Reply: {reply}")
        time.sleep(1)
        arduino.close()
    else:
        print("Could not connect to Arduino. Running in simulation mode.")
`;

export const MODULAR_KEYS_PY = `"""
=============================================================================
MODULAR API KEY & MULTI-PROVIDER LLM MANAGER
=============================================================================
Provides modular switching between Gemini, OpenRouter, Groq, OpenAI,
Anthropic, and local LLM endpoints (Ollama) with automatic fallback and
live network latency benchmarking.
=============================================================================
"""

import os
import json
import time
import sys
import logging
from pathlib import Path
from typing import Optional, Dict, Any, List
import requests

logger = logging.getLogger("ModularKeyManager")

BASE_DIR = Path(__file__).resolve().parent
CONFIG_PATH = BASE_DIR / "config" / "api_keys.json"

DEFAULT_CONFIG = {
    "active_provider": "gemini",
    "fallback_chain": ["gemini", "openrouter", "groq", "openai"],
    "providers": {
        "gemini": {
            "api_key": "",
            "model": "models/gemini-2.5-flash",
            "live_model": "models/gemini-2.5-flash-native-audio-preview-12-2025",
            "enabled": True,
            "test_endpoint": "https://generativelanguage.googleapis.com"
        },
        "openrouter": {
            "api_key": "",
            "model": "meta-llama/llama-3.3-70b-instruct:free",
            "enabled": True,
            "test_endpoint": "https://openrouter.ai/api/v1/models"
        },
        "groq": {
            "api_key": "",
            "model": "llama-3.3-70b-versatile",
            "enabled": False,
            "test_endpoint": "https://api.groq.com/openai/v1/models"
        },
        "openai": {
            "api_key": "",
            "model": "gpt-4o-mini",
            "enabled": False,
            "test_endpoint": "https://api.openai.com/v1/models"
        },
        "anthropic": {
            "api_key": "",
            "model": "claude-3-5-haiku-20241022",
            "enabled": False,
            "test_endpoint": "https://api.anthropic.com/v1/messages"
        },
        "ollama": {
            "base_url": "http://localhost:11434",
            "model": "llama3.2",
            "enabled": False,
            "test_endpoint": "http://localhost:11434/api/tags"
        }
    },
    "arduino": {
        "port": "AUTO",
        "baud_rate": 115200,
        "timeout": 1.0,
        "active_low": True
    }
}

class KeyManager:
    def __init__(self, config_path: Path = CONFIG_PATH):
        self.config_path = config_path
        self.config: Dict[str, Any] = self._load_or_create_config()
        self.network_latencies: Dict[str, float] = {}

    def _load_or_create_config(self) -> Dict[str, Any]:
        if not self.config_path.exists():
            self.config_path.parent.mkdir(parents=True, exist_ok=True)
            with open(self.config_path, "w", encoding="utf-8") as f:
                json.dump(DEFAULT_CONFIG, f, indent=4)
            return DEFAULT_CONFIG
        try:
            with open(self.config_path, "r", encoding="utf-8") as f:
                data = json.load(f)
                # Backward compatibility with original flat format
                if "gemini_api_key" in data and "providers" not in data:
                    data = self._migrate_flat_config(data)
                return data
        except Exception as e:
            logger.error(f"Error reading {self.config_path}: {e}")
            return DEFAULT_CONFIG

    def _migrate_flat_config(self, old_data: dict) -> dict:
        """Migrates legacy flat api_keys.json to the modular format."""
        new_conf = json.loads(json.dumps(DEFAULT_CONFIG))
        new_conf["providers"]["gemini"]["api_key"] = old_data.get("gemini_api_key", "")
        new_conf["providers"]["openrouter"]["api_key"] = old_data.get("openrouter_api_key", "")
        self.save_config(new_conf)
        return new_conf

    def save_config(self, config_dict: Optional[dict] = None):
        if config_dict:
            self.config = config_dict
        with open(self.config_path, "w", encoding="utf-8") as f:
            json.dump(self.config, f, indent=4)

    def get_api_key(self, provider: Optional[str] = None) -> str:
        """Retrieves active API key for a specific provider or active provider."""
        prov = provider or self.config.get("active_provider", "gemini")
        return self.config.get("providers", {}).get(prov, {}).get("api_key", "").strip()

    def set_active_provider(self, provider: str):
        """Changes the active LLM provider dynamically."""
        if provider in self.config.get("providers", {}):
            self.config["active_provider"] = provider
            self.save_config()
            logger.info(f"Active provider switched to: {provider}")

    def measure_network_latency(self, provider: Optional[str] = None) -> float:
        """
        Pings the provider's API endpoint asynchronously to calculate network delay (ms).
        Helps diagnose slow response or high network latency.
        """
        prov = provider or self.config.get("active_provider", "gemini")
        prov_info = self.config.get("providers", {}).get(prov, {})
        endpoint = prov_info.get("test_endpoint")

        if not endpoint:
            return -1.0

        t0 = time.time()
        try:
            # Quick HEAD or GET with 3s timeout
            requests.head(endpoint, timeout=3.0)
            latency_ms = round((time.time() - t0) * 1000, 1)
            self.network_latencies[prov] = latency_ms
            return latency_ms
        except Exception:
            try:
                requests.get(endpoint, timeout=3.0)
                latency_ms = round((time.time() - t0) * 1000, 1)
                self.network_latencies[prov] = latency_ms
                return latency_ms
            except Exception as e:
                logger.warning(f"Network ping failed for {prov}: {e}")
                self.network_latencies[prov] = -1.0
                return -1.0

    def get_fallback_provider(self, current: str) -> Optional[str]:
        """Returns the next healthy provider in the fallback chain."""
        chain = self.config.get("fallback_chain", [])
        try:
            idx = chain.index(current)
            for next_prov in chain[idx + 1:]:
                if self.config.get("providers", {}).get(next_prov, {}).get("enabled", False):
                    key = self.get_api_key(next_prov)
                    if key or next_prov == "ollama":
                        return next_prov
        except ValueError:
            pass
        return None

# Singleton instance
key_manager = KeyManager()
`;

export const MAIN_AUTOMATION_PY = `"""
=============================================================================
JARVIS MARK XXXIX - VOICE ASSISTANT + HOME AUTOMATION CORE
=============================================================================
Combines real-time Gemini Live audio streaming with instant local
string parsing to trigger Arduino relay pins (Light, Fan, AC, Kitchen, etc.)
with low latency and robust multi-provider key management.
=============================================================================
"""

import asyncio
import threading
import json
import sys
import os
import time
import traceback
from pathlib import Path

import sounddevice as sd
from google import genai
from google.genai import types

# Local Modules
from arduino_controller import arduino
from modular_keys import key_manager
from ui import JarvisUI

LIVE_MODEL          = "models/gemini-2.5-flash-native-audio-preview-12-2025"
CHANNELS            = 1
SEND_SAMPLE_RATE    = 16000
RECEIVE_SAMPLE_RATE = 24000
CHUNK_SIZE          = 1024

# Extended Tool Declarations including Home Automation & Latency Check
HOME_AUTOMATION_TOOLS = [
    {
        "name": "home_automation_control",
        "description": (
            "Controls smart home appliances via Arduino relay pins: "
            "Living Room Light (Pin 7), Ceiling Fan (Pin 6 + speed 0-100), "
            "AC (Pin 5), Kitchen Light (Pin 4), Smart Plug/Pump (Pin 3), Night Lamp (Pin 2). "
            "Always call this when the user asks to turn on/off appliances or adjust fan speed."
        ),
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "device": {
                    "type": "STRING",
                    "description": "Appliance name: light | fan | ac | kitchen | plug | lamp | all"
                },
                "action": {
                    "type": "STRING",
                    "description": "Action to perform: on | off | speed | toggle"
                },
                "value": {
                    "type": "INTEGER",
                    "description": "Optional speed or intensity percentage 0-100 (for fan)"
                }
            },
            "required": ["device", "action"]
        }
    },
    {
        "name": "get_connection_latencies",
        "description": "Reports current serial round-trip latency to Arduino and network delay to Gemini.",
        "parameters": {
            "type": "OBJECT",
            "properties": {}
        }
    }
]

class JarvisLive:
    def __init__(self, ui: JarvisUI):
        self.ui = ui
        self.session = None
        self.audio_in_queue = None
        self.out_queue = None
        self._loop = None
        self._is_speaking = False
        self._speaking_lock = threading.Lock()
        self.ui.on_text_command = self._on_text_command

        # Hook Arduino state updates to the UI log
        arduino.on_log = self._on_arduino_log

    def _on_arduino_log(self, text: str):
        self.ui.write_log(f"ARDUINO: {text}")

    def _on_text_command(self, text: str):
        # 1. FAST-PATH LOCAL STRING PARSING:
        # Check if the command is a direct home automation command ("on light", "fan speed 3")
        # If so, execute on Arduino in < 2ms without waiting for cloud LLM roundtrip!
        matched, speech = arduino.parse_and_execute_voice_command(text)
        if matched:
            self.ui.write_log(f"JARVIS [Fast-Path]: {speech}")
            self.speak(speech)
            return

        # 2. Otherwise, forward to Gemini Live session
        if not self._loop or not self.session:
            return
        asyncio.run_coroutine_threadsafe(
            self.session.send_client_content(
                turns={"parts": [{"text": text}]},
                turn_complete=True
            ),
            self._loop
        )

    def set_speaking(self, value: bool):
        with self._speaking_lock:
            self._is_speaking = value
        if value:
            self.ui.set_state("SPEAKING")
        elif not self.ui.muted:
            self.ui.set_state("LISTENING")

    def speak(self, text: str):
        if not self._loop or not self.session:
            return
        asyncio.run_coroutine_threadsafe(
            self.session.send_client_content(
                turns={"parts": [{"text": text}]},
                turn_complete=True
            ),
            self._loop
        )

    async def _execute_tool(self, fc) -> types.FunctionResponse:
        name = fc.name
        args = dict(fc.args or {})
        print(f"[JARVIS TOOL] {name} {args}")

        if name == "home_automation_control":
            device = args.get("device", "light").lower()
            action = args.get("action", "on").lower()
            val = args.get("value")

            if device == "fan" and action == "speed" and val is not None:
                arduino.set_fan_speed(int(val))
                res = f"Ceiling fan speed set to {val}%."
            elif device == "all":
                state = action == "on"
                arduino.set_all(state)
                res = f"All appliances turned {('ON' if state else 'OFF')}."
            else:
                pin_map = {"light": 7, "fan": 6, "ac": 5, "kitchen": 4, "plug": 3, "lamp": 2}
                pin = pin_map.get(device, 7)
                state = action == "on"
                arduino.set_relay(pin, state)
                res = f"{device.capitalize()} turned {('ON' if state else 'OFF')} on pin {pin}."

            return types.FunctionResponse(id=fc.id, name=name, response={"result": res})

        elif name == "get_connection_latencies":
            net_ms = key_manager.measure_network_latency()
            serial_rtt = arduino.last_serial_rtt
            res = f"Network Latency: {net_ms}ms | Arduino Serial RTT: {serial_rtt}ms."
            return types.FunctionResponse(id=fc.id, name=name, response={"result": res})

        return types.FunctionResponse(id=fc.id, name=name, response={"result": "Unknown tool"})

    def _build_config(self) -> types.LiveConnectConfig:
        sys_prompt = (
            "You are JARVIS, Tony Stark's personal assistant and home automation core. "
            "You control the physical living room lights, ceiling fan, AC, kitchen spotlights, "
            "smart sockets, and night lamps via an integrated Arduino relay module. "
            "When the user asks to control appliances, invoke the home_automation_control tool immediately. "
            "Be witty, concise, loyal, and efficient."
        )

        tools = [{"function_declarations": HOME_AUTOMATION_TOOLS}]

        return types.LiveConnectConfig(
            response_modalities=["AUDIO"],
            output_audio_transcription={},
            input_audio_transcription={},
            system_instruction=sys_prompt,
            tools=tools,
            speech_config=types.SpeechConfig(
                voice_config=types.VoiceConfig(
                    prebuilt_voice_config=types.PrebuiltVoiceConfig(voice_name="Charon")
                )
            ),
        )

    async def run(self):
        # 1. Connect to Arduino
        arduino_connected = arduino.connect()
        if arduino_connected:
            self.ui.write_log(f"SYS: Arduino connected on {arduino.port_name}")
        else:
            self.ui.write_log("SYS: Arduino not detected. Running in hardware simulation.")

        # 2. Get API key from modular manager
        api_key = key_manager.get_api_key("gemini")
        if not api_key:
            self.ui.write_log("SYS: Please set Gemini API Key in config/api_keys.json")
            return

        client = genai.Client(api_key=api_key, http_options={"api_version": "v1beta"})

        while True:
            try:
                self.ui.set_state("THINKING")
                config = self._build_config()

                async with (
                    client.aio.live.connect(model=LIVE_MODEL, config=config) as session,
                    asyncio.TaskGroup() as tg,
                ):
                    self.session = session
                    self._loop = asyncio.get_event_loop()
                    self.audio_in_queue = asyncio.Queue()
                    self.out_queue = asyncio.Queue(maxsize=10)

                    self.ui.set_state("LISTENING")
                    self.ui.write_log("SYS: JARVIS Home Automation Online.")

                    # Start real-time audio threads
                    tg.create_task(self._listen_mic())
                    tg.create_task(self._receive_events())
                    tg.create_task(self._play_output())

            except Exception as e:
                self.ui.write_log(f"ERR: Connection interrupted: {e}")
                traceback.print_exc()

            await asyncio.sleep(3)

    async def _listen_mic(self):
        loop = asyncio.get_event_loop()
        def callback(indata, frames, time_info, status):
            if not self._is_speaking and not self.ui.muted:
                loop.call_soon_threadsafe(
                    self.out_queue.put_nowait,
                    {"data": indata.tobytes(), "mime_type": "audio/pcm"}
                )
        with sd.InputStream(samplerate=SEND_SAMPLE_RATE, channels=CHANNELS, dtype="int16", blocksize=CHUNK_SIZE, callback=callback):
            while True:
                msg = await self.out_queue.get()
                await self.session.send_realtime_input(media=msg)

    async def _receive_events(self):
        in_buf, out_buf = [], []
        async for response in self.session.receive():
            if response.data:
                self.audio_in_queue.put_nowait(response.data)

            if response.server_content:
                sc = response.server_content
                if sc.output_transcription and sc.output_transcription.text:
                    self.set_speaking(True)
                    out_buf.append(sc.output_transcription.text.strip())

                if sc.input_transcription and sc.input_transcription.text:
                    txt = sc.input_transcription.text.strip()
                    in_buf.append(txt)

                    # Intercept fast home automation commands during live speech transcription!
                    matched, speech = arduino.parse_and_execute_voice_command(txt)
                    if matched:
                        self.ui.write_log(f"You: {txt}")
                        self.ui.write_log(f"JARVIS [Relay Trigger]: {speech}")

                if sc.turn_complete:
                    self.set_speaking(False)
                    if in_buf:
                        self.ui.write_log(f"You: {' '.join(in_buf)}")
                        in_buf = []
                    if out_buf:
                        self.ui.write_log(f"Jarvis: {' '.join(out_buf)}")
                        out_buf = []

            if response.tool_call:
                fn_responses = []
                for fc in response.tool_call.function_calls:
                    fr = await self._execute_tool(fc)
                    fn_responses.append(fr)
                await self.session.send_tool_response(function_responses=fn_responses)

    async def _play_output(self):
        stream = sd.RawOutputStream(samplerate=RECEIVE_SAMPLE_RATE, channels=CHANNELS, dtype="int16", blocksize=CHUNK_SIZE)
        stream.start()
        try:
            while True:
                chunk = await self.audio_in_queue.get()
                self.set_speaking(True)
                await asyncio.to_thread(stream.write, chunk)
        finally:
            self.set_speaking(False)
            stream.stop()
            stream.close()

def main():
    ui = JarvisUI("face.png")
    def runner():
        ui.wait_for_api_key()
        jarvis = JarvisLive(ui)
        asyncio.run(jarvis.run())
    threading.Thread(target=runner, daemon=True).start()
    ui.root.mainloop()

if __name__ == "__main__":
    main()
`;

export const ARDUINO_INO = `/*
=============================================================================
  JARVIS HOME AUTOMATION - ARDUINO FIRMWARE V2.0
=============================================================================
  Target: Arduino Uno / Nano / Mega / ESP32
  Baud Rate: 115200 (Default) or 9600
  
  Relay Pin Assignments:
  - Relay 1 (Pin 7): Living Room Light
  - Relay 2 (Pin 6): Ceiling Fan Relay
  - Relay 3 (Pin 5): Air Conditioner (AC)
  - Relay 4 (Pin 4): Kitchen Downlights
  - Relay 5 (Pin 3): Smart Socket / Water Pump
  - Relay 6 (Pin 2): Night Mood Lamp
  - PWM Fan (Pin 9): Fan Speed Dimmer (0-255)

  Relay Logic Note:
  Most standard 4-channel and 8-channel relay modules are ACTIVE-LOW:
  - digitalWrite(pin, LOW)  => RELAY ENERGIZED / APPLIANCE ON
  - digitalWrite(pin, HIGH) => RELAY DE-ENERGIZED / APPLIANCE OFF
=============================================================================
*/

#include <EEPROM.h>

// Set to true for standard Active-LOW relay modules, false for Active-HIGH
const bool ACTIVE_LOW_RELAY = true;

const int RELAY_PINS[] = {7, 6, 5, 4, 3, 2};
const int NUM_RELAYS = sizeof(RELAY_PINS) / sizeof(RELAY_PINS[0]);
const int FAN_PWM_PIN = 9;

// In-memory relay states (true = ON, false = OFF)
bool relayStates[NUM_RELAYS];
int currentFanSpeed = 0; // 0 to 100%

// Buffer for serial string parsing
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
  while (!Serial) { ; } // wait for serial port to connect
  
  // Reserve buffer to prevent dynamic memory fragmentation
  inputString.reserve(64);

  // Initialize Relay Pins to Safe OFF State
  for (int i = 0; i < NUM_RELAYS; i++) {
    pinMode(RELAY_PINS[i], OUTPUT);
    relayStates[i] = false;
    applyRelayState(RELAY_PINS[i], false);
  }

  // Initialize Fan PWM Pin
  pinMode(FAN_PWM_PIN, OUTPUT);
  analogWrite(FAN_PWM_PIN, 0);

  // Handshake to notify Python assistant that hardware is ready
  Serial.println("READY:JARVIS_ARDUINO_V2.0");
}

void loop() {
  // Read Serial Stream asynchronously
  while (Serial.available()) {
    char inChar = (char)Serial.read();
    if (inChar == '\\n' || inChar == '\\r') {
      if (inputString.length() > 0) {
        stringComplete = true;
      }
    } else {
      inputString += inChar;
    }
  }

  // Parse completed string command
  if (stringComplete) {
    processCommand(inputString);
    inputString = "";
    stringComplete = false;
  }
}

void processCommand(String cmd) {
  cmd.trim();

  // 1. RELAY:<pin>:<state>  (e.g., RELAY:7:1 or RELAY:7:0)
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

  // 2. FAN_SPEED:<speed_0_to_100> (e.g. FAN_SPEED:80)
  else if (cmd.startsWith("FAN_SPEED:")) {
    int val = cmd.substring(10).toInt();
    val = constrain(val, 0, 100);
    currentFanSpeed = val;

    // Map 0-100% to 0-255 PWM
    int pwmVal = map(val, 0, 100, 0, 255);
    analogWrite(FAN_PWM_PIN, pwmVal);

    // Relay 6 controls main fan AC power
    int fanRelayIdx = getRelayIndex(6);
    if (fanRelayIdx != -1) {
      relayStates[fanRelayIdx] = (val > 0);
      applyRelayState(6, val > 0);
    }

    Serial.print("ACK:FAN_SPEED:");
    Serial.println(val);
  }

  // 3. ALL:<state> (e.g., ALL:1 or ALL:0)
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

  // 4. STATUS query
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

  // 5. PING:<id> (Returns PONG:<id> for latency calculation)
  else if (cmd.startsWith("PING")) {
    Serial.print("PONG");
    if (cmd.length() > 4) {
      Serial.print(cmd.substring(4));
    }
    Serial.println();
  }

  // 6. RESET
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
`;

export const REQUIREMENTS_TXT = `pyserial>=3.5
google-genai>=2.4.0
requests>=2.31.0
sounddevice>=0.4.6
PyQt6>=6.6.0
psutil>=5.9.8
Pillow>=10.2.0
`;

export const API_KEYS_JSON_TEMPLATE = `{
    "active_provider": "gemini",
    "fallback_chain": [
        "gemini",
        "openrouter",
        "groq"
    ],
    "providers": {
        "gemini": {
            "api_key": "YOUR_GEMINI_API_KEY",
            "model": "models/gemini-2.5-flash",
            "live_model": "models/gemini-2.5-flash-native-audio-preview-12-2025",
            "enabled": true,
            "test_endpoint": "https://generativelanguage.googleapis.com"
        },
        "openrouter": {
            "api_key": "YOUR_OPENROUTER_API_KEY",
            "model": "meta-llama/llama-3.3-70b-instruct:free",
            "enabled": true,
            "test_endpoint": "https://openrouter.ai/api/v1/models"
        },
        "groq": {
            "api_key": "YOUR_GROQ_API_KEY",
            "model": "llama-3.3-70b-versatile",
            "enabled": false,
            "test_endpoint": "https://api.groq.com/openai/v1/models"
        }
    },
    "arduino": {
        "port": "AUTO",
        "baud_rate": 115200,
        "timeout": 1.0,
        "active_low": true
    }
}`;

export const SETUP_GUIDE_MD = `# 🚀 JARVIS AI Voice Assistant + Arduino Home Automation System

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
2. Open \`jarvis_home_automation.ino\`.
3. Select your board (e.g. **Arduino Uno**) and the correct COM Port.
4. Click **Upload** (Ctrl + U).
5. **CRITICAL:** Close the Arduino IDE Serial Monitor before running the Python script, or Windows will throw a \`PermissionError: Access is denied\` port collision.

---

## ⚡ 3. Running in VS Code

1. Open this project directory in VS Code:
   \`\`\`bash
   code .
   \`\`\`
2. Install Python dependencies:
   \`\`\`bash
   pip install -r requirements.txt
   \`\`\`
3. Edit \`config/api_keys.json\` and paste your **Gemini** and **OpenRouter** API keys.
4. Press **F5** in VS Code (or run \`python main.py\`).

---

## 🎙️ 4. Tested Voice Commands

| You Say | Pin Triggered | Arduino Action |
|---|---|---|
| *"On light"* or *"Turn on living room light"* | Pin 7 | \`RELAY:7:1\` -> Light ON |
| *"Off light"* or *"Turn off light"* | Pin 7 | \`RELAY:7:0\` -> Light OFF |
| *"On fan"* | Pin 6 | \`RELAY:6:1\` -> Fan ON |
| *"Fan speed 3"* or *"Fan speed 80"* | Pin 9 + 6 | \`FAN_SPEED:80\` -> 80% PWM |
| *"Turn on AC"* | Pin 5 | \`RELAY:5:1\` -> AC ON |
| *"Kitchen light off"* | Pin 4 | \`RELAY:4:0\` -> Kitchen OFF |
| *"Party mode"* or *"All on"* | All Pins | \`ALL:1\` -> All Relays ON |
| *"Goodnight"* or *"Turn off everything"* | All Pins | \`ALL:0\` -> All Relays OFF |
| *"Status"* | Query | Returns relay states from Arduino |
| *"Ping"* or *"Test connection"* | RTT Test | Reports Serial & Network latency in ms |
`;
