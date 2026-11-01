import React from 'react';
import { Cpu, Usb, Volume2, VolumeX, ShieldCheck, Activity } from 'lucide-react';
import { serialService } from '../utils/serialService';
import { audioFX } from '../utils/audioFX';

interface HeaderProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  serialMode: 'hardware' | 'simulated' | 'disconnected';
  isMuted: boolean;
  setIsMuted: (muted: boolean) => void;
  serialRtt: number;
}

export const Header: React.FC<HeaderProps> = ({
  activeTab,
  setActiveTab,
  serialMode,
  isMuted,
  setIsMuted,
  serialRtt,
}) => {
  const handleConnect = async () => {
    if (serialMode === 'hardware') {
      await serialService.disconnect();
    } else {
      await serialService.connectHardware();
    }
  };

  const navItems = [
    { id: 'relays', label: 'Relay Deck' },
    { id: 'voice', label: 'Voice & Parsing' },
    { id: 'keys', label: 'Modular Keys' },
    { id: 'latency', label: 'Latency & Delay' },
    { id: 'vscode', label: 'VS Code Files' },
    { id: 'terminal', label: 'Serial Monitor' },
  ];

  return (
    <header className="flex items-center justify-between gap-8 px-6 py-3.5 bg-gray-950 border-b border-gray-800 text-gray-100 select-none">
      {/* Zone 1: Single Brand Wordmark */}
      <div className="flex items-center gap-3 shrink-0">
        <div className="w-8 h-8 rounded-lg bg-cyan-950/80 border border-cyan-500/40 flex items-center justify-center text-cyan-400">
          <Cpu className="w-4 h-4" />
        </div>
        <div className="flex flex-col">
          <span className="text-base font-bold tracking-tight text-cyan-400 whitespace-nowrap">
            JARVIS · Automation Core
          </span>
          <span className="text-[10px] text-gray-400 tracking-wider">
            ARDUINO V2.0 RELAY PROTOCOL
          </span>
        </div>
      </div>

      {/* Zone 2: Navigation Links */}
      <nav className="hidden lg:flex items-center gap-6 text-xs font-medium text-gray-300">
        {navItems.map((item) => {
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id)}
              className={`transition-colors whitespace-nowrap shrink-0 py-1 border-b-2 ${
                isActive
                  ? 'border-cyan-400 text-cyan-300 font-semibold'
                  : 'border-transparent text-gray-400 hover:text-gray-100'
              }`}
            >
              {item.label}
            </button>
          );
        })}
      </nav>

      {/* Zone 3: Primary Action & Hardware Status */}
      <div className="flex items-center gap-3 shrink-0">
        {/* Latency badge */}
        <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 bg-gray-900 border border-gray-800 rounded-md text-[11px] text-gray-300 font-mono">
          <Activity className="w-3 h-3 text-cyan-400" />
          <span>{serialRtt > 0 ? `${serialRtt}ms RTT` : 'Idle'}</span>
        </div>

        {/* Audio Mute Button */}
        <button
          onClick={() => {
            const next = !isMuted;
            setIsMuted(next);
            audioFX.setMuted(next);
          }}
          className={`p-2 rounded-lg border transition-colors ${
            isMuted
              ? 'bg-red-950/40 border-red-800 text-red-400 hover:bg-red-900/40'
              : 'bg-gray-900 border-gray-800 text-gray-300 hover:text-cyan-400'
          }`}
          title={isMuted ? 'Unmute relay clicks & voice' : 'Mute audio feedback'}
          aria-label={isMuted ? 'Unmute audio' : 'Mute audio'}
        >
          {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
        </button>

        {/* Arduino Connect CTA */}
        <button
          onClick={handleConnect}
          className={`flex items-center gap-2 px-3.5 py-1.5 text-xs font-semibold rounded-lg border transition-all whitespace-nowrap shrink-0 ${
            serialMode === 'hardware'
              ? 'bg-emerald-950/60 border-emerald-500/50 text-emerald-300 hover:bg-emerald-900/60 shadow-[0_0_12px_rgba(16,185,129,0.2)]'
              : 'bg-cyan-950/60 border-cyan-500/50 text-cyan-300 hover:bg-cyan-900/60 shadow-[0_0_12px_rgba(6,182,212,0.15)]'
          }`}
        >
          <Usb className="w-3.5 h-3.5" />
          <span>
            {serialMode === 'hardware' ? 'Arduino USB Connected' : 'Connect Real Arduino'}
          </span>
        </button>
      </div>
    </header>
  );
};
