import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Sidebar } from './components/Sidebar';
import { Canvas } from './components/Canvas';
import { TracerParams, VectorPath, ProcessingStats } from './types';
import { traceImage, estimateColors } from './services/mockVTracer';
import { segmentImageWithGemini } from './services/aiService';
import { parseSvgToPaths } from './utils/svgParser';

// Type for History Step
interface HistoryStep {
  paths: VectorPath[];
  params: TracerParams;
}

const App: React.FC = () => {
  // --- State ---
  const [params, setParams] = useState<TracerParams>({
    colors: 32,
    paths: 85,
    corners: 75,
    noise: 5,
    blur: 0,
    sampling: 2, 
    ignoreWhite: true, 
    smartBackground: true,
    colorMode: 'color', 
    autoAntiAlias: true,
    backgroundColor: undefined
  });

  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [imageDims, setImageDims] = useState({ width: 0, height: 0 });
  const [imageData, setImageData] = useState<ImageData | null>(null);
  const [imageFile, setImageFile] = useState<File | null>(null); 
  
  const [svgPaths, setSvgPaths] = useState<VectorPath[]>([]);
  const [processing, setProcessing] = useState(false);
  const [aiProcessing, setAiProcessing] = useState(false); 
  const [isAiMode, setIsAiMode] = useState(false); 
  const [stats, setStats] = useState<ProcessingStats>({ durationMs: 0, pathCount: 0 });
  
  // Color Picker
  const [isPickingColor, setIsPickingColor] = useState(false);
  
  // API Key State (Persisted)
  const [apiKey, setApiKey] = useState(() => localStorage.getItem('snapsvg_api_key') || '');

  // History State
  const [history, setHistory] = useState<HistoryStep[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const isUndoRedoAction = useRef(false); // Flag to prevent infinite loops

  const fileInputRef = useRef<HTMLInputElement>(null);

  // --- Persistence ---
  useEffect(() => {
    localStorage.setItem('snapsvg_api_key', apiKey);
  }, [apiKey]);

  // --- History Management ---
  
  const addToHistory = useCallback((newPaths: VectorPath[], newParams: TracerParams) => {
    setHistory(prev => {
        const currentSlice = prev.slice(0, historyIndex + 1);
        // Limit to 10 steps
        const newHistory = [...currentSlice, { paths: newPaths, params: newParams }];
        if (newHistory.length > 10) newHistory.shift();
        return newHistory;
    });
    setHistoryIndex(prev => Math.min(prev + 1, 9)); // Max index is 9 (if length 10) or length-1
  }, [historyIndex]);

  const handleUndo = useCallback(() => {
      if (historyIndex > 0) {
          isUndoRedoAction.current = true;
          const prevStep = history[historyIndex - 1];
          setSvgPaths(prevStep.paths);
          setParams(prevStep.params);
          setHistoryIndex(historyIndex - 1);
          // Wait for render cycle to clear flag
          setTimeout(() => { isUndoRedoAction.current = false; }, 100);
      }
  }, [history, historyIndex]);

  const handleRedo = useCallback(() => {
      if (historyIndex < history.length - 1) {
          isUndoRedoAction.current = true;
          const nextStep = history[historyIndex + 1];
          setSvgPaths(nextStep.paths);
          setParams(nextStep.params);
          setHistoryIndex(historyIndex + 1);
          setTimeout(() => { isUndoRedoAction.current = false; }, 100);
      }
  }, [history, historyIndex]);

  // Keyboard Shortcuts for Undo/Redo
  useEffect(() => {
      const handleKeyDown = (e: KeyboardEvent) => {
          // Check for Ctrl (or Cmd on Mac)
          if (e.ctrlKey || e.metaKey) {
              if (e.key === 'z') {
                  e.preventDefault();
                  if (e.shiftKey) {
                      handleRedo();
                  } else {
                      handleUndo();
                  }
              } else if (e.key === 'y') {
                  e.preventDefault();
                  handleRedo();
              }
          }
      };
      window.addEventListener('keydown', handleKeyDown);
      return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleUndo, handleRedo]);

  // --- Handlers ---

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      processFile(file);
    }
  };

  const handlePaste = useCallback((e: ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (let i = 0; i < items.length; i++) {
        if (items[i].type.indexOf('image') !== -1) {
            const blob = items[i].getAsFile();
            if (blob) processFile(blob);
        }
    }
  }, []);

  const handleDrop = useCallback((e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const file = e.dataTransfer?.files?.[0];
      if (file && file.type.startsWith('image/')) {
          processFile(file);
      }
  }, []);

  useEffect(() => {
    window.addEventListener('paste', handlePaste);
    window.addEventListener('dragover', (e) => e.preventDefault());
    window.addEventListener('drop', handleDrop);
    return () => {
        window.removeEventListener('paste', handlePaste);
        window.removeEventListener('dragover', (e) => e.preventDefault());
        window.removeEventListener('drop', handleDrop);
    };
  }, [handlePaste, handleDrop]);

  const processFile = (file: File) => {
    setImageFile(file);
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
        setImageDims({ width: img.width, height: img.height });
        
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        if (ctx) {
            ctx.drawImage(img, 0, 0);
            const data = ctx.getImageData(0, 0, img.width, img.height);
            setImageData(data);
            const estimated = estimateColors(data.data, img.width * img.height);
            // Reset history on new file
            const initialParams = { ...params, colors: estimated, backgroundColor: undefined };
            setParams(initialParams);
            setHistory([]); 
            setHistoryIndex(-1);
            setSvgPaths([]);
        }
        setImageUrl(url);
        setIsAiMode(false); 
    };
    img.src = url;
  };

  const handleColorPick = (x: number, y: number) => {
      if (!imageData) return;
      const { width, data } = imageData;
      const cx = Math.max(0, Math.min(width - 1, Math.floor(x)));
      const cy = Math.max(0, Math.min(imageData.height - 1, Math.floor(y)));
      
      const idx = (cy * width + cx) * 4;
      const r = data[idx];
      const g = data[idx+1];
      const b = data[idx+2];
      
      const newParams = {
          ...params,
          backgroundColor: { r, g, b },
          ignoreWhite: true 
      };
      setParams(newParams);
      setIsPickingColor(false);
      // History will be updated by the vectorization effect
  };
  
  // Callback when paths change manually (Drag/Delete in Canvas)
  const handlePathsChange = useCallback((newPaths: VectorPath[]) => {
      setSvgPaths(newPaths);
      addToHistory(newPaths, params);
  }, [params, addToHistory]);

  // --- AI Split Logic ---
  const handleAiSplit = async () => {
      if (!imageUrl || !imageDims.width) return;
      
      if (!apiKey && !process.env.API_KEY) {
          alert("请先在左侧设置栏底部输入 Gemini API Key");
          return;
      }
      
      setAiProcessing(true);
      try {
          const response = await fetch(imageUrl);
          const blob = await response.blob();
          const reader = new FileReader();
          reader.onloadend = async () => {
              const base64data = reader.result as string;
              
              try {
                  const svgString = await segmentImageWithGemini(base64data, imageDims.width, imageDims.height, apiKey);
                  const paths = parseSvgToPaths(svgString);
                  
                  if (paths.length > 0) {
                      setSvgPaths(paths);
                      setIsAiMode(true);
                      addToHistory(paths, params);
                  } else {
                      alert("AI returned invalid data.");
                  }
              } catch (err: any) {
                  console.error(err);
                  alert(`AI processing failed: ${err.message || "Unknown error"}`);
              } finally {
                  setAiProcessing(false);
              }
          };
          reader.readAsDataURL(blob);
      } catch (e) {
          console.error(e);
          setAiProcessing(false);
      }
  };

  // --- Vectorization Effect (Local) ---
  useEffect(() => {
    if (!imageData || isAiMode || isUndoRedoAction.current) return; 
    
    const timer = setTimeout(async () => {
        setProcessing(true);
        const start = performance.now();
        try {
            const result = await traceImage(imageData, params);
            setSvgPaths(result.paths);
            setStats({
                durationMs: Math.round(performance.now() - start),
                pathCount: result.paths.length
            });
            // Auto-save history after successful generation
            addToHistory(result.paths, params);
        } catch (e) {
            console.error("Vectorization failed", e);
        } finally {
            setProcessing(false);
        }
    }, 400); 
    return () => clearTimeout(timer);
  }, [params, imageData, isAiMode, addToHistory]);

  // --- Downloads ---
  const downloadSvg = () => {
    if (!imageDims.width) return;
    const pathsString = svgPaths.map(p => 
        `<path id="${p.id}" d="${p.d}" fill="${p.fill}" stroke="${p.stroke || p.fill}" stroke-width="${p.strokeWidth || 0.25}" stroke-linejoin="round" fill-rule="evenodd" transform="translate(${p.x}, ${p.y})" />`
    ).join('\n');
    const svgContent = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${imageDims.width} ${imageDims.height}">
${pathsString}
</svg>`;
    const blob = new Blob([svgContent], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = isAiMode ? 'snapsvg-ai-split.svg' : 'snapsvg-vector.svg';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const downloadPng = () => {
    if (!imageDims.width) return;
    const canvas = document.createElement('canvas');
    const scale = 2;
    canvas.width = imageDims.width * scale;
    canvas.height = imageDims.height * scale;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(scale, scale);
    svgPaths.forEach(p => {
        const path = new Path2D(p.d);
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.fillStyle = p.fill;
        ctx.strokeStyle = p.stroke || p.fill;
        ctx.lineWidth = p.strokeWidth || 0.25;
        ctx.lineJoin = 'round';
        ctx.fill(path, "evenodd");
        ctx.stroke(path);
        ctx.restore();
    });
    const url = canvas.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = url;
    a.download = 'snapsvg-export.png';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  return (
    <div className="flex h-screen bg-transparent text-slate-200 font-sans overflow-hidden">
        <input 
            type="file" 
            ref={fileInputRef} 
            onChange={handleFileChange} 
            accept="image/png, image/jpeg, image/bmp, image/webp"
            className="hidden" 
        />
        
        <Sidebar 
            params={params} 
            setParams={setParams} 
            onUploadClick={handleUploadClick}
            onDownloadSvg={downloadSvg}
            onDownloadPng={downloadPng}
            processing={processing}
            hasImage={!!imageUrl}
            isPickingColor={isPickingColor}
            setIsPickingColor={setIsPickingColor}
            onAiSplit={handleAiSplit}
            aiProcessing={aiProcessing}
            // Undo/Redo
            onUndo={handleUndo}
            onRedo={handleRedo}
            canUndo={historyIndex > 0}
            canRedo={historyIndex < history.length - 1}
            // API Key
            apiKey={apiKey}
            setApiKey={setApiKey}
        />
        
        <Canvas 
            originalImage={imageUrl}
            paths={svgPaths}
            width={imageDims.width}
            height={imageDims.height}
            processing={processing}
            isPickingColor={isPickingColor}
            onColorPick={handleColorPick}
            onPathsChange={handlePathsChange}
        />
    </div>
  );
};

export default App;