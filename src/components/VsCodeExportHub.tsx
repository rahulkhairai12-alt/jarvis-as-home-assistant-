import React, { useState } from 'react';
import {
  FileCode,
  Download,
  Copy,
  Check,
  FolderOpen,
  Terminal,
  ExternalLink,
  BookOpen,
  ShieldCheck,
} from 'lucide-react';
import JSZip from 'jszip';
import {
  ARDUINO_CONTROLLER_PY,
  MODULAR_KEYS_PY,
  MAIN_AUTOMATION_PY,
  ARDUINO_INO,
  REQUIREMENTS_TXT,
  API_KEYS_JSON_TEMPLATE,
  SETUP_GUIDE_MD,
} from '../data/projectTemplates';

interface ProjectFile {
  name: string;
  path: string;
  language: string;
  content: string;
  description: string;
}

export const VsCodeExportHub: React.FC = () => {
  const [activeFileIndex, setActiveFileIndex] = useState(0);
  const [copied, setCopied] = useState(false);
  const [isZipping, setIsZipping] = useState(false);

  const files: ProjectFile[] = [
    {
      name: 'arduino_controller.py',
      path: 'home_automation/arduino_controller.py',
      language: 'python',
      content: ARDUINO_CONTROLLER_PY,
      description: 'Asynchronous serial protocol, USB auto-discovery, string parser, and RTT latency tracker.',
    },
    {
      name: 'modular_keys.py',
      path: 'core/modular_keys.py',
      language: 'python',
      content: MODULAR_KEYS_PY,
      description: 'Multi-provider key manager for Gemini, OpenRouter, Groq, OpenAI with automated fallback.',
    },
    {
      name: 'main.py',
      path: 'main.py',
      language: 'python',
      content: MAIN_AUTOMATION_PY,
      description: 'Integrated voice assistant with real-time speech streaming and home automation tools.',
    },
    {
      name: 'jarvis_home_automation.ino',
      path: 'arduino/jarvis_home_automation.ino',
      language: 'cpp',
      content: ARDUINO_INO,
      description: 'Complete Arduino sketch for 6-channel active-LOW relay modules + fan PWM control.',
    },
    {
      name: 'api_keys.json',
      path: 'config/api_keys.json',
      language: 'json',
      content: API_KEYS_JSON_TEMPLATE,
      description: 'Configuration file with API keys, baud rate, and priority fallback sequence.',
    },
    {
      name: 'requirements.txt',
      path: 'requirements.txt',
      language: 'text',
      content: REQUIREMENTS_TXT,
      description: 'Python dependencies (pyserial, google-genai, PyQt6, requests, etc.).',
    },
    {
      name: 'SETUP_GUIDE.md',
      path: 'SETUP_GUIDE.md',
      language: 'markdown',
      content: SETUP_GUIDE_MD,
      description: 'Hardware wiring diagram, pin connections, AC mains safety, and VS Code steps.',
    },
  ];

  const currentFile = files[activeFileIndex];

  const handleCopy = () => {
    navigator.clipboard.writeText(currentFile.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownloadZip = async () => {
    setIsZipping(true);
    try {
      const zip = new JSZip();

      // Add files to zip
      zip.file('arduino_controller.py', ARDUINO_CONTROLLER_PY);
      zip.file('modular_keys.py', MODULAR_KEYS_PY);
      zip.file('main.py', MAIN_AUTOMATION_PY);
      zip.file('jarvis_home_automation.ino', ARDUINO_INO);
      zip.file('config/api_keys.json', API_KEYS_JSON_TEMPLATE);
      zip.file('requirements.txt', REQUIREMENTS_TXT);
      zip.file('SETUP_GUIDE.md', SETUP_GUIDE_MD);

      // VS Code launcher
      zip.file(
        '.vscode/launch.json',
        JSON.stringify(
          {
            version: '0.2.0',
            configurations: [
              {
                name: 'Python: Run JARVIS Home Automation',
                type: 'debugpy',
                request: 'launch',
                program: '${workspaceFolder}/main.py',
                console: 'integratedTerminal',
              },
            ],
          },
          null,
          4
        )
      );

      const content = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(content);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'jarvis_arduino_home_automation_vscode.zip';
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setIsZipping(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Banner with 1-Click ZIP Download */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-5 rounded-2xl bg-gray-950 border border-gray-800">
        <div>
          <h2 className="text-base font-bold text-gray-100 flex items-center gap-2">
            <FolderOpen className="w-5 h-5 text-cyan-400" />
            <span>VS Code Project Files & Arduino Sketch Hub</span>
          </h2>
          <p className="text-xs text-gray-400 mt-0.5">
            Download the complete ready-to-run package with all updated Python scripts, Arduino .ino sketch, and configuration.
          </p>
        </div>

        <button
          onClick={handleDownloadZip}
          disabled={isZipping}
          className="flex items-center gap-2 px-5 py-2.5 bg-cyan-500 hover:bg-cyan-400 text-gray-950 font-bold rounded-xl text-xs transition-all shadow-[0_0_20px_rgba(6,182,212,0.25)] shrink-0"
        >
          <Download className="w-4 h-4" />
          <span>{isZipping ? 'Packaging ZIP...' : 'Download VS Code Project (.ZIP)'}</span>
        </button>
      </div>

      {/* Main File Explorer & Code Viewer */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        {/* Left: File Tree */}
        <div className="lg:col-span-1 p-3 rounded-2xl bg-gray-950 border border-gray-800 space-y-1">
          <div className="px-3 py-2 text-xs font-semibold text-gray-400 uppercase tracking-wider">
            Project Files
          </div>
          {files.map((file, idx) => {
            const isActive = activeFileIndex === idx;
            return (
              <button
                key={file.name}
                onClick={() => setActiveFileIndex(idx)}
                className={`w-full text-left px-3 py-2.5 rounded-xl text-xs font-mono transition-colors flex items-center gap-2.5 ${
                  isActive
                    ? 'bg-cyan-950/80 border border-cyan-500/40 text-cyan-300 font-semibold'
                    : 'text-gray-400 hover:bg-gray-900 hover:text-gray-200'
                }`}
              >
                <FileCode className={`w-4 h-4 ${isActive ? 'text-cyan-400' : 'text-gray-500'}`} />
                <span className="truncate">{file.name}</span>
              </button>
            );
          })}
        </div>

        {/* Right: Code Viewer */}
        <div className="lg:col-span-3 rounded-2xl bg-gray-950 border border-gray-800 flex flex-col overflow-hidden">
          {/* File Header Bar */}
          <div className="flex items-center justify-between px-4 py-3 bg-gray-900/80 border-b border-gray-800">
            <div>
              <div className="text-xs font-mono font-bold text-gray-200 flex items-center gap-2">
                <span>{currentFile.path}</span>
              </div>
              <p className="text-[11px] text-gray-400 mt-0.5">{currentFile.description}</p>
            </div>

            <button
              onClick={handleCopy}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-200 text-xs font-medium transition-colors"
            >
              {copied ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                  <span className="text-emerald-400 font-semibold">Copied!</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  <span>Copy Code</span>
                </>
              )}
            </button>
          </div>

          {/* Code Content */}
          <div className="p-4 overflow-x-auto max-h-[500px] overflow-y-auto bg-gray-950 font-mono text-xs text-gray-300 leading-relaxed">
            <pre>
              <code>{currentFile.content}</code>
            </pre>
          </div>
        </div>
      </div>

      {/* VS Code Setup Steps */}
      <div className="p-5 rounded-2xl bg-gray-950 border border-gray-800 space-y-4">
        <h3 className="text-sm font-semibold text-gray-100 flex items-center gap-2">
          <Terminal className="w-4 h-4 text-cyan-400" />
          <span>Quick 3-Step Setup in VS Code</span>
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs font-mono">
          <div className="p-4 bg-gray-900/60 rounded-xl border border-gray-800 space-y-2">
            <div className="text-cyan-400 font-bold text-sm">Step 1: Flash Arduino</div>
            <p className="text-gray-400 text-[11px] leading-relaxed">
              Open <code className="text-cyan-300">jarvis_home_automation.ino</code> in Arduino IDE. Select board (Uno/Nano) & COM Port. Click Upload. Close the IDE Serial Monitor before running Python.
            </p>
          </div>

          <div className="p-4 bg-gray-900/60 rounded-xl border border-gray-800 space-y-2">
            <div className="text-emerald-400 font-bold text-sm">Step 2: Install Python Deps</div>
            <p className="text-gray-400 text-[11px] leading-relaxed">
              Open terminal in VS Code and run:
              <br />
              <code className="text-emerald-300 bg-gray-950 px-2 py-0.5 rounded block mt-1">
                pip install -r requirements.txt
              </code>
            </p>
          </div>

          <div className="p-4 bg-gray-900/60 rounded-xl border border-gray-800 space-y-2">
            <div className="text-amber-400 font-bold text-sm">Step 3: Run & Voice Test</div>
            <p className="text-gray-400 text-[11px] leading-relaxed">
              Paste keys into <code className="text-amber-300">config/api_keys.json</code> and run:
              <br />
              <code className="text-amber-300 bg-gray-950 px-2 py-0.5 rounded block mt-1">
                python main.py
              </code>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
