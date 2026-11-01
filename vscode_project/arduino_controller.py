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
    GREY     = "\x1b[38;20m"
    CYAN     = "\x1b[36;20m"
    GREEN    = "\x1b[32;20m"
    YELLOW   = "\x1b[33;20m"
    RED      = "\x1b[31;20m"
    BOLD_RED = "\x1b[31;1m"
    RESET    = "\x1b[0m"

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

        self.relay_states: Dict[int, bool] = {
            7: False, 6: False, 5: False, 4: False, 3: False, 2: False
        }
        self.fan_speed = 0
        self.last_serial_rtt: float = 0.0
        self._ping_sent_time: float = 0.0

        self._tx_queue: queue.Queue = queue.Queue()
        self._running = True
        self._io_thread = threading.Thread(target=self._io_worker, daemon=True)
        self._io_thread.start()

    def _log_msg(self, msg: str, level: str = "info"):
        getattr(logger, level)(msg)
        if self.on_log:
            self.on_log(f"[{level.upper()}] {msg}")

    def find_arduino_port(self) -> Optional[str]:
        ports = list(serial.tools.list_ports.comports())
        if not ports:
            return None
        arduino_keywords = ["arduino", "ch340", "ch341", "ftdi", "cp210", "usb serial", "usbmodem", "ttyusb", "ttyacm"]
        for p in ports:
            desc = f"{p.device} {p.description} {p.manufacturer or ''}".lower()
            if any(k in desc for k in arduino_keywords):
                return p.device
        return ports[0].device

    def connect(self) -> bool:
        target_port = self.requested_port
        if target_port == "AUTO" or not target_port:
            target_port = self.find_arduino_port()
            if not target_port:
                self._log_msg("No Arduino USB port detected! Connect your board or check device drivers.", "error")
                return False

        try:
            self._log_msg(f"Connecting to Arduino on {target_port} at {self.baud_rate} baud...")
            self.ser = serial.Serial(port=target_port, baudrate=self.baud_rate, timeout=0.1, write_timeout=0.5)
            time.sleep(1.8) # Reset settling time
            self.ser.reset_input_buffer()
            self.ser.reset_output_buffer()
            self.port_name = target_port
            self.is_connected = True
            self._log_msg(f"Connected to Arduino on {target_port} successfully!", "info")
            self.send_raw("STATUS\n")
            self.measure_latency()
            return True
        except serial.SerialException as e:
            err_str = str(e)
            if "PermissionError" in err_str or "Access is denied" in err_str:
                self._log_msg(f"Port {target_port} is busy! Please close the Arduino IDE Serial Monitor.", "error")
            else:
                self._log_msg(f"Failed to open port {target_port}: {e}", "error")
            self.is_connected = False
            return False

    def _io_worker(self):
        while self._running:
            if not self.is_connected or not self.ser or not self.ser.is_open:
                time.sleep(0.5)
                continue
            try:
                while not self._tx_queue.empty():
                    packet = self._tx_queue.get_nowait()
                    self.ser.write(packet.encode("utf-8"))
                    self.ser.flush()
                    self._log_msg(f"TX -> {packet.strip()}", "debug")
            except Exception as e:
                self._log_msg(f"TX write failure: {e}", "error")
                self.is_connected = False

            try:
                if self.ser and self.ser.in_waiting > 0:
                    raw_line = self.ser.readline().decode("utf-8", errors="ignore").strip()
                    if raw_line:
                        self._handle_incoming_line(raw_line)
            except Exception as e:
                self._log_msg(f"RX read failure: {e}", "error")
                self.is_connected = False
            time.sleep(0.005)

    def _handle_incoming_line(self, line: str):
        self._log_msg(f"RX <- {line}", "debug")
        if line.startswith("PONG"):
            if self._ping_sent_time > 0:
                self.last_serial_rtt = round((time.time() - self._ping_sent_time) * 1000, 2)
                self._ping_sent_time = 0
                self._log_msg(f"Serial RTT Latency: {self.last_serial_rtt}ms", "info")
        elif line.startswith("ACK:RELAY:"):
            parts = line.split(":")
            if len(parts) >= 4:
                pin = int(parts[2])
                state = parts[3] == "1"
                self.relay_states[pin] = state
                self._log_msg(f"Relay Pin {pin} confirmed {('ON' if state else 'OFF')}", "info")
                if self.on_state_change:
                    self.on_state_change(pin, state)
        elif line.startswith("ACK:FAN_SPEED:"):
            speed = int(line.split(":")[2])
            self.fan_speed = speed
            self.relay_states[6] = speed > 0
            self._log_msg(f"Fan speed confirmed at {speed}%", "info")
        elif line.startswith("STATE:"):
            body = line[6:]
            for p in body.split(","):
                if "=" in p:
                    pin_str, val_str = p.split("=")
                    self.relay_states[int(pin_str)] = (val_str == "1")
            self._log_msg("Relay states synchronized from Arduino memory.", "info")
        elif line.startswith("ERR:"):
            self._log_msg(f"Arduino firmware reported error: {line[4:]}", "warning")

    def send_raw(self, packet: str):
        if not packet.endswith("\n"):
            packet += "\n"
        self._tx_queue.put(packet)

    def set_relay(self, pin: int, state: bool):
        val = 1 if state else 0
        self.send_raw(f"RELAY:{pin}:{val}\n")

    def set_fan_speed(self, speed_pct: int):
        speed = max(0, min(100, speed_pct))
        self.send_raw(f"FAN_SPEED:{speed}\n")

    def set_all(self, state: bool):
        val = 1 if state else 0
        self.send_raw(f"ALL:{val}\n")

    def measure_latency(self):
        self._ping_sent_time = time.time()
        self.send_raw(f"PING:{int(self._ping_sent_time * 1000) % 1000000}\n")

    def parse_and_execute_voice_command(self, text: str) -> Tuple[bool, str]:
        clean = text.lower().strip()
        clean = re.sub(r"[.,\/#!$%\^&\*;:{}=\-_'~()?]", " ", clean)
        clean = " ".join(clean.split())

        if "ping" in clean or "test connection" in clean:
            self.measure_latency()
            return True, f"Testing serial link. Last round trip was {self.last_serial_rtt}ms."

        if "status" in clean or "what is on" in clean or "check appliances" in clean:
            self.send_raw("STATUS\n")
            active = [info["name"] for dev, info in DEFAULT_DEVICE_PINS.items() if self.relay_states.get(info["pin"], False)]
            if not active:
                return True, "All home appliances and relays are currently OFF, sir."
            return True, f"Currently ON: {', '.join(active)}."

        if any(p in clean for p in ["turn off all", "turn off everything", "all off", "goodnight", "lights out"]):
            self.set_all(False)
            return True, "Turning off all relays and lights, sir."

        if any(p in clean for p in ["turn on all", "turn on everything", "all on", "party mode"]):
            self.set_all(True)
            return True, "Activating all circuits. Everything is ON."

        speed_match = re.search(r"(?:fan\s+speed|speed)\s+(?:to\s+)?(\d{1,3})", clean)
        if speed_match:
            spd = int(speed_match.group(1))
            if 1 <= spd <= 5:
                spd = spd * 20
            spd = max(0, min(100, spd))
            self.set_fan_speed(spd)
            return True, f"Setting ceiling fan speed to {spd} percent."

        target_state: Optional[bool] = None
        if any(re.search(rf"\b{w}\b", clean) for w in ["on", "start", "activate", "enable"]):
            target_state = True
        elif any(re.search(rf"\b{w}\b", clean) for w in ["off", "stop", "deactivate", "disable", "kill"]):
            target_state = False

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
                if re.search(rf"\b{re.escape(s)}\b", clean):
                    if len(s) > longest_len:
                        longest_len = len(s)
                        matched_key = dev_key

        if matched_key:
            dev_info = DEFAULT_DEVICE_PINS[matched_key]
            pin = dev_info["pin"]
            dev_name = dev_info["name"]
            if target_state is None:
                target_state = not self.relay_states.get(pin, False)
            self.set_relay(pin, target_state)
            action_verb = "turned ON" if target_state else "turned OFF"
            return True, f"I have {action_verb} the {dev_name}."

        return False, "Command not recognized as a home automation directive."

    def close(self):
        self._running = False
        if self.ser and self.ser.is_open:
            try:
                self.ser.close()
            except Exception:
                pass

arduino = ArduinoBridge()
