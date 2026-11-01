import React from 'react';
import {
  Lightbulb,
  Fan,
  Snowflake,
  Zap,
  Power,
  Sliders,
  Moon,
  Sparkles,
  RotateCcw,
  RefreshCw,
  Cpu,
} from 'lucide-react';
import { DeviceMapping } from '../utils/homeAutomationParser';
import { serialService } from '../utils/serialService';

interface RelayDeckProps {
  devices: DeviceMapping[];
  onToggleRelay: (pin: number, nextState: boolean) => void;
  onSetFanSpeed: (speed: number) => void;
  fanSpeed: number;
}

export const RelayDeck: React.FC<RelayDeckProps> = ({
  devices,
  onToggleRelay,
  onSetFanSpeed,
  fanSpeed,
}) => {
  const getDeviceIcon = (dev: DeviceMapping) => {
    switch (dev.type) {
      case 'light':
        return <Lightbulb className={`w-5 h-5 ${dev.state ? 'text-amber-400' : 'text-gray-500'}`} />;
      case 'fan':
        return (
          <Fan
            className={`w-5 h-5 ${dev.state ? 'text-cyan-400 animate-spin' : 'text-gray-500'}`}
            style={{
              animationDuration: dev.state ? `${Math.max(0.2, (100 - fanSpeed) / 70)}s` : '0s',
            }}
          />
        );
      case 'ac':
        return <Snowflake className={`w-5 h-5 ${dev.state ? 'text-sky-400' : 'text-gray-500'}`} />;
      case 'lamp':
        return <Moon className={`w-5 h-5 ${dev.state ? 'text-amber-300' : 'text-gray-500'}`} />;
      case 'appliance':
      default:
        return <Zap className={`w-5 h-5 ${dev.state ? 'text-emerald-400' : 'text-gray-500'}`} />;
    }
  };

  const allOn = () => serialService.sendPacket('ALL:1\n');
  const allOff = () => serialService.sendPacket('ALL:0\n');
  const syncStatus = () => serialService.sendPacket('STATUS\n');

  return (
    <div className="space-y-6">
      {/* Top Banner & Quick Scenes */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-4 rounded-xl bg-gray-900/80 border border-gray-800">
        <div>
          <h2 className="text-sm font-semibold text-gray-100 flex items-center gap-2">
            <Cpu className="w-4 h-4 text-cyan-400" />
            <span>Arduino 6-Channel Relay Control Deck</span>
          </h2>
          <p className="text-xs text-gray-400 mt-0.5">
            Real-time optical isolated relay drivers (Active-LOW: Pin LOW = Energized)
          </p>
        </div>

        {/* Global Action Buttons */}
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={allOn}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-950/40 hover:bg-amber-900/60 border border-amber-600/40 text-amber-300 rounded-lg text-xs font-medium transition-colors"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>Party Mode (All ON)</span>
          </button>

          <button
            onClick={allOff}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-950 hover:bg-gray-800 border border-gray-700 text-gray-300 rounded-lg text-xs font-medium transition-colors"
          >
            <Power className="w-3.5 h-3.5 text-red-400" />
            <span>Goodnight (All OFF)</span>
          </button>

          <button
            onClick={syncStatus}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-950 hover:bg-gray-800 border border-gray-700 text-gray-300 rounded-lg text-xs font-medium transition-colors"
            title="Read relay states from Arduino EEPROM/RAM"
          >
            <RefreshCw className="w-3.5 h-3.5 text-cyan-400" />
            <span>Sync Hardware</span>
          </button>
        </div>
      </div>

      {/* Relays Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {devices.map((dev) => {
          const isFan = dev.type === 'fan';

          return (
            <div
              key={dev.id}
              className={`p-4 rounded-xl border transition-all duration-200 relative overflow-hidden ${
                dev.state
                  ? 'bg-gray-900/90 border-cyan-500/40 shadow-[0_0_20px_rgba(6,182,212,0.1)]'
                  : 'bg-gray-950 border-gray-800/80 hover:border-gray-700'
              }`}
            >
              {/* Relay Glow Effect */}
              {dev.state && (
                <div className="absolute top-0 right-0 w-28 h-28 bg-cyan-500/10 rounded-full blur-2xl pointer-events-none" />
              )}

              {/* Card Header */}
              <div className="flex items-start justify-between gap-3 relative z-10">
                <div className="flex items-center gap-3">
                  <div
                    className={`w-10 h-10 rounded-lg flex items-center justify-center border transition-colors ${
                      dev.state
                        ? 'bg-cyan-950/80 border-cyan-500/50'
                        : 'bg-gray-900 border-gray-800'
                    }`}
                  >
                    {getDeviceIcon(dev)}
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-gray-100">{dev.name}</h3>
                    <div className="flex items-center gap-2 text-[11px] text-gray-400 mt-0.5">
                      <span className="font-mono text-cyan-400 font-medium">Pin {dev.pin}</span>
                      <span>·</span>
                      <span className="font-mono text-[10px] text-gray-400">
                        {dev.state ? 'STATE: 1 (LOW)' : 'STATE: 0 (HIGH)'}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Primary Toggle Switch */}
                <button
                  onClick={() => onToggleRelay(dev.pin, !dev.state)}
                  className={`w-12 h-6 rounded-full transition-colors relative focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 ${
                    dev.state ? 'bg-cyan-500' : 'bg-gray-800'
                  }`}
                  aria-label={`Toggle ${dev.name}`}
                >
                  <div
                    className={`w-4 h-4 rounded-full bg-white transition-transform duration-200 absolute top-1 ${
                      dev.state ? 'translate-x-7' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>

              {/* Fan Speed Slider if this is the fan */}
              {isFan && (
                <div className="mt-4 pt-3 border-t border-gray-800/80 relative z-10">
                  <div className="flex items-center justify-between text-xs text-gray-300 mb-1.5">
                    <span className="flex items-center gap-1.5 text-gray-400">
                      <Sliders className="w-3.5 h-3.5 text-cyan-400" />
                      <span>Speed (PWM Pin 9)</span>
                    </span>
                    <span className="font-mono font-semibold text-cyan-400">{fanSpeed}%</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    step="5"
                    value={fanSpeed}
                    onChange={(e) => onSetFanSpeed(parseInt(e.target.value, 10))}
                    className="w-full accent-cyan-400 bg-gray-800 h-1.5 rounded-lg cursor-pointer"
                  />
                  <div className="flex justify-between text-[10px] text-gray-400 mt-1 font-mono">
                    <span>OFF</span>
                    <span>1 (20%)</span>
                    <span>2 (40%)</span>
                    <span>3 (60%)</span>
                    <span>4 (80%)</span>
                    <span>MAX</span>
                  </div>
                </div>
              )}

              {/* AC Temperature Display */}
              {dev.type === 'ac' && dev.state && (
                <div className="mt-3 pt-2.5 border-t border-gray-800/80 flex items-center justify-between text-xs text-gray-300">
                  <span className="text-gray-400">Cooling Setpoint</span>
                  <span className="font-mono text-sky-400 font-semibold">22°C · Fan Auto</span>
                </div>
              )}

              {/* Smart Socket Wattage */}
              {dev.type === 'appliance' && (
                <div className="mt-3 pt-2.5 border-t border-gray-800/80 flex items-center justify-between text-xs text-gray-300">
                  <span className="text-gray-400">Current Load</span>
                  <span className="font-mono text-emerald-400 font-semibold">
                    {dev.state ? '120 W · Active' : '0 W · Standby'}
                  </span>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Protocol Architecture Reference */}
      <div className="p-4 rounded-xl bg-gray-950 border border-gray-800 text-xs text-gray-400 space-y-2">
        <div className="font-semibold text-gray-200 flex items-center gap-2">
          <RotateCcw className="w-3.5 h-3.5 text-cyan-400" />
          <span>Active Serial String Protocol:</span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 font-mono text-[11px]">
          <div className="p-2.5 bg-gray-900 rounded-lg border border-gray-800/60">
            <span className="text-cyan-400 block font-semibold mb-0.5">RELAY:&lt;pin&gt;:&lt;state&gt;</span>
            <span className="text-gray-400">e.g. RELAY:7:1 (ON), RELAY:7:0 (OFF)</span>
          </div>
          <div className="p-2.5 bg-gray-900 rounded-lg border border-gray-800/60">
            <span className="text-cyan-400 block font-semibold mb-0.5">FAN_SPEED:&lt;0-100&gt;</span>
            <span className="text-gray-400">e.g. FAN_SPEED:60 (Pin 9 PWM)</span>
          </div>
          <div className="p-2.5 bg-gray-900 rounded-lg border border-gray-800/60">
            <span className="text-cyan-400 block font-semibold mb-0.5">STATUS / PING</span>
            <span className="text-gray-400">Returns STATE:7=1,6=0... & PONG RTT</span>
          </div>
        </div>
      </div>
    </div>
  );
};
