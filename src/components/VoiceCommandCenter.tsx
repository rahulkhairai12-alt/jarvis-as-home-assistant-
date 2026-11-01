import React, { useState, useEffect, useRef } from 'react';
import {
  Mic,
  MicOff,
  Send,
  Zap,
  ArrowRight,
  Sparkles,
  Volume2,
  CheckCircle2,
  Clock,
  Terminal,
  Cpu,
} from 'lucide-react';
import {
  parseHomeAutomationCommand,
  ParsedCommand,
  DeviceMapping,
} from '../utils/homeAutomationParser';
import { serialService } from '../utils/serialService';
import { audioFX } from '../utils/audioFX';

interface VoiceCommandCenterProps {
  devices: DeviceMapping[];
  onExecuteCommand: (cmd: ParsedCommand) => void;
  isMuted: boolean;
}

export const VoiceCommandCenter: React.FC<VoiceCommandCenterProps> = ({
  devices,
  onExecuteCommand,
  isMuted,
}) => {
  const [inputText, setInputText] = useState('');
  const [isListening, setIsListening] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(false);
  const [lastParsed, setLastParsed] = useState<ParsedCommand | null>(null);
  const [executionLog, setExecutionLog] = useState<
    Array<{ id: string; time: string; query: string; packet: string; response: string; rtt: number }>
  >([]);

  const recognitionRef = useRef<any>(null);

  useEffect(() => {
    // Check Web Speech API support
    const SpeechRec =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (SpeechRec) {
      setSpeechSupported(true);
      const rec = new SpeechRec();
      rec.continuous = false;
      rec.interimResults = false;
      rec.lang = 'en-US';

      rec.onstart = () => setIsListening(true);
      rec.onend = () => setIsListening(false);
      rec.onerror = () => setIsListening(false);

      rec.onresult = (event: any) => {
        const transcript = event.results[0][0].transcript;
        setInputText(transcript);
        handleProcessCommand(transcript);
      };

      recognitionRef.current = rec;
    }
  }, []);

  const toggleListening = () => {
    if (!speechSupported || !recognitionRef.current) return;
    if (isListening) {
      recognitionRef.current.stop();
    } else {
      try {
        recognitionRef.current.start();
      } catch {}
    }
  };

  const handleProcessCommand = async (text: string) => {
    if (!text.trim()) return;

    const t0 = performance.now();
    const parsed = parseHomeAutomationCommand(text, devices);
    setLastParsed(parsed);

    if (parsed.matched && parsed.serialPacket) {
      // 1. Send packet to Arduino via serial
      await serialService.sendPacket(parsed.serialPacket);
      const rtt = Math.round((performance.now() - t0) * 10) / 10;

      // 2. Audio feedback chime
      audioFX.playChime(true);

      // 3. Speech synthesis if unmuted
      if (!isMuted && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(parsed.speechResponse);
        utterance.rate = 1.05;
        utterance.pitch = 0.95;
        window.speechSynthesis.speak(utterance);
      }

      // 4. Update log history
      setExecutionLog((prev) => [
        {
          id: Math.random().toString(),
          time: new Date().toLocaleTimeString(),
          query: text,
          packet: parsed.serialPacket.trim(),
          response: parsed.speechResponse,
          rtt,
        },
        ...prev.slice(0, 15),
      ]);

      // 5. Notify parent to update devices
      onExecuteCommand(parsed);
    } else {
      audioFX.playChime(false);
    }

    setInputText('');
  };

  const sampleCommands = [
    'on light',
    'turn off light',
    'on fan',
    'fan speed 3',
    'fan speed 80',
    'turn on ac',
    'kitchen light off',
    'water pump on',
    'party mode',
    'goodnight',
    'ping',
  ];

  return (
    <div className="space-y-6">
      {/* Voice & Prompt Input Card */}
      <div className="p-6 rounded-2xl bg-gray-950 border border-gray-800 shadow-xl relative overflow-hidden">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-4">
          <div>
            <h2 className="text-base font-bold text-gray-100 flex items-center gap-2">
              <Zap className="w-5 h-5 text-cyan-400" />
              <span>Voice & Natural Language Command Center</span>
            </h2>
            <p className="text-xs text-gray-400 mt-1">
              Speaks or types direct appliance commands like &quot;on light&quot; or &quot;on fan&quot;. Parsed in &lt; 2ms.
            </p>
          </div>

          {speechSupported && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-400">
                {isListening ? 'Listening for speech...' : 'Microphone Ready'}
              </span>
              <button
                onClick={toggleListening}
                className={`p-3 rounded-full border transition-all duration-200 relative ${
                  isListening
                    ? 'bg-red-950/80 border-red-500 text-red-400 animate-pulse shadow-[0_0_15px_rgba(239,68,68,0.4)]'
                    : 'bg-cyan-950/60 border-cyan-500/50 text-cyan-400 hover:bg-cyan-900/60'
                }`}
                title={isListening ? 'Stop listening' : 'Start voice recognition'}
                aria-label={isListening ? 'Stop listening' : 'Start voice recognition'}
              >
                {isListening ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
              </button>
            </div>
          )}
        </div>

        {/* Input Bar */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleProcessCommand(inputText);
          }}
          className="flex items-center gap-2"
        >
          <input
            type="text"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            placeholder='Try typing "on light", "on fan", "fan speed 3", "ac on", "party mode"...'
            className="flex-1 bg-gray-900 border border-gray-800 focus:border-cyan-500 rounded-xl px-4 py-3 text-sm text-gray-100 placeholder-gray-500 outline-none transition-colors"
          />
          <button
            type="submit"
            className="px-5 py-3 bg-cyan-600 hover:bg-cyan-500 text-gray-950 font-semibold rounded-xl text-sm transition-colors flex items-center gap-2 shrink-0"
          >
            <span>Execute</span>
            <Send className="w-4 h-4" />
          </button>
        </form>

        {/* Quick Suggestion Pills */}
        <div className="flex items-center gap-2 mt-4 flex-wrap">
          <span className="text-xs text-gray-400 font-medium">Quick commands:</span>
          {sampleCommands.map((cmd) => (
            <button
              key={cmd}
              onClick={() => handleProcessCommand(cmd)}
              className="px-2.5 py-1 rounded-lg bg-gray-900 hover:bg-gray-800 border border-gray-800 hover:border-cyan-500/50 text-xs font-mono text-gray-300 transition-colors"
            >
              &quot;{cmd}&quot;
            </button>
          ))}
        </div>
      </div>

      {/* String Parsing Deep-Dive Breakdown */}
      {lastParsed && (
        <div className="p-5 rounded-2xl bg-gray-950 border border-cyan-500/30 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-cyan-300 flex items-center gap-2">
              <Cpu className="w-4 h-4 text-cyan-400" />
              <span>Real-Time String Parsing & Protocol Deconstruction</span>
            </h3>
            <span className="text-xs font-mono px-2 py-0.5 rounded bg-cyan-950 text-cyan-400 border border-cyan-800">
              Confidence: {Math.round(lastParsed.confidence * 100)}%
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-3 text-xs font-mono">
            <div className="p-3 bg-gray-900 rounded-xl border border-gray-800">
              <span className="text-gray-400 text-[11px] block mb-1">1. Raw Input Query</span>
              <span className="text-gray-100 font-semibold">&quot;{lastParsed.raw}&quot;</span>
            </div>

            <div className="p-3 bg-gray-900 rounded-xl border border-gray-800">
              <span className="text-gray-400 text-[11px] block mb-1">2. Target Device & Pin</span>
              <span className="text-cyan-400 font-semibold">
                {lastParsed.targetDevice ? `${lastParsed.targetDevice.name} (Pin ${lastParsed.targetPin})` : 'Global / Multi-pin'}
              </span>
            </div>

            <div className="p-3 bg-gray-900 rounded-xl border border-gray-800">
              <span className="text-gray-400 text-[11px] block mb-1">3. Resolved Action</span>
              <span className="text-emerald-400 font-semibold">
                {lastParsed.action} {lastParsed.speedValue ? `(${lastParsed.speedValue}%)` : ''}
              </span>
            </div>

            <div className="p-3 bg-gray-900 rounded-xl border border-gray-800">
              <span className="text-gray-400 text-[11px] block mb-1">4. Serial Packet (TX)</span>
              <span className="text-amber-400 font-bold font-mono">
                {lastParsed.serialPacket ? lastParsed.serialPacket.trim() : 'NONE'}
              </span>
            </div>
          </div>

          {/* Speech Response */}
          <div className="p-3 bg-cyan-950/40 rounded-xl border border-cyan-800/40 flex items-center gap-3 text-xs text-cyan-200">
            <Volume2 className="w-4 h-4 text-cyan-400 shrink-0" />
            <span>
              <strong>JARVIS Speech:</strong> &quot;{lastParsed.speechResponse}&quot;
            </span>
          </div>
        </div>
      )}

      {/* Execution History Table */}
      <div className="p-5 rounded-2xl bg-gray-950 border border-gray-800 space-y-3">
        <h3 className="text-sm font-semibold text-gray-200 flex items-center gap-2">
          <Terminal className="w-4 h-4 text-cyan-400" />
          <span>Recent Command Execution History</span>
        </h3>

        {executionLog.length === 0 ? (
          <p className="text-xs text-gray-400 py-4 text-center">
            No commands executed yet. Try clicking &quot;on light&quot; or speaking above.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs font-mono">
              <thead>
                <tr className="border-b border-gray-800 text-gray-400 text-[11px]">
                  <th className="py-2 px-3">Time</th>
                  <th className="py-2 px-3">Voice/Text Prompt</th>
                  <th className="py-2 px-3">Arduino Serial Packet</th>
                  <th className="py-2 px-3">Status</th>
                  <th className="py-2 px-3 text-right">RTT Latency</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800/60">
                {executionLog.map((log) => (
                  <tr key={log.id} className="hover:bg-gray-900/50 transition-colors">
                    <td className="py-2 px-3 text-gray-400">{log.time}</td>
                    <td className="py-2 px-3 text-gray-200 font-medium">{log.query}</td>
                    <td className="py-2 px-3 text-amber-400 font-bold">{log.packet}</td>
                    <td className="py-2 px-3 text-emerald-400 flex items-center gap-1">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>Triggered</span>
                    </td>
                    <td className="py-2 px-3 text-right text-cyan-400 font-bold">
                      {log.rtt}ms
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
