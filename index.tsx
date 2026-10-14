import React, { useState, useEffect, useRef, FormEvent } from "react";
import { createRoot } from "react-dom/client";
import { GoogleGenAI, Type } from "@google/genai";

// --- Types & Interfaces ---

interface FileSystemNode {
  type: "file" | "directory";
  content?: string;
  children?: { [key: string]: FileSystemNode };
  metadata?: {
    created: number;
    modified: number;
    permissions: string;
  };
}

interface CommandBlock {
  id: string;
  command: string;
  timestamp: number;
  output: React.ReactNode;
  cwd: string;
  status: "success" | "error" | "processing";
}

interface EnvVar {
  [key: string]: string;
}

// --- Constants ---

const INITIAL_FS: FileSystemNode = {
  type: "directory",
  children: {
    home: {
      type: "directory",
      children: {
        user: {
          type: "directory",
          children: {
            "welcome.txt": {
              type: "file",
              content: "Welcome to HyperTerminal AI.\nAccessing system kernels... [Simulated]\nRoot privileges: GRANTED (Virtual Sandbox)\n\nTry commands:\n- gemini <prompt>: Ask AI (System aware)\n- veo <prompt>: Generate video\n- image <prompt>: Generate image\n- ollama <prompt>: Query local Ollama\n- js <code>: Run Javascript directly\n",
              metadata: { created: Date.now(), modified: Date.now(), permissions: "rwx" },
            },
            projects: {
              type: "directory",
              children: {},
              metadata: { created: Date.now(), modified: Date.now(), permissions: "rwx" },
            },
          },
          metadata: { created: Date.now(), modified: Date.now(), permissions: "rwx" },
        },
      },
      metadata: { created: Date.now(), modified: Date.now(), permissions: "rwx" },
    },
    etc: {
      type: "directory",
      children: {
        hosts: { type: "file", content: "127.0.0.1 localhost", metadata: { created: Date.now(), modified: Date.now(), permissions: "r--" } }
      },
      metadata: { created: Date.now(), modified: Date.now(), permissions: "r-x" }
    }
  },
  metadata: { created: Date.now(), modified: Date.now(), permissions: "rwx" },
};

// --- Helper Functions ---

const generateId = () => Math.random().toString(36).substr(2, 9);

const resolvePath = (fs: FileSystemNode, cwd: string, pathStr: string): { node: FileSystemNode | null, parent: FileSystemNode | null, key: string, absPath: string } => {
  let parts = pathStr.split("/").filter(Boolean);
  let currentPathParts = cwd.split("/").filter(Boolean);
  
  if (pathStr.startsWith("/")) {
    currentPathParts = [];
  }

  for (const part of parts) {
    if (part === ".") continue;
    if (part === "..") {
      currentPathParts.pop();
    } else {
      currentPathParts.push(part);
    }
  }

  let current = fs;
  let parent = null;
  let lastKey = "";

  for (const part of currentPathParts) {
    if (current.type !== "directory" || !current.children) return { node: null, parent, key: lastKey, absPath: "/" + currentPathParts.join("/") };
    parent = current;
    lastKey = part;
    current = current.children[part];
    if (!current) return { node: null, parent, key: lastKey, absPath: "/" + currentPathParts.join("/") };
  }

  return { node: current, parent, key: lastKey, absPath: "/" + currentPathParts.join("/") };
};

// --- Components ---

const Block: React.FC<{ block: CommandBlock }> = ({ block }) => {
  return (
    <div className="mb-6 animate-in" style={{ opacity: 0, animationFillMode: 'forwards' }}>
      <div className="flex items-center text-xs text-gray-500 mb-1 font-mono select-none">
        <span className="text-[#00ff9d] mr-2">➜</span>
        <span className="text-[#00b8ff] mr-2">{block.cwd}</span>
        <span className="opacity-50">{new Date(block.timestamp).toLocaleTimeString()}</span>
      </div>
      <div className="bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.05)] rounded-lg overflow-hidden backdrop-blur-sm">
        <div className="px-4 py-2 font-mono text-sm border-b border-[rgba(255,255,255,0.05)] text-gray-300 font-bold bg-[rgba(0,0,0,0.2)]">
          {block.command}
        </div>
        <div className="p-4 font-mono text-sm text-gray-200 overflow-x-auto whitespace-pre-wrap">
          {block.output}
        </div>
      </div>
    </div>
  );
};

