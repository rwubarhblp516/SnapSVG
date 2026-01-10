import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Sidebar } from './components/Sidebar';
import { Canvas } from './components/Canvas';
import { TracerParams, VectorPath, ProcessingStats, PaletteItem, ThreadStatus } from './types';
import { traceImage, extractPalette, autoDetectParams, getThreadStatus, onThreadStatusChange } from './services/mockVTracer';
// Removed aiService imports since we are now fully local

// Type for History Step
interface HistoryStep {
    paths: VectorPath[];
    params: TracerParams;
    palette: PaletteItem[];
    // We don't need originalPalette in history per se, as it's static per image, but maybe if we support multiple images later?
    // For now, keep it simple.
}

const App: React.FC = () => {
    // --- State ---
    const [params, setParams] = useState<TracerParams>({
        colors: 32,
        paths: 85,
        corners: 75,
        noise: 20,
        blur: 0,
        sampling: 1, // Defaulting to 1x as requested by user
        ignoreWhite: true,
        smartBackground: true,
        colorMode: 'color',
        autoAntiAlias: true,
        usePaletteMapping: false,
        backgroundColor: undefined
    });

    const [imageUrl, setImageUrl] = useState<string | null>(null);
    const [imageDims, setImageDims] = useState({ width: 0, height: 0 });
    const [imageData, setImageData] = useState<ImageData | null>(null);
    const [imageFile, setImageFile] = useState<File | null>(null);

    const [svgPaths, setSvgPaths] = useState<VectorPath[]>([]);
    // NEW: Palette State
    const [palette, setPalette] = useState<PaletteItem[]>([]);
    // NEW: Original Palette State
    const [originalPalette, setOriginalPalette] = useState<PaletteItem[]>([]);

    const [processing, setProcessing] = useState(false);
    const [aiProcessing, setAiProcessing] = useState(false);
    const [stats, setStats] = useState<ProcessingStats>({ durationMs: 0, pathCount: 0 });
    const [detectedImageType, setDetectedImageType] = useState<string | null>(null);
    const [threadStatus, setThreadStatus] = useState<ThreadStatus>(getThreadStatus());

    // Color Picker
    const [isPickingColor, setIsPickingColor] = useState(false);

    // API Key State (Deprecated/Hidden, but kept for type compatibility)
    const [apiKey, setApiKey] = useState('');

    // History State
    const [history, setHistory] = useState<HistoryStep[]>([]);
    const [historyIndex, setHistoryIndex] = useState(-1);

    // FIX: Use ref to track index so addToHistory remains stable and doesn't trigger useEffect loop
    const historyIndexRef = useRef(historyIndex);
    useEffect(() => { historyIndexRef.current = historyIndex; }, [historyIndex]);

    const isUndoRedoAction = useRef(false); // Flag to prevent infinite loops

    const fileInputRef = useRef<HTMLInputElement>(null);

    // --- History Management ---

    // FIX: Stable callback with no dependencies to prevent infinite loop in Vectorization Effect
    const addToHistory = useCallback((newPaths: VectorPath[], newParams: TracerParams, newPalette: PaletteItem[]) => {
        setHistory(prev => {
            const currentIdx = historyIndexRef.current;
            const currentSlice = prev.slice(0, currentIdx + 1);
            // Limit to 10 steps
            const newHistory = [...currentSlice, { paths: newPaths, params: newParams, palette: newPalette }];
            if (newHistory.length > 10) newHistory.shift();
            return newHistory;
        });
        // Safely increment index, capping at 9
        setHistoryIndex(prev => (prev < 9 ? prev + 1 : 9));
    }, []);

    const handleUndo = useCallback(() => {
        if (historyIndex > 0) {
            isUndoRedoAction.current = true;
            const prevStep = history[historyIndex - 1];
            setSvgPaths(prevStep.paths);
            setParams(prevStep.params);
            setPalette(prevStep.palette);
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
            setPalette(nextStep.palette);
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

    useEffect(() => {
        const unsubscribe = onThreadStatusChange((status) => {
            setThreadStatus(status);
        });
        return () => unsubscribe();
    }, []);

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

                // Extract Palette and Color Estimate
                const { colorCount, palette } = extractPalette(data.data, img.width * img.height);
                const suggestedParams = autoDetectParams(data) as any;
                const detectedType = suggestedParams._detectedType;
                const detectedColors = suggestedParams._detectedColors;
                delete suggestedParams._detectedType;
                delete suggestedParams._detectedColors;

                // Reset history on new file
                const initialParams = {
                    ...params,
                    ...suggestedParams,
                    colors: suggestedParams.colors ?? colorCount,
                    backgroundColor: undefined
                };
                setParams(initialParams);
                setHistory([]);
                setHistoryIndex(-1);
                setSvgPaths([]);
                setPalette([]);
                setOriginalPalette(palette); // Set Original Palette

                if (detectedType) {
                    setDetectedImageType(`${detectedType} (${detectedColors} 色)`);
                    setTimeout(() => setDetectedImageType(null), 5000);
                }
            }
            setImageUrl(url);
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
        const g = data[idx + 1];
        const b = data[idx + 2];

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
        // Persist current palette in history even if paths changed manually
        addToHistory(newPaths, params, palette);
    }, [params, palette, addToHistory]);

    // --- REPLACEMENT: Local Smart Auto-Tune Logic ---
    const handleLocalAutoTune = () => {
        if (!imageData) return;

        setAiProcessing(true);
        // Simulate a brief "thinking" time for UX
        setTimeout(() => {
            try {
                // Analyze locally
                const suggestedParams = autoDetectParams(imageData) as any;

                // 提取检测信息
                const detectedType = suggestedParams._detectedType;
                const detectedColors = suggestedParams._detectedColors;

                // 移除内部字段
                delete suggestedParams._detectedType;
                delete suggestedParams._detectedColors;

                setParams(prev => ({
                    ...prev,
                    ...suggestedParams,
                    colors: suggestedParams.colors ?? prev.colors,
                    paths: suggestedParams.paths ?? prev.paths,
                    corners: suggestedParams.corners ?? prev.corners,
                    noise: suggestedParams.noise ?? prev.noise,
                    blur: suggestedParams.blur ?? prev.blur,
                    colorMode: (suggestedParams.colorMode as any) ?? prev.colorMode,
                    sampling: suggestedParams.sampling ?? prev.sampling
                }));

                // 显示检测结果
                if (detectedType) {
                    setDetectedImageType(`${detectedType} (${detectedColors} 色)`);
                    // 3秒后清除提示
                    setTimeout(() => setDetectedImageType(null), 5000);
                }
            } catch (err) {
                console.error(err);
            } finally {
                setAiProcessing(false);
            }
        }, 600);
    };

    // --- Vectorization Effect (Local) ---
    useEffect(() => {
        if (!imageData || isUndoRedoAction.current) return;

        // This effect runs whenever `params` changes.
        // So when AI updates params, this runs automatically.
        const timer = setTimeout(async () => {
            setProcessing(true);
            const start = performance.now();
            try {
                // Optional palette mapping (disabled by default for higher fidelity).
                const targetPalette = params.usePaletteMapping && originalPalette.length > 0
                    ? originalPalette.slice(0, params.colors).map(p => p.hex)
                    : undefined;

                const result = await traceImage(imageData, { ...params, palette: targetPalette });

                setSvgPaths(result.paths);
                setPalette(result.palette);
                setStats({
                    durationMs: Math.round(performance.now() - start),
                    pathCount: result.paths.length
                });
                // Auto-save history after successful generation
                addToHistory(result.paths, params, result.palette);
            } catch (e) {
                console.error("Vectorization failed", e);
            } finally {
                setProcessing(false);
            }
        }, 400);
        return () => clearTimeout(timer);
    }, [params, imageData, addToHistory, originalPalette]);

    // --- Downloads ---
    const downloadSvg = () => {
        if (!imageDims.width) return;
        const pathsString = svgPaths.map(p =>
            `<path id="${p.id}" d="${p.d}" fill="${p.fill}" stroke="${p.stroke || p.fill}" stroke-width="${p.strokeWidth || 0.25}" stroke-linejoin="round" fill-rule="evenodd" transform="translate(${p.x}, ${p.y}) scale(${p.scale || 1})" />`
        ).join('\n');
        const svgContent = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${imageDims.width} ${imageDims.height}">
${pathsString}
</svg>`;
        const blob = new Blob([svgContent], { type: 'image/svg+xml' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'snapsvg-vector.svg';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

    const downloadPng = () => {
        if (!imageDims.width) return;
        const canvas = document.createElement('canvas');
        const scale = 2; // Export scale
        canvas.width = imageDims.width * scale;
        canvas.height = imageDims.height * scale;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.scale(scale, scale);
        svgPaths.forEach(p => {
            const path = new Path2D(p.d);
            ctx.save();
            ctx.translate(p.x, p.y);
            // Apply path scaling (e.g. from WASM subsampling)
            const s = p.scale || 1;
            ctx.scale(s, s);

            ctx.fillStyle = p.fill;
            ctx.strokeStyle = p.stroke || p.fill;
            ctx.lineWidth = (p.strokeWidth || 0.25) / s; // Adjust line width to counteract scaling if needed, or keep it consistent?
            // Note: strokeWidth in p is usually pre-calculated or generic. 
            // In mockVTracer TS, strokeWidth was 0.25. 
            // In WASM, we set strokeWidth: 0.25 * scale, and p.scale is 1/scale. 
            // So strokeWidth is physically larger. If we scale context down, distinct stroke width shrinks.
            // Let's rely on what Canvas rendering does.
            // If we scale the context by 0.5 (WASM 2x), a 1px line becomes 0.5px.
            // WASM sets strokeWidth to 0.5 for 2x scale? No, WASM code: `strokeWidth: 0.25 * scale` (where scale=2). So it's 0.5.
            // Then we render with ctx.scale(0.5). Effective width = 0.5 * 0.5 = 0.25. Correct.
            // But wait, line width is affected by scale.
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
                onAiSplit={handleLocalAutoTune}
                aiProcessing={aiProcessing}
                detectedImageType={detectedImageType}
                threadStatus={threadStatus}
                // Undo/Redo
                onUndo={handleUndo}
                onRedo={handleRedo}
                canUndo={historyIndex > 0}
                canRedo={historyIndex < history.length - 1}
                // Palette
                palette={palette}
                originalPalette={originalPalette}
                // API Key (Hidden now)
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
                // Pass Undo/Redo props to Canvas
                onUndo={handleUndo}
                onRedo={handleRedo}
                canUndo={historyIndex > 0}
                canRedo={historyIndex < history.length - 1}
            />
        </div>
    );
};

export default App;
