import React, { useRef, useEffect, useState, useMemo } from 'react';
import { ZoomIn, ZoomOut, Move, Grid, Square, MousePointer2, BoxSelect, Trash2, Split, Box, RotateCcw, Pipette, Layers } from 'lucide-react';
import { VectorPath, ViewMode } from '../types';

interface CanvasProps {
  originalImage: string | null;
  paths: VectorPath[];
  width: number;
  height: number;
  processing: boolean;
  isPickingColor: boolean;
  onColorPick: (x: number, y: number) => void;
  // New callback to sync changes (drag/delete) back to App for history tracking
  onPathsChange: (newPaths: VectorPath[]) => void;
}

export const Canvas: React.FC<CanvasProps> = ({
  originalImage,
  paths,
  width,
  height,
  processing,
  isPickingColor,
  onColorPick,
  onPathsChange
}) => {
  const [scale, setScale] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  
  // Canvas Pan Dragging
  const [isDraggingCanvas, setIsDraggingCanvas] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });

  // Isometric Rotate Dragging
  const [isRotatingIso, setIsRotatingIso] = useState(false);
  const [isoRotation, setIsoRotation] = useState({ x: 60, z: 45 });
  const [isoDragStart, setIsoDragStart] = useState({ x: 0, y: 0, initialX: 60, initialZ: 45 });

  // Split Line Dragging
  const splitRatioRef = useRef(0.5); 
  const isDraggingSplitRef = useRef(false);
  
  // DOM Refs
  const originalLayerRef = useRef<HTMLDivElement>(null);
  const vectorLayerRef = useRef<HTMLDivElement>(null); 
  const dividerRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);

  const [viewMode, setViewMode] = useState<ViewMode>('split');
  const [selectedPathId, setSelectedPathId] = useState<string | null>(null);
  
  // Local paths state for smooth dragging, synced with props
  const [localPaths, setLocalPaths] = useState<VectorPath[]>([]);

  // Sync paths when they update from parent (e.g. undo/redo or new trace)
  useEffect(() => {
    setLocalPaths(paths);
  }, [paths]);

  // --- Keyboard Handling (Delete) ---
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
        if (!selectedPathId) return;

        if (e.key === 'Delete' || e.key === 'Backspace') {
            e.preventDefault();
            const newPaths = localPaths.filter(p => p.id !== selectedPathId);
            setLocalPaths(newPaths);
            setSelectedPathId(null);
            // Notify parent to save history
            onPathsChange(newPaths);
        }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedPathId, localPaths, onPathsChange]);


  // --- Helpers ---

  const updateSplitVisuals = (ratio: number) => {
     const percent = ratio * 100;
     if (originalLayerRef.current) originalLayerRef.current.style.clipPath = `inset(0 ${100 - percent}% 0 0)`;
     if (vectorLayerRef.current) vectorLayerRef.current.style.clipPath = `inset(0 0 0 ${percent}%)`;
     if (dividerRef.current) dividerRef.current.style.left = `${percent}%`;
  };

  useEffect(() => {
      if (viewMode === 'split') {
          requestAnimationFrame(() => updateSplitVisuals(splitRatioRef.current));
      }
      // Reset scale when entering iso mode for better view
      if (viewMode === 'isometric') {
          // Calculate scale to fit nicely with rotation
          setScale(Math.min(0.6, 350 / Math.max(width, height)));
          setPosition({ x: 0, y: 0 });
      } else if (width > 0 && height > 0) {
          // Reset to fit screen when switching back to 2D
          fitToScreen();
      }
  }, [viewMode, width, height]);

  const handleResetPositions = () => {
      const newPaths = localPaths.map(p => ({ ...p, x: 0, y: 0 }));
      setLocalPaths(newPaths);
      onPathsChange(newPaths); // Update history
      
      setIsoRotation({ x: 60, z: 45 });
      fitToScreen();
  };
  
  const handleDeleteSelected = () => {
      if (!selectedPathId) return;
      const newPaths = localPaths.filter(p => p.id !== selectedPathId);
      setLocalPaths(newPaths);
      setSelectedPathId(null);
      onPathsChange(newPaths);
  };

  // Group paths by color for Isometric View
  const groupedPaths = useMemo(() => {
      const groups: Record<string, VectorPath[]> = {};
      localPaths.forEach(p => {
          if (!groups[p.fill]) groups[p.fill] = [];
          groups[p.fill].push(p);
      });
      return Object.entries(groups);
  }, [localPaths]);

  // --- Event Handlers ---

  const handleMouseDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).tagName === 'path' || (e.target as HTMLElement).getAttribute('data-type') === 'selection-box') {
        return;
    }
    
    // Pick Color Priority
    if (isPickingColor) {
        if (!containerRef.current) return;
        // Calculate image coordinates
        const mouseX = e.clientX - position.x;
        const mouseY = e.clientY - position.y;
        // Adjust for current scale
        const imageX = mouseX / scale;
        const imageY = mouseY / scale;
        onColorPick(imageX, imageY);
        return;
    }

    if (isDraggingSplitRef.current) return;

    if (e.button === 0) { 
        if (viewMode === 'isometric') {
            setIsRotatingIso(true);
            setIsoDragStart({ 
                x: e.clientX, 
                y: e.clientY, 
                initialX: isoRotation.x, 
                initialZ: isoRotation.z 
            });
        } else {
            if (selectedPathId) setSelectedPathId(null);
            setIsDraggingCanvas(true);
            setDragStart({ x: e.clientX - position.x, y: e.clientY - position.y });
        }
    }
  };

  const handleSplitMouseDown = (e: React.MouseEvent) => {
    e.stopPropagation(); 
    e.preventDefault();
    isDraggingSplitRef.current = true;
    document.body.style.cursor = 'col-resize';
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    // Split Dragging
    if (isDraggingSplitRef.current && containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        const mouseXInContainer = e.clientX - rect.left;
        const mouseXInImage = (mouseXInContainer - position.x) / scale;
        let newRatio = mouseXInImage / width;
        newRatio = Math.max(0, Math.min(1, newRatio));
        splitRatioRef.current = newRatio;
        updateSplitVisuals(newRatio);
        return;
    }

    // Isometric Rotation
    if (isRotatingIso) {
        const dx = e.clientX - isoDragStart.x;
        const dy = e.clientY - isoDragStart.y;
        setIsoRotation({
            x: Math.max(0, Math.min(90, isoDragStart.initialX - dy * 0.5)),
            z: (isoDragStart.initialZ - dx * 0.5) % 360
        });
        return;
    }

    // Canvas Panning
    if (isDraggingCanvas) {
      setPosition({
        x: e.clientX - dragStart.x,
        y: e.clientY - dragStart.y
      });
    }
  };

  const handleGlobalMouseUp = () => {
    setIsDraggingCanvas(false);
    setIsRotatingIso(false);
    if (isDraggingSplitRef.current) {
        isDraggingSplitRef.current = false;
        document.body.style.cursor = '';
    }
  };

  const handleWheel = (e: React.WheelEvent) => {
    e.stopPropagation(); 
    if (e.ctrlKey || e.metaKey || e.deltaY !== 0) {
        const delta = -e.deltaY * 0.001;
        const newScale = Math.min(Math.max(0.1, scale + delta), 20);
        setScale(newScale);
    } 
  };

  const zoomIn = () => setScale(s => Math.min(s * 1.2, 20));
  const zoomOut = () => setScale(s => Math.max(s / 1.2, 0.1));
  const fitToScreen = () => {
      if (!containerRef.current) return;
      const { clientWidth, clientHeight } = containerRef.current;
      const scaleX = (clientWidth - 40) / width;
      const scaleY = (clientHeight - 40) / height;
      const newScale = Math.min(scaleX, scaleY, 1); 
      setScale(newScale);
      setPosition({ 
          x: (clientWidth - width * newScale) / 2, 
          y: (clientHeight - height * newScale) / 2 
      });
  };

  useEffect(() => {
      if (width > 0 && height > 0 && viewMode !== 'isometric') fitToScreen();
  }, [width, height]);

  // Path Dragging Logic
  const handlePathMouseDown = (e: React.MouseEvent, pId: string) => {
    if (viewMode === 'isometric' || isPickingColor) return; // Disable drag in 3D or Pick Mode
    e.stopPropagation(); 
    setSelectedPathId(pId);
    
    const startX = e.clientX;
    const startY = e.clientY;
    const pathIndex = localPaths.findIndex(p => p.id === pId);
    if (pathIndex === -1) return;
    const initialPathX = localPaths[pathIndex].x;
    const initialPathY = localPaths[pathIndex].y;
    
    let hasMoved = false;

    const moveHandler = (moveEvent: MouseEvent) => {
        hasMoved = true;
        const dx = (moveEvent.clientX - startX) / scale;
        const dy = (moveEvent.clientY - startY) / scale;
        setLocalPaths(prev => {
            const newPaths = [...prev];
            const idx = newPaths.findIndex(p => p.id === pId);
            if (idx !== -1) {
                newPaths[idx] = { ...newPaths[idx], x: initialPathX + dx, y: initialPathY + dy };
            }
            return newPaths;
        });
    };

    const upHandler = () => {
        document.removeEventListener('mousemove', moveHandler);
        document.removeEventListener('mouseup', upHandler);
        
        // Only trigger history update if object actually moved
        if (hasMoved) {
            // Need to get the latest state. 
            // Since we are inside a closure, we use a functional update on parent or callback.
            // However, localPaths in this scope is stale.
            // We can trust React setState batching or use the setter result.
            // A safer way: re-find the path in the *current* localPaths logic? 
            // Simpler: Just rely on the component state having been updated by moveHandler.
            // But we need the *final* value to pass to onPathsChange.
            
            // We will pass the function to setLocalPaths which gets the prev value, 
            // and we can also side-effect call onPathsChange with that value.
            setLocalPaths(latestPaths => {
                onPathsChange(latestPaths);
                return latestPaths;
            });
        }
    };
    document.addEventListener('mousemove', moveHandler);
    document.addEventListener('mouseup', upHandler);
  };

  const SvgLayer = useMemo(() => (
        <svg 
            width={width} 
            height={height} 
            viewBox={`0 0 ${width} ${height}`}
            shapeRendering="geometricPrecision"
            className="overflow-visible block w-full h-full pointer-events-auto"
        >
             <defs>
                <filter id="select-glow" x="-20%" y="-20%" width="140%" height="140%">
                  <feDropShadow dx="0" dy="0" stdDeviation="5" floodColor="#3b82f6" floodOpacity="0.8"/>
                </filter>
            </defs>
            {localPaths.map((path) => {
                const isSelected = selectedPathId === path.id;
                return (
                    <g key={path.id} transform={`translate(${path.x}, ${path.y})`}>
                        <path
                            d={path.d}
                            fill={path.fill}
                            stroke={isSelected ? '#60a5fa' : (path.fill || 'none')}
                            strokeWidth={isSelected ? 2 / scale : (0.25)}
                            strokeLinejoin="round"
                            fillRule="evenodd"
                            onMouseDown={(e) => handlePathMouseDown(e, path.id)}
                            className={`cursor-move transition-opacity ${isSelected ? 'opacity-100 z-50' : 'hover:opacity-90'}`}
                            style={{ 
                                filter: isSelected ? 'url(#select-glow)' : 'none',
                                vectorEffect: 'non-scaling-stroke',
                                cursor: isPickingColor ? 'crosshair' : 'move'
                            }}
                        />
                    </g>
                );
            })}
        </svg>
  ), [localPaths, selectedPathId, width, height, scale, isPickingColor]);

  if (!originalImage) {
    return (
      <div className="flex-1 flex items-center justify-center bg-transparent checkerboard-bg relative overflow-hidden">
        <div className="absolute inset-0 bg-[#0B1121]/40 pointer-events-none"></div>
        <div className="text-slate-500 flex flex-col items-center relative z-10">
            <Layers className="w-16 h-16 mb-4 opacity-30 text-purple-500" />
            <p className="text-slate-400 font-medium">请在左侧上传图片</p>
        </div>
      </div>
    );
  }

  const renderContent = () => {
    const wrapperStyle: React.CSSProperties = {
        width: width,
        height: height,
        transform: `translate(${position.x}px, ${position.y}px) scale(${scale})`,
        transformOrigin: '0 0', // Default for 2D panning
        transition: isDraggingCanvas ? 'none' : 'transform 0.1s ease-out',
        position: 'absolute',
        top: 0,
        left: 0,
        boxShadow: '0 0 0 1px rgba(148, 163, 184, 0.1)'
    };

    const layerStyle: React.CSSProperties = {
        position: 'absolute',
        top: 0, left: 0, width: '100%', height: '100%',
    };

    // --- ISOMETRIC VIEW ---
    if (viewMode === 'isometric') {
        return (
            <div className="w-full h-full flex items-center justify-center overflow-visible" style={{ perspective: '2000px' }}>
                <div 
                    style={{
                        width: width,
                        height: height,
                        transform: `scale(${scale}) rotateX(${isoRotation.x}deg) rotateZ(${isoRotation.z}deg)`,
                        transformStyle: 'preserve-3d',
                        transformOrigin: '50% 50%', 
                        transition: isRotatingIso ? 'none' : 'transform 0.3s ease-out'
                    }}
                    className="relative shadow-2xl"
                >
                    {/* Exploded Layers */}
                    {groupedPaths.map(([color, paths], index) => {
                        // --- KEY FIX: Increased Z spacing to 25px for better visibility ---
                        const zOffset = index * 25; 
                        return (
                            <div 
                                key={color}
                                style={{ 
                                    ...layerStyle, 
                                    transform: `translateZ(${zOffset}px)`,
                                    // Stronger shadow for depth perception
                                    filter: `drop-shadow(5px 5px 10px rgba(0,0,0,0.5))`
                                }}
                                className="pointer-events-none"
                            >
                                <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} shapeRendering="geometricPrecision" className="overflow-visible">
                                    {paths.map(p => (
                                        <path 
                                            key={p.id} 
                                            d={p.d} 
                                            fill={p.fill} 
                                            stroke={p.fill} 
                                            strokeWidth={0.5}
                                            fillRule="evenodd"
                                            transform={`translate(${p.x}, ${p.y})`}
                                        />
                                    ))}
                                </svg>
                                {/* Layer Edge visual helper (optional, kept subtle) */}
                                <div className="absolute inset-0 border border-white/5 pointer-events-none opacity-20"></div>
                            </div>
                        );
                    })}
                </div>
            </div>
        );
    }

    if (viewMode === 'split') {
        return (
            <div style={wrapperStyle} className="will-change-transform">
                <div ref={vectorLayerRef} style={{ ...layerStyle, clipPath: `inset(0 0 0 ${splitRatioRef.current * 100}%)` }} className="z-0 will-change-[clip-path]"> 
                    {SvgLayer}
                </div>
                <div ref={originalLayerRef} style={{ ...layerStyle, clipPath: `inset(0 ${100 - splitRatioRef.current * 100}% 0 0)` }} className="z-10 will-change-[clip-path] pointer-events-none">
                    <img src={originalImage} alt="Original" className="w-full h-full object-contain block" />
                </div>
                <div ref={dividerRef} onMouseDown={handleSplitMouseDown} className="group z-30 flex justify-center cursor-col-resize hover:z-40 pointer-events-auto" style={{ position: 'absolute', top: 0, bottom: 0, width: '40px', marginLeft: '-20px', left: `${splitRatioRef.current * 100}%`, willChange: 'left' }}>
                     <div className="h-full bg-purple-500 shadow-[0_0_10px_rgba(168,85,247,0.5)] relative transition-all" style={{ width: `${Math.max(1.5, 1.5/scale)}px` }}>
                         <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-slate-900 rounded-full flex items-center justify-center shadow-lg border border-purple-500/50 group-hover:scale-110 group-hover:border-purple-400 transition-all" style={{ width: `${28/scale}px`, height: `${28/scale}px`, minWidth: '16px', minHeight: '16px' }}>
                            <Split style={{ width: '50%', height: '50%' }} className="text-purple-400" />
                         </div>
                    </div>
                </div>
            </div>
        );
    }

    // Default: Vector Only
    return <div style={wrapperStyle}>{SvgLayer}</div>;
  };

  return (
    <div className="flex-1 min-w-0 flex flex-col h-full relative" ref={canvasRef} tabIndex={0} style={{ outline: 'none' }}>
      {/* Toolbar */}
      <div className="h-14 bg-[#0f172a]/80 backdrop-blur-md border-b border-slate-800/50 flex items-center justify-between px-6 z-20 shadow-lg shrink-0">
         <div className="flex items-center gap-1 bg-slate-900/50 p-1 rounded-lg border border-slate-800">
            <button onClick={() => setViewMode('split')} className={`p-2 rounded-md transition-all ${viewMode === 'split' ? 'bg-slate-700 text-white shadow-md' : 'text-slate-400 hover:text-white hover:bg-white/5'}`} title="分屏对比">
                <Grid className="w-4 h-4" />
            </button>
            <button onClick={() => setViewMode('vector')} className={`p-2 rounded-md transition-all ${viewMode === 'vector' ? 'bg-slate-700 text-white shadow-md' : 'text-slate-400 hover:text-white hover:bg-white/5'}`} title="仅矢量">
                <Square className="w-4 h-4" />
            </button>
            {/* Divider */}
            <div className="w-px h-4 bg-slate-700 mx-1"></div>
            <button onClick={() => setViewMode('isometric')} className={`p-2 rounded-md transition-all ${viewMode === 'isometric' ? 'bg-slate-700 text-white shadow-md' : 'text-slate-400 hover:text-white hover:bg-white/5'}`} title="等距爆炸视图 (3D)">
                <Box className="w-4 h-4" />
            </button>
         </div>

         {/* Hint Text */}
         <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none hidden md:block">
            <span className="text-[10px] text-slate-500 bg-slate-900/50 px-3 py-1 rounded-full border border-white/5 flex items-center gap-2">
                {isPickingColor ? (
                     <>
                        <Pipette className="w-3 h-3 text-purple-400" />
                        <span className="text-purple-300">点击画面任意位置吸取背景色... (ESC 取消)</span>
                     </>
                ) : viewMode === 'isometric' ? (
                     <>
                        <Move className="w-3 h-3 text-purple-400" />
                        <span className="text-purple-300">按住鼠标拖动旋转视角 · 滚轮缩放</span>
                     </>
                ) : selectedPathId ? (
                    <>
                        <BoxSelect className="w-3 h-3 text-blue-400" />
                        <span className="text-blue-300">已选中 - 按住拖动 · 按 Delete 删除背景</span>
                    </>
                ) : (
                    <>
                        <MousePointer2 className="w-3 h-3 text-slate-400" />
                        <span>点击选中物体 (如背景) 可删除 · 拖动滑块对比</span>
                    </>
                )}
            </span>
         </div>

         <div className="flex items-center gap-4">
             {selectedPathId && viewMode !== 'isometric' && (
                 <button 
                    onClick={handleDeleteSelected}
                    className="flex items-center gap-1 bg-red-900/30 text-red-400 border border-red-500/30 px-3 py-1.5 rounded-lg text-xs hover:bg-red-900/50 transition-colors"
                 >
                     <Trash2 className="w-3.5 h-3.5" />
                     删除对象
                 </button>
             )}
             <div className="flex items-center gap-2 bg-slate-900/50 rounded-lg px-2 py-1.5 border border-slate-800">
                 <button onClick={zoomOut} className="p-1.5 hover:text-purple-400 transition-colors"><ZoomOut className="w-4 h-4" /></button>
                 <span className="text-xs font-mono w-12 text-center text-slate-300">{Math.round(scale * 100)}%</span>
                 <button onClick={zoomIn} className="p-1.5 hover:text-purple-400 transition-colors"><ZoomIn className="w-4 h-4" /></button>
                 <button onClick={fitToScreen} className="p-1.5 hover:text-purple-400 ml-1 border-l border-slate-700 pl-2 transition-colors" title="Fit to Screen"><Move className="w-4 h-4" /></button>
                 {/* Reset Button */}
                 <button onClick={handleResetPositions} className="p-1.5 hover:text-purple-400 ml-1 border-l border-slate-700 pl-2 transition-colors" title="Reset Positions"><RotateCcw className="w-4 h-4" /></button>
             </div>
         </div>
      </div>

      {/* Main Canvas Area */}
      <div 
        ref={containerRef}
        className={`flex-1 bg-transparent checkerboard-bg relative overflow-hidden`}
        style={{ 
            cursor: isPickingColor ? 'crosshair' : (isDraggingCanvas ? 'grabbing' : isDraggingSplitRef.current ? 'col-resize' : isRotatingIso ? 'move' : 'grab')
        }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleGlobalMouseUp}
        onMouseLeave={handleGlobalMouseUp}
        onWheel={handleWheel}
      >
        <div className="absolute inset-0 bg-[#0B1121]/80 pointer-events-none z-0"></div>

        {processing && (
            <div className="absolute inset-0 z-50 flex items-center justify-center bg-[#0B1121]/80 backdrop-blur-sm">
                <div className="flex flex-col items-center gap-6">
                    <div className="relative">
                         <div className="w-16 h-16 border-4 border-slate-700 rounded-full"></div>
                         <div className="absolute top-0 left-0 w-16 h-16 border-4 border-purple-500 border-t-transparent rounded-full animate-spin"></div>
                    </div>
                    <div className="text-purple-400 font-mono animate-pulse tracking-widest text-sm">VECTORIZING IMAGE...</div>
                </div>
            </div>
        )}
        
        {viewMode === 'split' && originalImage && (
            <>
                <div className="absolute top-4 left-4 z-40 pointer-events-none">
                     <div className="bg-black/60 text-white text-[10px] px-2 py-1 rounded backdrop-blur-md border border-white/10 font-mono shadow-lg flex items-center gap-2">
                         <div className="w-2 h-2 rounded-full bg-blue-500"></div>
                         ORIGINAL (原图)
                     </div>
                </div>
                <div className="absolute top-4 right-4 z-40 pointer-events-none">
                     <div className="bg-purple-900/80 text-white text-[10px] px-2 py-1 rounded backdrop-blur-md border border-purple-500/30 font-mono shadow-lg flex items-center gap-2">
                         VECTOR (矢量)
                         <div className="w-2 h-2 rounded-full bg-purple-500"></div>
                     </div>
                </div>
            </>
        )}

        <div className="relative z-10 w-full h-full">
            {renderContent()}
        </div>
      </div>
      
      {/* Footer Info */}
      <div className="h-8 bg-[#0f172a]/90 backdrop-blur-md border-t border-slate-800/50 flex items-center justify-between px-6 text-[10px] text-slate-500 select-none font-mono shrink-0">
          <div className="flex items-center gap-4">
              <span>RES: {width} x {height} px</span>
              <span className="text-slate-600">|</span>
              <span>ZOOM: {(scale * 100).toFixed(0)}%</span>
              {viewMode === 'isometric' && (
                  <>
                    <span className="text-slate-600">|</span>
                    <span className="text-purple-400">ROT: X{Math.round(isoRotation.x)}° Z{Math.round(isoRotation.z)}°</span>
                  </>
              )}
          </div>
          <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-purple-500 animate-pulse"></div>
              <span>PATHS: {localPaths.length}</span>
          </div>
      </div>
    </div>
  );
};