const App = () => {
  // --- State ---
  const [fs, setFs] = useState<FileSystemNode>(() => {
    const saved = localStorage.getItem("vfs");
    return saved ? JSON.parse(saved) : INITIAL_FS;
  });
  const [cwd, setCwd] = useState<string>("/home/user");
  const [history, setHistory] = useState<CommandBlock[]>([]);
  const [input, setInput] = useState("");
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [isProcessing, setIsProcessing] = useState(false);
  const [env, setEnv] = useState<EnvVar>({
    TERM: "xterm-256color",
    USER: "root",
    SHELL: "/bin/zsh",
    OLLAMA_HOST: "http://localhost:11434"
  });

  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // --- Persistence ---
  useEffect(() => {
    localStorage.setItem("vfs", JSON.stringify(fs));
  }, [fs]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [history]);

  const addToHistory = (cmd: string, output: React.ReactNode, status: "success" | "error" = "success") => {
    setHistory(prev => [
      ...prev,
      {
        id: generateId(),
        command: cmd,
        timestamp: Date.now(),
        output,
        cwd,
        status
      }
    ]);
  };

  // --- Command Processors ---

  const executeAI = async (prompt: string, modelType: 'chat' | 'code' | 'image' | 'video' = 'chat') => {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    
    try {
      if (modelType === 'image') {
        // Image Generation
        const response = await ai.models.generateContent({
           model: 'gemini-2.5-flash-image',
           contents: prompt,
        });
        
        const parts = response.candidates?.[0]?.content?.parts || [];
        const images = parts.filter(p => p.inlineData).map((p, i) => (
           <img key={i} src={`data:${p.inlineData?.mimeType};base64,${p.inlineData?.data}`} alt="Generated" className="max-w-md h-auto rounded-md border border-gray-700 mt-2 shadow-lg" />
        ));
        const text = parts.find(p => p.text)?.text;

        return (
          <div className="flex flex-col gap-2">
             {text && <div className="text-gray-300">{text}</div>}
             <div className="flex flex-wrap gap-4">{images}</div>
             {images.length === 0 && <div className="text-yellow-500">No image generated. Try a more specific prompt.</div>}
          </div>
        );
      } 
      
      if (modelType === 'video') {
         // Veo Video Generation
         // Requires valid billed key in environment.
         if ((window as any).aistudio && !await (window as any).aistudio.hasSelectedApiKey()) {
            return (
              <div className="flex flex-col items-start gap-2">
                <span className="text-yellow-400">Please select a paid API key to use Veo.</span>
                <button 
                  className="px-3 py-1 bg-[#00b8ff] text-black font-bold rounded hover:bg-[#0099cc] transition-colors"
                  onClick={() => (window as any).aistudio.openSelectKey()}
                >
                  Select API Key
                </button>
                <a href="https://ai.google.dev/gemini-api/docs/billing" target="_blank" className="text-xs text-gray-500 underline">Billing Documentation</a>
              </div>
            );
         }

         // We use the env key directly as per instructions, but for Veo specifically sometimes strict key checks apply.
         // Assuming process.env.API_KEY is valid.
         
         let operation = await ai.models.generateVideos({
            model: 'veo-3.1-fast-generate-preview',
            prompt: prompt,
            config: {
                numberOfVideos: 1,
                resolution: '720p',
                aspectRatio: '16:9'
            }
         });
         
         // We add an interim message because video takes time
         const msgId = generateId();
         
         // This is a simplistic way to handle async video in this linear terminal flow without redux/complex state
         // We'll block and wait here for the demo effect
         
         while (!operation.done) {
            await new Promise(resolve => setTimeout(resolve, 5000));
            operation = await ai.operations.getVideosOperation({operation: operation});
         }
         
         const videoUri = operation.response?.generatedVideos?.[0]?.video?.uri;
         if (videoUri) {
             const videoUrl = `${videoUri}&key=${process.env.API_KEY}`;
             return (
                 <video controls autoPlay loop className="w-full max-w-lg rounded-lg border border-[#00b8ff] shadow-[0_0_15px_rgba(0,184,255,0.3)]">
                     <source src={videoUrl} type="video/mp4" />
                     Your terminal does not support the video tag.
                 </video>
             );
         }
         return <span className="text-red-400">Video generation failed or returned no URI.</span>;
      }

      // Chat / Code / System
      const modelName = modelType === 'code' ? 'gemini-3-pro-preview' : 'gemini-2.5-flash';
      
      // Inject VFS context for grounding
      const fsContext = JSON.stringify(fs).substring(0, 5000); // Limit context size
      const systemInstruction = `
        You are "Gemma 3", a highly advanced AI integrated into a web-based HyperTerminal.
        You have full visibility of the simulated virtual file system (VFS).
        Current CWD: ${cwd}.
        VFS State Snippet: ${fsContext}
        
        Capabilities:
        1. Answer questions concisely in Markdown.
        2. If asked to modify files, return a JSON block ONLY:
           \`\`\`json
           { "action": "writeFile", "path": "path/to/file", "content": "..." }
           \`\`\`
        3. Be "hacker-like" but helpful. Cool, precise, technical.
        4. If the user asks about the device, pretend you have access.
      `;

      const response = await ai.models.generateContent({
        model: modelName,
        contents: prompt,
        config: {
          systemInstruction: systemInstruction,
          tools: [{ googleSearch: {} }] // Grounding
        }
      });
      
      const text = response.text || "";
      const grounding = response.candidates?.[0]?.groundingMetadata?.groundingChunks || [];

      // Check for JSON actions
      const jsonMatch = text.match(/```json\n([\s\S]*?)\n```/);
      if (jsonMatch) {
         try {
            const action = JSON.parse(jsonMatch[1]);
            if (action.action === "writeFile") {
                // Execute write
                const res = handleWriteFile(action.path, action.content);
                return <div className="text-green-400">System Action Executed: {res} <br/><br/> <span className="text-gray-400">{text.replace(/```json[\s\S]*```/, '')}</span></div>;
            }
         } catch (e) {
            console.error(e);
         }
      }

      return (
        <div>
          <div className="whitespace-pre-wrap">{text.replace(/```json[\s\S]*```/, '')}</div>
          {grounding.length > 0 && (
            <div className="mt-2 pt-2 border-t border-gray-700">
               <div className="text-xs text-gray-500 mb-1">Sources:</div>
               <div className="flex flex-wrap gap-2">
                 {grounding.map((g: any, i: number) => {
                    const uri = g.web?.uri;
                    const title = g.web?.title;
                    if (!uri) return null;
                    return <a key={i} href={uri} target="_blank" className="text-xs text-blue-400 hover:text-blue-300 underline">{title || uri}</a>
                 })}
               </div>
            </div>
          )}
        </div>
      );

    } catch (err: any) {
      return <span className="text-red-500">Error: {err.message}</span>;
    }
  };

  const handleWriteFile = (pathStr: string, content: string): string => {
      const { parent, key } = resolvePath(fs, cwd, pathStr);
      if (parent) {
          const newFs = { ...fs }; // Deep copy needed in reality, simplified here
          // Re-traverse to mutate
          let current = newFs;
          const parts = (pathStr.startsWith('/') ? pathStr : `${cwd}/${pathStr}`).split('/').filter(Boolean);
          const fileName = parts.pop()!;
          for(const p of parts) {
             if (!current.children?.[p]) current.children![p] = { type: 'directory', children: {}, metadata: { created: Date.now(), modified: Date.now(), permissions: 'rwx' }};
             current = current.children![p];
          }
          current.children![fileName] = {
              type: 'file',
              content: content,
              metadata: { created: Date.now(), modified: Date.now(), permissions: 'rw-' }
          };
          setFs(newFs);
          return `Written to ${pathStr}`;
      }
      return "Path invalid";
  }

  const handleCommand = async (rawCmd: string) => {
    if (!rawCmd.trim()) return;
    
    const parts = rawCmd.trim().split(" ");
    const cmd = parts[0];
    const args = parts.slice(1);
    const argStr = args.join(" ");

    setIsProcessing(true);
    let output: React.ReactNode = "";
    let status: "success" | "error" = "success";

    try {
      switch (cmd) {
        case "clear":
          setHistory([]);
          setIsProcessing(false);
          return;
          
        case "help":
          output = (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <div className="text-[#00ff9d] font-bold mb-2">SYSTEM COMMANDS</div>
                <div className="text-gray-400">ls, cd, cat, mkdir, rm, pwd, clear, echo</div>
              </div>
              <div>
                <div className="text-[#bd00ff] font-bold mb-2">AI MODULES</div>
                <div className="mb-1"><span className="text-white font-bold">gemini</span> [prompt] - General AI assistant</div>
                <div className="mb-1"><span className="text-white font-bold">veo</span> [prompt] - Generate video</div>
                <div className="mb-1"><span className="text-white font-bold">image</span> [prompt] - Generate image</div>
              </div>
              <div>
                 <div className="text-[#00b8ff] font-bold mb-2">EXTRAS</div>
                 <div className="mb-1"><span className="text-white font-bold">ollama</span> [prompt] - Query local Ollama</div>
                 <div className="mb-1"><span className="text-white font-bold">js</span> [code] - Execute JS in sandbox</div>
                 <div className="mb-1"><span className="text-white font-bold">fullscreen</span> - Toggle immersive mode</div>
              </div>
            </div>
          );
          break;

        case "ls":
          const { node: lsNode } = resolvePath(fs, cwd, args[0] || ".");
          if (lsNode && lsNode.type === "directory" && lsNode.children) {
             const items = Object.entries(lsNode.children).map(([name, node]) => ({ name, isDir: node.type === 'directory' }));
             output = (
                 <div className="flex flex-wrap gap-4">
                     {items.map(i => (
                         <span key={i.name} className={i.isDir ? "text-blue-400 font-bold" : "text-gray-300"}>{i.name}{i.isDir ? "/" : ""}</span>
                     ))}
                 </div>
             );
          } else {
             output = <span className="text-red-400">Not a directory or does not exist</span>;
             status = "error";
          }
          break;

        case "cd":
          const target = args[0] || "/home/user";
          const { node: cdNode, absPath } = resolvePath(fs, cwd, target);
          if (cdNode && cdNode.type === "directory") {
              setCwd(absPath);
              output = <span className="text-gray-500">Changed directory to {absPath}</span>;
          } else {
              output = <span className="text-red-400">Directory not found: {target}</span>;
              status = "error";
          }
          break;

        case "cat":
           const { node: catNode } = resolvePath(fs, cwd, args[0]);
           if (catNode && catNode.type === 'file') {
               output = <div className="whitespace-pre-wrap">{catNode.content}</div>;
           } else {
               output = <span className="text-red-400">File not found: {args[0]}</span>;
               status = "error";
           }
           break;
        
        case "mkdir":
           handleWriteFile(`${args[0]}/.keep`, ""); // Lazy hack to create dir
           output = <span className="text-green-400">Created directory: {args[0]}</span>;
           break;

        case "gemini":
        case "gemma":
           output = await executeAI(argStr, 'code');
           break;
        
        case "ask":
           output = await executeAI(argStr, 'chat');
           break;

        case "image":
        case "genimg":
        case "imagen":
           output = await executeAI(argStr, 'image');
           break;

        case "veo":
        case "video":
           output = await executeAI(argStr, 'video');
           break;
        
        case "ollama":
            if (args[0] === "set-host") {
                setEnv(p => ({...p, OLLAMA_HOST: args[1]}));
                output = "Ollama host updated.";
            } else {
                try {
                    const ollamaRes = await fetch(`${env.OLLAMA_HOST}/api/generate`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ model: 'llama3', prompt: argStr, stream: false })
                    });
                    if (!ollamaRes.ok) throw new Error("Failed to connect to Ollama. Ensure allow_origins is set.");
                    const data = await ollamaRes.json();
                    output = data.response;
                } catch (e: any) {
                    output = <span className="text-red-400">Ollama Error: {e.message}.<br/>Make sure Ollama is running and `OLLAMA_ORIGINS="*"` is set.</span>;
                    status = "error";
                }
            }
            break;

        case "js":
            try {
                // eslint-disable-next-line no-new-func
                const func = new Function("term", "fs", argStr);
                const result = func({ cwd, setCwd, history }, fs);
                output = <div className="text-yellow-300">{String(result)}</div>;
            } catch (e: any) {
                output = <span className="text-red-400">{e.message}</span>;
                status = "error";
            }
            break;

        case "fullscreen":
            if (!document.fullscreenElement) {
                document.documentElement.requestFullscreen();
            } else {
                document.exitFullscreen();
            }
            output = "Toggled fullscreen mode.";
            break;

        default:
          output = <span className="text-red-400">Command not found: {cmd}</span>;
          status = "error";
      }
    } catch (e: any) {
        output = <span className="text-red-400">System Failure: {e.message}</span>;
        status = "error";
    }

    addToHistory(rawCmd, output, status);
    setIsProcessing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      handleCommand(input);
      setInput("");
      setHistoryIndex(-1);
    } else if (e.key === "ArrowUp") {
        e.preventDefault();
        if (historyIndex < history.length - 1) {
            const idx = historyIndex + 1;
            setHistoryIndex(idx);
            setInput(history[history.length - 1 - idx].command);
        }
    } else if (e.key === "ArrowDown") {
        e.preventDefault();
        if (historyIndex > 0) {
            const idx = historyIndex - 1;
            setHistoryIndex(idx);
            setInput(history[history.length - 1 - idx].command);
        } else {
            setHistoryIndex(-1);
            setInput("");
        }
    }
  };

  return (
    <div className="flex flex-col h-full bg-[#050505] text-[#e0e0e0] font-mono relative overflow-hidden">
        {/* Background Animation Simulation */}
        <div className="absolute inset-0 pointer-events-none opacity-20" 
             style={{ 
                 backgroundImage: 'radial-gradient(circle at 50% 50%, #0d1f2d 0%, #000000 100%)',
                 zIndex: 0 
             }} 
        />
        
        {/* Terminal Area */}
        <div className="flex-1 overflow-y-auto p-4 md:p-8 z-10 pb-24">
            <div className="max-w-4xl mx-auto">
                <div className="mb-8 text-center opacity-50 text-xs tracking-[0.2em] uppercase">
                    Gemma 3 Kernel Loaded • Secure Environment • {new Date().getFullYear()}
                </div>
                
                {history.map((block) => (
                    <Block key={block.id} block={block} />
                ))}
                
                {isProcessing && (
                     <div className="flex items-center gap-2 text-[#00ff9d] animate-pulse mt-4">
                         <span className="w-2 h-2 bg-[#00ff9d] rounded-full"></span>
                         Processing...
                     </div>
                )}
                <div ref={bottomRef} />
            </div>
        </div>

        {/* Input Area (Warp Style) */}
        <div className="absolute bottom-0 left-0 right-0 p-4 bg-[rgba(10,10,10,0.8)] backdrop-blur-md border-t border-[rgba(255,255,255,0.1)] z-20">
             <div className="max-w-4xl mx-auto flex items-center gap-3 bg-[rgba(0,0,0,0.5)] border border-[rgba(255,255,255,0.1)] rounded-xl p-3 shadow-2xl focus-within:border-[#00ff9d] transition-colors duration-300">
                 <div className="text-[#00ff9d] font-bold select-none">❯</div>
                 <div className="text-[#00b8ff] font-bold text-sm select-none hidden md:block">{cwd}</div>
                 <input 
                    ref={inputRef}
                    autoFocus
                    type="text" 
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    className="flex-1 bg-transparent border-none outline-none text-gray-100 placeholder-gray-600 font-mono"
                    placeholder="Enter command (try 'help' or 'gemini hello')..."
                    autoComplete="off"
                    spellCheck="false"
                 />
                 <div className="text-xs text-gray-600 border border-gray-800 rounded px-2 py-1 hidden sm:block">
                     CMD + K to Clear
                 </div>
             </div>
        </div>
    </div>
  );
};

const root = createRoot(document.getElementById("root")!);
root.render(<App />);