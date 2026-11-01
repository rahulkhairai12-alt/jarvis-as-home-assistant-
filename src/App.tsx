/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import {
  DEFAULT_DEVICES,
  DeviceMapping,
  ParsedCommand,
} from './utils/homeAutomationParser';
import { serialService } from './utils/serialService';
import { Header } from './components/Header';
import { RelayDeck } from './components/RelayDeck';
import { VoiceCommandCenter } from './components/VoiceCommandCenter';
import { ModularKeysManager } from './components/ModularKeysManager';
import { LatencyMonitor } from './components/LatencyMonitor';
import { VsCodeExportHub } from './components/VsCodeExportHub';
import { SerialTerminal } from './components/SerialTerminal';
import {
  Activity,
  Cpu,
  Power,
  FolderOpen,
  Volume2,
  VolumeX,
  ShieldAlert,
} from 'lucide-react';

export default function App() {
  const [activeTab, setActiveTab] = useState('relays');
  const [devices, setDevices] = useState<DeviceMapping[]>(DEFAULT_DEVICES);
  const [fanSpeed, setFanSpeed] = useState<number>(50);
  const [serialMode, setSerialMode] = useState<'hardware' | 'simulated' | 'disconnected'>('simulated');
  const [portName, setPortName] = useState('');
  const [isMuted, setIsMuted] = useState(false);
  const [serialRtt, setSerialRtt] = useState<number>(2.1);

  useEffect(() => {
    // 1. Subscribe to serial state changes
    const unsubState = serialService.subscribeState((pin, state, speed) => {
      setDevices((prev) =>
        prev.map((d) => (d.pin === pin ? { ...d, state } : d))
      );
      if (speed !== undefined) {
        setFanSpeed(speed);
      }
    });

    // 2. Subscribe to connection status
    const unsubConn = serialService.subscribeConnection((connected, mode, name) => {
      setSerialMode(mode);
      setPortName(name);
    });

    // 3. Periodic latency probe
    const interval = setInterval(() => {
      setSerialRtt(serialService.lastSerialRtt);
    }, 2000);

    return () => {
      unsubState();
      unsubConn();
      clearInterval(interval);
    };
  }, []);

  const handleToggleRelay = (pin: number, nextState: boolean) => {
    serialService.sendPacket(`RELAY:${pin}:${nextState ? 1 : 0}\n`);
  };

  const handleSetFanSpeed = (speed: number) => {
    setFanSpeed(speed);
    serialService.sendPacket(`FAN_SPEED:${speed}\n`);
  };

  const handleExecuteVoiceCommand = (cmd: ParsedCommand) => {
    if (cmd.action === 'ALL_ON') {
      setDevices((prev) => prev.map((d) => ({ ...d, state: true })));
    } else if (cmd.action === 'ALL_OFF') {
      setDevices((prev) => prev.map((d) => ({ ...d, state: false })));
      setFanSpeed(0);
    } else if (cmd.targetPin !== undefined && cmd.targetState !== undefined) {
      setDevices((prev) =>
        prev.map((d) => (d.pin === cmd.targetPin ? { ...d, state: cmd.targetState! } : d))
      );
    }
  };

  const activeRelaysCount = devices.filter((d) => d.state).length;

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 flex flex-col font-sans selection:bg-cyan-500/30 selection:text-cyan-200">
      {/* 3-Zone Top Bar */}
      <Header
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        serialMode={serialMode}
        isMuted={isMuted}
        setIsMuted={setIsMuted}
        serialRtt={serialRtt}
      />

      {/* Main Content Viewport */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 md:p-6 pb-20">
        {/* Navigation Tabs for Mobile / Compact Viewports */}
        <div className="flex lg:hidden overflow-x-auto gap-2 pb-3 mb-4 text-xs font-mono border-b border-gray-800">
          {[
            { id: 'relays', label: 'Relays' },
            { id: 'voice', label: 'Voice Parser' },
            { id: 'keys', label: 'Modular Keys' },
            { id: 'latency', label: 'Latency & Delay' },
            { id: 'vscode', label: 'VS Code Files' },
            { id: 'terminal', label: 'Serial Monitor' },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-3 py-1.5 rounded-lg whitespace-nowrap transition-colors ${
                activeTab === tab.id
                  ? 'bg-cyan-500/20 text-cyan-300 font-semibold border border-cyan-500/40'
                  : 'bg-gray-900 text-gray-400 hover:text-gray-200'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* View Routing */}
        {activeTab === 'relays' && (
          <RelayDeck
            devices={devices}
            onToggleRelay={handleToggleRelay}
            onSetFanSpeed={handleSetFanSpeed}
            fanSpeed={fanSpeed}
          />
        )}

        {activeTab === 'voice' && (
          <VoiceCommandCenter
            devices={devices}
            onExecuteCommand={handleExecuteVoiceCommand}
            isMuted={isMuted}
          />
        )}

        {activeTab === 'keys' && <ModularKeysManager />}

        {activeTab === 'latency' && <LatencyMonitor serialRtt={serialRtt} />}

        {activeTab === 'vscode' && <VsCodeExportHub />}

        {activeTab === 'terminal' && <SerialTerminal />}
      </main>

      {/* Footer System Telemetry Status Bar */}
      <footer className="fixed bottom-0 left-0 right-0 h-9 bg-gray-950/95 backdrop-blur border-t border-gray-800 px-4 md:px-6 flex items-center justify-between text-[11px] font-mono text-gray-400 z-50">
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1.5 text-gray-300">
            <Cpu className="w-3.5 h-3.5 text-cyan-400" />
            <span className="hidden sm:inline">SERIAL PROTOCOL:</span>
            <span className="text-cyan-400 font-bold uppercase">{serialMode}</span>
          </span>
          <span className="text-gray-600">|</span>
          <span className="text-gray-300">
            RELAYS ON: <strong className="text-emerald-400">{activeRelaysCount} / 6</strong>
          </span>
        </div>

        <div className="flex items-center gap-4">
          <span className="hidden md:flex items-center gap-1.5">
            <Activity className="w-3 h-3 text-cyan-400" />
            <span>SERIAL RTT:</span>
            <strong className="text-cyan-300">{serialRtt}ms</strong>
          </span>

          <span className="text-gray-600 hidden md:inline">|</span>

          <button
            onClick={() => setActiveTab('vscode')}
            className="flex items-center gap-1 text-gray-400 hover:text-cyan-300 transition-colors"
          >
            <FolderOpen className="w-3 h-3 text-cyan-400" />
            <span>VS CODE EXPORT READY</span>
          </button>
        </div>
      </footer>
    </div>
  );
}
