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
                if "gemini_api_key" in data and "providers" not in data:
                    data = self._migrate_flat_config(data)
                return data
        except Exception as e:
            logger.error(f"Error reading {self.config_path}: {e}")
            return DEFAULT_CONFIG

    def _migrate_flat_config(self, old_data: dict) -> dict:
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
        prov = provider or self.config.get("active_provider", "gemini")
        return self.config.get("providers", {}).get(prov, {}).get("api_key", "").strip()

    def set_active_provider(self, provider: str):
        if provider in self.config.get("providers", {}):
            self.config["active_provider"] = provider
            self.save_config()

    def measure_network_latency(self, provider: Optional[str] = None) -> float:
        prov = provider or self.config.get("active_provider", "gemini")
        endpoint = self.config.get("providers", {}).get(prov, {}).get("test_endpoint")
        if not endpoint:
            return -1.0
        t0 = time.time()
        try:
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
                self.network_latencies[prov] = -1.0
                return -1.0

key_manager = KeyManager()
