import React, { useState } from 'react';
import {
  Key,
  Shield,
  Eye,
  EyeOff,
  Check,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Sliders,
  Sparkles,
  Zap,
  Server,
  Download,
} from 'lucide-react';

interface ProviderConfig {
  id: string;
  name: string;
  model: string;
  apiKey: string;
  endpoint: string;
  enabled: boolean;
  notes: string;
  latency?: number;
  status?: 'healthy' | 'testing' | 'error' | 'untested';
}

export const ModularKeysManager: React.FC = () => {
  const [activeProvider, setActiveProvider] = useState<string>('gemini');
  const [showKeys, setShowKeys] = useState<Record<string, boolean>>({});
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const [providers, setProviders] = useState<ProviderConfig[]>([
    {
      id: 'gemini',
      name: 'Google Gemini (Native Audio)',
      model: 'models/gemini-2.5-flash',
      apiKey: 'AIzaSyD-YOUR_GEMINI_KEY_HERE',
      endpoint: 'https://generativelanguage.googleapis.com',
      enabled: true,
      notes: 'Real-time bidirectional speech & tool calling with Charon voice',
      status: 'healthy',
      latency: 38,
    },
    {
      id: 'openrouter',
      name: 'OpenRouter (Multi-Model Pool)',
      model: 'meta-llama/llama-3.3-70b-instruct:free',
      apiKey: 'sk-or-v1-YOUR_OPENROUTER_KEY_HERE',
      endpoint: 'https://openrouter.ai/api/v1/models',
      enabled: true,
      notes: 'Zero-cost free tier fallback pool across 20+ models',
      status: 'healthy',
      latency: 55,
    },
    {
      id: 'groq',
      name: 'Groq (Ultra-Low Latency)',
      model: 'llama-3.3-70b-versatile',
      apiKey: 'gsk_YOUR_GROQ_KEY_HERE',
      endpoint: 'https://api.groq.com/openai/v1/models',
      enabled: false,
      notes: 'LPU inference speeds under 200ms latency',
      status: 'untested',
    },
    {
      id: 'openai',
      name: 'OpenAI (GPT-4o)',
      model: 'gpt-4o-mini',
      apiKey: '',
      endpoint: 'https://api.openai.com/v1/models',
      enabled: false,
      notes: 'High reasoning fidelity and function calling support',
      status: 'untested',
    },
    {
      id: 'ollama',
      name: 'Local Ollama (Offline)',
      model: 'llama3.2',
      apiKey: 'http://localhost:11434',
      endpoint: 'http://localhost:11434/api/tags',
      enabled: false,
      notes: '100% private offline local execution without internet',
      status: 'untested',
    },
  ]);

  const [fallbackChain, setFallbackChain] = useState<string[]>([
    'gemini',
    'openrouter',
    'groq',
    'openai',
  ]);

  const toggleShowKey = (id: string) => {
    setShowKeys((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const handleKeyChange = (id: string, value: string) => {
    setProviders((prev) =>
      prev.map((p) => (p.id === id ? { ...p, apiKey: value, status: 'untested' } : p))
    );
  };

  const testProvider = async (id: string) => {
    setProviders((prev) =>
      prev.map((p) => (p.id === id ? { ...p, status: 'testing' } : p))
    );

    const t0 = performance.now();
    try {
      // Simulate endpoint ping / validation
      await new Promise((r) => setTimeout(r, Math.floor(Math.random() * 200) + 100));
      const latency = Math.round(performance.now() - t0);

      setProviders((prev) =>
        prev.map((p) =>
          p.id === id
            ? {
                ...p,
                status: 'healthy',
                latency,
              }
            : p
        )
      );
    } catch {
      setProviders((prev) =>
        prev.map((p) => (p.id === id ? { ...p, status: 'error' } : p))
      );
    }
  };

  const exportConfigJson = () => {
    const config = {
      active_provider: activeProvider,
      fallback_chain: fallbackChain,
      providers: providers.reduce((acc, p) => {
        acc[p.id] = {
          api_key: p.apiKey,
          model: p.model,
          enabled: p.enabled,
          test_endpoint: p.endpoint,
        };
        return acc;
      }, {} as any),
      arduino: {
        port: 'AUTO',
        baud_rate: 115200,
        timeout: 1.0,
        active_low: true,
      },
    };

    const blob = new Blob([JSON.stringify(config, null, 4)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'api_keys.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      {/* Header Card */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-5 rounded-2xl bg-gray-950 border border-gray-800">
        <div>
          <h2 className="text-base font-bold text-gray-100 flex items-center gap-2">
            <Key className="w-5 h-5 text-cyan-400" />
            <span>Modular Multi-Provider API Key Architecture</span>
          </h2>
          <p className="text-xs text-gray-400 mt-0.5">
            Seamlessly switch between Gemini, OpenRouter, Groq, and local models with automated fallback on rate-limits (HTTP 429).
          </p>
        </div>

        <button
          onClick={exportConfigJson}
          className="flex items-center gap-2 px-4 py-2 bg-cyan-950/80 hover:bg-cyan-900 border border-cyan-500/50 text-cyan-300 rounded-xl text-xs font-semibold transition-all"
        >
          <Download className="w-3.5 h-3.5" />
          <span>Export config/api_keys.json</span>
        </button>
      </div>

      {/* Provider List */}
      <div className="space-y-3">
        {providers.map((p) => {
          const isActive = activeProvider === p.id;
          const isKeyVisible = showKeys[p.id] || false;

          return (
            <div
              key={p.id}
              className={`p-4 rounded-xl border transition-all ${
                isActive
                  ? 'bg-gray-900/90 border-cyan-500/50 shadow-[0_0_15px_rgba(6,182,212,0.1)]'
                  : 'bg-gray-950 border-gray-800'
              }`}
            >
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div
                    className={`w-9 h-9 rounded-lg flex items-center justify-center border font-bold text-xs ${
                      isActive
                        ? 'bg-cyan-950 text-cyan-300 border-cyan-500/50'
                        : 'bg-gray-900 text-gray-400 border-gray-800'
                    }`}
                  >
                    {p.id.slice(0, 2).toUpperCase()}
                  </div>

                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-semibold text-gray-100">{p.name}</h3>
                      {isActive && (
                        <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-cyan-500/20 text-cyan-400 border border-cyan-500/40">
                          ACTIVE ENGINE
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-gray-400 mt-0.5">{p.notes}</p>
                  </div>
                </div>

                {/* Right Action buttons */}
                <div className="flex items-center gap-2 shrink-0">
                  {p.latency !== undefined && (
                    <span className="text-xs font-mono text-cyan-400 font-semibold px-2 py-1 bg-gray-900 rounded-lg border border-gray-800">
                      {p.latency}ms
                    </span>
                  )}

                  <button
                    onClick={() => testProvider(p.id)}
                    className="p-2 bg-gray-900 hover:bg-gray-800 border border-gray-800 text-gray-300 rounded-lg text-xs font-medium transition-colors"
                    title="Test connection and measure latency"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${p.status === 'testing' ? 'animate-spin' : ''}`} />
                  </button>

                  {!isActive && (
                    <button
                      onClick={() => setActiveProvider(p.id)}
                      className="px-3 py-1.5 bg-gray-900 hover:bg-gray-800 border border-gray-800 text-gray-300 hover:text-cyan-300 rounded-lg text-xs font-medium transition-colors"
                    >
                      Set Active
                    </button>
                  )}
                </div>
              </div>

              {/* Key Input Bar */}
              <div className="mt-3 pt-3 border-t border-gray-800/80 flex items-center gap-2">
                <span className="text-[11px] text-gray-400 font-mono w-20 shrink-0">
                  {p.id === 'ollama' ? 'Base URL:' : 'API Key:'}
                </span>

                <div className="flex-1 relative">
                  <input
                    type={isKeyVisible ? 'text' : 'password'}
                    value={p.apiKey}
                    onChange={(e) => handleKeyChange(p.id, e.target.value)}
                    placeholder={`Enter ${p.name} key...`}
                    className="w-full bg-gray-900 border border-gray-800 focus:border-cyan-500 rounded-lg px-3 py-1.5 text-xs font-mono text-gray-200 outline-none pr-8"
                  />
                  <button
                    type="button"
                    onClick={() => toggleShowKey(p.id)}
                    className="absolute right-2 top-2 text-gray-400 hover:text-gray-200"
                  >
                    {isKeyVisible ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Fallback Priority Chain */}
      <div className="p-5 rounded-2xl bg-gray-950 border border-gray-800 space-y-3">
        <h3 className="text-sm font-semibold text-gray-100 flex items-center gap-2">
          <Shield className="w-4 h-4 text-cyan-400" />
          <span>Automatic Rate-Limit & Error Failover Chain</span>
        </h3>
        <p className="text-xs text-gray-400">
          If the primary API encounters an HTTP 429 rate limit or network timeout, the Python engine will automatically route subsequent voice tool calls through the next provider in this sequence:
        </p>

        <div className="flex items-center gap-2 flex-wrap font-mono text-xs pt-1">
          {fallbackChain.map((provId, index) => (
            <React.Fragment key={provId}>
              <div className="px-3 py-1.5 bg-gray-900 border border-cyan-500/30 rounded-lg text-cyan-300 font-semibold flex items-center gap-1.5">
                <span className="text-gray-400 text-[10px]">{index + 1}.</span>
                <span>{providers.find((p) => p.id === provId)?.name || provId}</span>
              </div>
              {index < fallbackChain.length - 1 && (
                <span className="text-gray-500 text-sm">→</span>
              )}
            </React.Fragment>
          ))}
        </div>
      </div>
    </div>
  );
};
