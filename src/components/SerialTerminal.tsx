import React, { useState, useEffect, useRef } from 'react';
import {
  Terminal,
  Trash2,
  Send,
  Filter,
  CheckCircle2,
  AlertTriangle,
  ArrowUpRight,
  ArrowDownLeft,
  Info,
} from 'lucide-react';
import { serialService, SerialLogEntry } from '../utils/serialService';

export const SerialTerminal: React.FC = () => {
  const [logs, setLogs] = useState<SerialLogEntry[]>(() => serialService.getLogHistory());
  const [filter, setFilter] = useState<'ALL' | 'TX' | 'RX' | 'ERR'>('ALL');
  const [inputCmd, setInputCmd] = useState('');
  const [autoScroll, setAutoScroll] = useState(true);

  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Only subscribe to new entries, or update if changed
    const unsubscribe = serialService.subscribeLog((entry) => {
      setLogs((prev) => {
        if (prev.some((e) => e.id === entry.id)) return prev;
        return [...prev.slice(-250), entry];
      });
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs, autoScroll]);

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputCmd.trim()) return;
    serialService.sendPacket(inputCmd);
    setInputCmd('');
  };

  const filteredLogs = logs.filter((l) => {
    if (filter === 'ALL') return true;
    return l.direction === filter;
  });

  const quickPackets = [
    'RELAY:7:1',
    'RELAY:7:0',
    'FAN_SPEED:80',
    'ALL:1',
    'ALL:0',
    'STATUS',
    'PING',
    'RESET',
  ];

  return (
    <div className="space-y-4">
      {/* Terminal Container */}
      <div className="rounded-2xl bg-gray-950 border border-gray-800 flex flex-col overflow-hidden shadow-2xl">
        {/* Terminal Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-4 py-3 bg-gray-900/90 border-b border-gray-800">
          <div className="flex items-center gap-2">
            <Terminal className="w-4 h-4 text-cyan-400" />
            <span className="text-xs font-mono font-bold text-gray-200">
              Arduino Serial Monitor (115200 baud)
            </span>
            <span className="text-[11px] font-mono text-gray-400">
              [{serialService.getPortName() || 'Active'}]
            </span>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {/* Filter Tabs */}
            <div className="flex items-center bg-gray-950 p-0.5 rounded-lg border border-gray-800 text-[11px] font-mono">
              {(['ALL', 'TX', 'RX', 'ERR'] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`px-2.5 py-1 rounded-md transition-colors ${
                    filter === f
                      ? 'bg-cyan-500/20 text-cyan-300 font-semibold border border-cyan-500/40'
                      : 'text-gray-400 hover:text-gray-200'
                  }`}
                >
                  {f}
                </button>
              ))}
            </div>

            {/* Clear Button */}
            <button
              onClick={() => setLogs([])}
              className="p-1.5 bg-gray-950 hover:bg-gray-800 border border-gray-800 text-gray-400 hover:text-red-400 rounded-lg text-xs transition-colors"
              title="Clear terminal log"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Logs Output Box */}
        <div
          ref={scrollRef}
          className="p-4 h-[420px] overflow-y-auto font-mono text-xs space-y-1.5 bg-black/60 select-text"
        >
          {filteredLogs.length === 0 ? (
            <div className="text-gray-400 py-12 text-center text-xs">
              No serial traffic logged yet. Packets sent and received will appear here with millisecond timestamps.
            </div>
          ) : (
            filteredLogs.map((entry) => {
              let badgeColor = 'text-gray-400 bg-gray-900';
              let Icon = Info;

              if (entry.direction === 'TX') {
                badgeColor = 'text-amber-300 bg-amber-950/60 border-amber-800/40';
                Icon = ArrowUpRight;
              } else if (entry.direction === 'RX') {
                badgeColor = 'text-emerald-300 bg-emerald-950/60 border-emerald-800/40';
                Icon = ArrowDownLeft;
              } else if (entry.direction === 'ERR') {
                badgeColor = 'text-red-400 bg-red-950/60 border-red-800/40';
                Icon = AlertTriangle;
              } else if (entry.direction === 'SYS') {
                badgeColor = 'text-cyan-300 bg-cyan-950/60 border-cyan-800/40';
                Icon = CheckCircle2;
              }

              return (
                <div
                  key={entry.id}
                  className="flex items-start gap-2.5 py-1 px-2 rounded hover:bg-gray-900/50 transition-colors"
                >
                  <span className="text-[10px] text-gray-400 shrink-0 select-none pt-0.5">
                    {entry.timestamp}
                  </span>

                  <span
                    className={`px-1.5 py-0.5 rounded text-[10px] font-bold border shrink-0 flex items-center gap-1 ${badgeColor}`}
                  >
                    <Icon className="w-2.5 h-2.5" />
                    <span>{entry.direction}</span>
                  </span>

                  <span className="text-gray-200 break-all">{entry.text}</span>

                  {entry.latencyMs !== undefined && (
                    <span className="ml-auto text-[10px] text-cyan-400 font-bold shrink-0">
                      {entry.latencyMs}ms
                    </span>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Manual Command Send Bar */}
        <form onSubmit={handleSend} className="p-3 bg-gray-900 border-t border-gray-800 flex items-center gap-2">
          <input
            type="text"
            value={inputCmd}
            onChange={(e) => setInputCmd(e.target.value)}
            placeholder="Type raw Arduino packet: RELAY:7:1, FAN_SPEED:60, STATUS, PING..."
            className="flex-1 bg-gray-950 border border-gray-800 focus:border-cyan-500 rounded-xl px-3 py-2 text-xs font-mono text-gray-200 outline-none"
          />
          <button
            type="submit"
            className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-gray-950 font-semibold rounded-xl text-xs transition-colors flex items-center gap-1.5 shrink-0"
          >
            <span>Send</span>
            <Send className="w-3.5 h-3.5" />
          </button>
        </form>
      </div>

      {/* Quick Packet Triggers */}
      <div className="flex items-center gap-2 flex-wrap text-xs font-mono">
        <span className="text-gray-400 text-[11px]">Send quick packet:</span>
        {quickPackets.map((pkt) => (
          <button
            key={pkt}
            onClick={() => serialService.sendPacket(pkt)}
            className="px-2.5 py-1 bg-gray-900 hover:bg-gray-800 border border-gray-800 hover:border-cyan-500/50 rounded-lg text-cyan-300 text-xs transition-colors"
          >
            {pkt}
          </button>
        ))}
      </div>
    </div>
  );
};
