import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Sidebar } from './components/Sidebar';
import { Canvas } from './components/Canvas';
import { TracerParams, VectorPath, ProcessingStats } from './types';
import { traceImage, estimateColors } from './services/mockVTracer';

const App: React.FC = () => {
  // --- State ---
  // Default to "Default" preset values matching Sidebar logic
  const [params, setParams] = useState<TracerParams>({
    colors: 32,
    paths: 85,
    corners: 75,
    noise: 5,
    blur: 0,
    sampling: 2, // Default 2x Super Sampling for clearer results
    ignoreWhite: true, 
    smartBackground: true
  });

  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [imageDims, setImageDims] = useState({ width: 0, height: 0 });
  const [imageData, setImageData] = useState<ImageData | null>(null);
  
  const [svgPaths, setSvgPaths] = useState<VectorPath[]>([]);
  const [processing, setProcessing] = useState(false);
  const [stats, setStats] = useState<ProcessingStats>({ durationMs: 0, pathCount: 0 });

  const fileInputRef = useRef<HTMLInputElement>(null);

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

  // Setup Global Drag/Paste listeners
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
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
        setImageDims({ width: img.width, height: img.height });
        
        // Create ImageData for the tracer
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        if (ctx) {
            ctx.drawImage(img, 0, 0);
            const data = ctx.getImageData(0, 0, img.width, img.height);
            setImageData(data);

            // Auto-detect colors logic
            const estimated = estimateColors(data.data, img.width * img.height);
            // Don't overwrite other params, just colors
            setParams(prev => ({ ...prev, colors: estimated }));
        }
        setImageUrl(url);
    };
    img.src = url;
  };

  // --- Vectorization Effect ---
  
  useEffect(() => {
    if (!imageData) return;

    // Debounce processing to avoid freeze during slider drag
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
        } catch (e) {
            console.error("Vectorization failed", e);
        } finally {
            setProcessing(false);
        }
    }, 400); // Slightly longer debounce for heavier calculation

    return () => clearTimeout(timer);
  }, [params, imageData]);

  // --- Downloads ---

  const downloadSvg = () => {
    if (!imageDims.width) return;
    
    // Reconstruct SVG string from current paths (including dragged positions)
    const pathsString = svgPaths.map(p => 
        `<path d="${p.d}" fill="${p.fill}" stroke="${p.fill}" stroke-width="0.25" stroke-linejoin="round" transform="translate(${p.x}, ${p.y})" />`
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
    // Render SVG to high-res canvas
    if (!imageDims.width) return;
    const canvas = document.createElement('canvas');
    // 2x upscale for "High Res"
    const scale = 2;
    canvas.width = imageDims.width * scale;
    canvas.height = imageDims.height * scale;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Convert SVG paths to instructions on canvas
    // Note: Canvg or simple Path2D could work. 
    // Since we have 'd' strings, we can use Path2D
    
    ctx.scale(scale, scale);
    svgPaths.forEach(p => {
        const path = new Path2D(p.d);
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.fillStyle = p.fill;
        // Apply stroke simulation for consistency with SVG
        ctx.strokeStyle = p.fill;
        ctx.lineWidth = 0.25;
        ctx.lineJoin = 'round';
        ctx.fill(path);
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
        />
        
        <Canvas 
            originalImage={imageUrl}
            paths={svgPaths}
            width={imageDims.width}
            height={imageDims.height}
            processing={processing}
        />
    </div>
  );
};

export default App;