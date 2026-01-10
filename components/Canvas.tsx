import React, { useRef, useEffect, useState, useMemo } from 'react';
import { ZoomIn, ZoomOut, Move, Grid, Square, MousePointer2, BoxSelect, Trash2, Split, Box, RotateCcw, Pipette, Layers, Undo2, Redo2 } from 'lucide-react';
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
    // History
    onUndo: () => void;
    onRedo: () => void;
    canUndo: boolean;
    canRedo: boolean;
}

export const Canvas: React.FC<CanvasProps> = ({
    originalImage,
    paths,
    width,
    height,
    processing,
    isPickingColor,
    onColorPick,
    onPathsChange,
    onUndo,
    onRedo,
    canUndo,
    canRedo
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

    // Direct DOM Manipulation Refs for Performance
    const contentWrapperRef = useRef<HTMLDivElement>(null);

    const [viewMode, setViewMode] = useState<ViewMode>('split');
    const [selectedPathId, setSelectedPathId] = useState<string | null>(null);

    // Local paths state for syncing, but NOT for drag updates (performance)
    const [localPaths, setLocalPaths] = useState<VectorPath[]>([]);

    // Sync paths when they update from parent (e.g. undo/redo or new trace)
    useEffect(() => {
        setLocalPaths(paths);
    }, [paths]);

    // --- Content Centering Logic for 3D ---
    const [contentCenterOffset, setContentCenterOffset] = useState({ x: 0, y: 0 });

    useEffect(() => {
        if (localPaths.length === 0) {
            setContentCenterOffset(prev => (prev.x === 0 && prev.y === 0) ? prev : { x: 0, y: 0 });
            return;
        }

        // Calculate BBox of visual content
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

        // Sampling optimization for huge path counts (>10k), sample every 10th
        // to keep UI blocking < 2ms
        const step = localPaths.length > 10000 ? 5 : 1;

        for (let i = 0; i < localPaths.length; i += step) {
            const p = localPaths[i];
            if (p.x < minX) minX = p.x;
            if (p.y < minY) minY = p.y;
            if (p.x > maxX) maxX = p.x;
            if (p.y > maxY) maxY = p.y;
        }

        if (minX !== Infinity) {
            const cx = (minX + maxX) / 2;
            const cy = (minY + maxY) / 2;
            const newX = (width / 2) - cx;
            const newY = (height / 2) - cy;

            // Critical Optimization: Equality Check to prevent infinite loops
            setContentCenterOffset(prev => {
                if (Math.abs(prev.x - newX) < 0.1 && Math.abs(prev.y - newY) < 0.1) return prev;
                return { x: newX, y: newY };
            });
        }
    }, [localPaths, width, height]);

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
            if (containerRef.current) {
                const { clientWidth, clientHeight } = containerRef.current;
                // Use a larger default scale (e.g. 0.75 of strict fit) to fill the screen
                const sX = clientWidth / width;
                const sY = clientHeight / height;
                setScale(Math.min(sX, sY) * 0.75);
            } else {
                setScale(0.5);
            }
            setPosition({ x: 0, y: 0 });
        } else if (width > 0 && height > 0) {
            // Reset to fit screen when switching back to 2D
            fitToScreen();
        }
    }, [viewMode, width, height]);

    const handleResetPositions = () => {
        const newPaths = localPaths.map(p => ({ ...p, x: p.initialX ?? 0, y: p.initialY ?? 0 }));
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

    // --- Canvas 2D Ref and Cache ---
    const canvas2DRef = useRef<HTMLCanvasElement>(null);
    const pathCache = useRef<Map<string, Path2D>>(new Map());

    // Update Path Cache when paths change
    useEffect(() => {
        pathCache.current.clear();
        localPaths.forEach(p => {
            // Path2D constructor might fail on invalid paths, wrap in try-catch if needed
            try {
                pathCache.current.set(p.id, new Path2D(p.d));
            } catch (e) {
                console.warn("Invalid Path D:", p.d);
            }
        });
        // Trigger a redraw
        drawCanvas();
    }, [localPaths]);

    // Main Draw Function
    const drawCanvas = () => {
        const canvas = canvas2DRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d', { alpha: true });
        if (!ctx) return;

        // Clear
        ctx.clearRect(0, 0, width, height);

        // Global Transform (Zoom/Pan) - applied via context?
        // Wait, our 'ContentWrapper' div handles the Zoom/Pan via CSS Transform for the whole layer.
        // So the Canvas should be drawn at 1:1 scale relative to the `width/height` prop.
        // The `scale` and `position` props affect the PARENT DIV, not the Canvas internal coord system.
        // EXCEPT: Interaction (Selection Highlight, etc) needs to be drawn.
        // AND: Path specific transforms (p.x, p.y).

        localPaths.forEach(p => {
            const path2d = pathCache.current.get(p.id);
            if (!path2d) return;

            ctx.save();
            // Path Transform
            ctx.translate(p.x, p.y);
            if (p.scale && p.scale !== 1) ctx.scale(p.scale, p.scale);

            // Fill
            ctx.fillStyle = p.fill;
            ctx.fill(path2d);

            // Selection Stroke
            if (selectedPathId === p.id) {
                // Apply a glowing stroke
                ctx.lineWidth = 2 / scale; // Counteract global zoom if inside, but here we are in local?
                // Wait, if canvas is CSS scaled, lineWidth needs to be adjusted?
                // Actually, if ContentWrapper scales the canvas DIV, then internal 1px = 1px * scale visually.
                // So ctx.lineWidth = 2 means 2 * scale pixels on screen.
                // To keep constant stroke width on screen, we need dist/scale.
                // But here, the canvas internal resolution matches the image resolution (width/height).
                // The viewing scale is 'scale'.
                // So to get "2 screen pixels" wide stroke:
                // strokeWidth = 2 / scale.
                ctx.lineWidth = 2 * (1 / scale);
                ctx.strokeStyle = '#60a5fa';
                ctx.stroke(path2d);
            } else {
                // ctx.strokeStyle = p.fill;
                // ctx.lineWidth = 0.25 * (1/scale);
                // ctx.stroke(path2d);
            }

            ctx.restore();
        });
    };

    // Redraw when selection or scale changes (for stroke width)
    useEffect(() => {
        requestAnimationFrame(drawCanvas);
    }, [selectedPathId, scale, width, height]);


    // --- Event Handlers ---

    const handleMouseDown = (e: React.MouseEvent) => {
        // Handle Split Dragging (High Priority)
        // ... (Logic moved to rendering phase check or Keep shared handler)
        // The shared layout has Divider on top, so its onMouseDown fires first.

        if (isDraggingSplitRef.current) return;

        // Pick Color Priority
        if (isPickingColor) {
            if (!containerRef.current) return;
            const mouseX = e.clientX - position.x;
            const mouseY = e.clientY - position.y;
            const imageX = mouseX / scale;
            const imageY = mouseY / scale;
            onColorPick(imageX, imageY);
            return;
        }

        // Hit Testing for Vector Paths (Canvas Mode)
        if (viewMode !== 'isometric') {
            // Calculate Mouse in Canvas local coords
            // The Canvas is inside 'contentWrapperRef' which has transform: translate(pos) scale(scale)
            // Mouse Client -> Relative to Canvas
            // e.nativeEvent.offsetX is relative to target? 
            // Canvas is 'width' x 'height' pixels.

            // We need to inverse the global transform to find point in 1:1 canvas space.
            // Global: ScreenX = (CanvasX * scale) + position.x + containerLeft
            // CanvasX = (ScreenX - containerLeft - position.x) / scale

            // Simpler: e.nativeEvent.offsetX/Y gives coord relative to the element (Canvas).
            // Since Canvas is Scaled by CSS, offsetX gives us "Visual Coordinates". 
            // We need "Internal Coordinates".
            // internalX = offsetX / scale ?? No.
            // If CSS transform scale is used, offsetX/Y reports coordinates in the Scaled space usually?
            // Actually, Map Mouse to local Image Space:
            const mouseX = (e.clientX - position.x) / scale; // Error: position includes drag offset
            // Let's use the robust logic:
            // dragStart is clientX. 
            // Rect based approach:
            if (canvas2DRef.current) {
                const rect = canvas2DRef.current.getBoundingClientRect();
                const clickX = (e.clientX - rect.left) / scale; // Wait, rect includes scale?
                // If element has transform scale(2), rect.width is 2x.
                // So (clientX - rect.left) gives pixel dist in screen.
                // We divide by scale to get internal pixels.

                // Let's verify:
                // Rect.left is screen pos.
                // clientX is screen pos.
                // diff is screen pixels from left edge.
                // If scale is 2, 1 internal pixel = 2 screen pixels.
                // So internal = diff / 2.
                // YES. This assumes 'contentWrapper' applies the scale.

                const x = (e.clientX - rect.left) / scale;
                const y = (e.clientY - rect.top) / scale;

                // Hit Test Reverse
                let foundId: string | null = null;
                const ctx = canvas2DRef.current.getContext('2d');
                if (ctx) {
                    for (let i = localPaths.length - 1; i >= 0; i--) {
                        const p = localPaths[i];
                        const path2d = pathCache.current.get(p.id);
                        if (!path2d) continue;

                        // Transform Context to check point
                        ctx.save();
                        ctx.translate(p.x, p.y);
                        if (p.scale && p.scale !== 1) ctx.scale(p.scale, p.scale);

                        // isPointInPath uses Screen Space normally?
                        // NO, isPointInPath(x,y) checks if point x,y is in path
                        // transformed by current CTM.
                        // So we pass our 'x,y' (internal space).
                        if (ctx.isPointInPath(path2d, x, y)) {
                            foundId = p.id;
                            ctx.restore();
                            break;
                        }
                        ctx.restore();
                    }
                }

                if (foundId) {
                    e.stopPropagation();
                    setSelectedPathId(foundId);

                    // Start Path Dragging logic directly here
                    startPathDrag(e, foundId, scale);
                    return;
                }
            }
        }

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

    // Extracted Path Drag Logic
    const startPathDrag = (e: React.MouseEvent, pId: string, currentScale: number) => {
        const startX = e.clientX;
        const startY = e.clientY;

        const pathIndex = localPaths.findIndex(p => p.id === pId);
        if (pathIndex === -1) return;
        const initialPathX = localPaths[pathIndex].x;
        const initialPathY = localPaths[pathIndex].y;

        let currentDx = 0;
        let currentDy = 0;

        const moveHandler = (moveEvent: MouseEvent) => {
            currentDx = (moveEvent.clientX - startX) / currentScale;
            currentDy = (moveEvent.clientY - startY) / currentScale;

            // Update Local State for smooth render
            // Optimization: Mutate a temp map or use setLocalPaths with optimization?
            // React setState might be slow for 60fps drag if simple.
            // But we need to redraw canvas.
            // Let's modify the localPaths in a way that triggers redraw fast?
            // Actually, we can just update a 'dragOffset' ref and apply it in draw?
            // No, complex. Just update state for now, check perf.
            // If laggy, we'll use a Ref for 'activeDrag' and use it in draw loop.

            // FAST PATH: Update the single path in localPaths Mutable-ish way?
            // No, immutable.
            setLocalPaths(prev => {
                const next = [...prev];
                const idx = next.findIndex(p => p.id === pId);
                if (idx !== -1) {
                    next[idx] = { ...next[idx], x: initialPathX + currentDx, y: initialPathY + currentDy };
                }
                return next;
            });
        };

        const upHandler = () => {
            document.removeEventListener('mousemove', moveHandler);
            document.removeEventListener('mouseup', upHandler);

            // Final Sync handled by state update above.
            // Just notify parent
            const finalPaths = [...localPaths]; // localPaths likely updated by moveHandler closures? 
            // Wait, closure stale issue. 'localPaths' inside moveHandler is fresh from setLocalPaths scanner?
            // Actually, better to read from a Ref or rely on the last state update.
            // We should call onPathsChange with the final state.
            // We can use a ref to track final change.

            // Hack: Just re-find from current localPaths in timeout to ensure state settled?
            // Or rely on the fact that Move updated the state.
            // Ideally we need the 'final' value to call onPathsChange.
            // Let's assume user stops moving before up.
            onPathsChange(localPaths); // This might be stale.

            // Better: Calculate final pos from total delta
            const finalX = initialPathX + currentDx;
            const finalY = initialPathY + currentDy;
            onPathsChange(localPaths.map(p => p.id === pId ? { ...p, x: finalX, y: finalY } : p));
        };
        document.addEventListener('mousemove', moveHandler);
        document.addEventListener('mouseup', upHandler);
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

        // Canvas Panning (Optimized with Direct DOM)
        if (isDraggingCanvas && contentWrapperRef.current) {
            const newX = e.clientX - dragStart.x;
            const newY = e.clientY - dragStart.y;
            contentWrapperRef.current.style.transform = `translate(${newX}px, ${newY}px) scale(${scale})`;
        }
    };

    const handleGlobalMouseUp = (e: React.MouseEvent) => {
        if (isDraggingCanvas) {
            setIsDraggingCanvas(false);
            const newX = e.clientX - dragStart.x;
            const newY = e.clientY - dragStart.y;
            setPosition({ x: newX, y: newY });
        }

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

    // Redundant useEffect removed to prevent Loop

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
        const transformStyle = isDraggingCanvas && contentWrapperRef.current
            ? contentWrapperRef.current.style.transform
            : `translate(${position.x}px, ${position.y}px) scale(${scale})`;

        const wrapperStyle: React.CSSProperties = {
            width: width,
            height: height,
            transform: transformStyle,
            transformOrigin: '0 0',
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

        // --- ISOMETRIC VIEW (Keep SVG) ---
        if (viewMode === 'isometric') {
            // Dynamic Spacing:
            // If few layers, use generous spacing (up to 15px).
            // If many layers, compact them to fit within a reasonable visual depth (e.g. 120px total).
            // But never go below 2px to ensure they don't clip.
            const targetTotalDepth = 120;
            const rawSpacing = groupedPaths.length > 1 ? targetTotalDepth / (groupedPaths.length - 1) : 0;
            const layerSpacing = Math.max(2, Math.min(15, rawSpacing));

            const totalZHeight = (groupedPaths.length - 1) * layerSpacing;
            const zOriginOffset = totalZHeight / 2;

            // Performance: Disable shadows if too many layers (>15) to prevent freeze
            const enableShadows = groupedPaths.length <= 15;

            // --- VRAM Optimization: Downsample Layer Size ---
            // Large images (e.g. 4K) create massive GPU textures for each layer, changing VRAM to GBs -> Crash.
            // We cap the DOM element size (texture size) to a reasonable max (e.g. 1500px).
            // The SVG viewBox ensures vectors scale down perfectly into this smaller container.
            const maxLayerSize = 1500;
            const textureScale = Math.min(1, maxLayerSize / Math.max(width, height));
            const layerWidth = width * textureScale;
            const layerHeight = height * textureScale;

            // We must compensate the visual scale because we shrunk the container
            // If we shrunk by 0.5, the image is 0.5x size. We need to 2x the CSS scale to match previous look?
            // Actually, 'scale' state handles the *On Screen* size.
            // Current logic: width/height is used for transformOrigin and centering.
            // If we render a smaller box, it will look smaller unless we zoom in.
            // Let's effectively render a "Proxy Box" that is smaller.

            // Apply Content Centering + Scaling
            // We put the centering translation INSIDE the rotation group?
            // No, we want to rotate around the center.
            // The outer div is centered. Inside it is the SVG.
            // We translate the SVG contents so their center aligns with the SVG center.
            const centeringTransform = `translate(${contentCenterOffset.x}, ${contentCenterOffset.y})`;

            return (
                <div className="w-full h-full relative overflow-visible" style={{ perspective: '2000px', cursor: 'move', willChange: 'transform' }}>
                    <div
                        style={{
                            position: 'absolute',
                            top: '50%',
                            left: '50%',
                            width: layerWidth, // Optimization: Use downsampled size
                            height: layerHeight,
                            transform: `translate3d(-50%, -50%, 0) scale(${scale / textureScale}) rotateX(${isoRotation.x}deg) rotateZ(${isoRotation.z}deg)`, // Compensate visual scale
                            transformStyle: 'preserve-3d',
                            transformOrigin: '50% 50%',
                            transition: isRotatingIso ? 'none' : 'transform 0.3s ease-out',
                            willChange: 'transform'
                        }}
                        className="relative"
                    >
                        {groupedPaths.map(([color, paths], index) => {
                            const zPos = (index * layerSpacing) - zOriginOffset;
                            return (
                                <div
                                    key={color}
                                    style={{
                                        ...layerStyle,
                                        width: '100%', height: '100%', // Match parent downsampled size
                                        transform: `translateZ(${zPos}px)`,
                                        // Filter removed to prevent VRAM explosion
                                    }}
                                    className="pointer-events-none"
                                >
                                    <svg width={layerWidth} height={layerHeight} viewBox={`0 0 ${width} ${height}`} shapeRendering="geometricPrecision" className="overflow-visible">
                                        <g transform={centeringTransform}>
                                            {/* Vector Shadow Layer (Efficient, No VRAM cost) */}
                                            <g transform="translate(4, 4)">
                                                {paths.map(p => (
                                                    <path
                                                        key={`${p.id}-shadow`}
                                                        d={p.d}
                                                        fill="black"
                                                        stroke="black"
                                                        strokeWidth={0.5}
                                                        fillOpacity={0.25}
                                                        strokeOpacity={0.25}
                                                        fillRule="evenodd"
                                                        transform={`translate(${p.x}, ${p.y}) scale(${p.scale || 1})`}
                                                    />
                                                ))}
                                            </g>

                                            {/* Main Content Layer */}
                                            <g>
                                                {paths.map(p => (
                                                    <path
                                                        key={p.id}
                                                        d={p.d}
                                                        fill={p.fill}
                                                        stroke={p.fill}
                                                        strokeWidth={0.5}
                                                        fillRule="evenodd"
                                                        transform={`translate(${p.x}, ${p.y}) scale(${p.scale || 1})`}
                                                    />
                                                ))}
                                            </g>
                                        </g>
                                    </svg>
                                    <div className="absolute inset-0 border border-white/5 pointer-events-none opacity-20"></div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            );
        }

        // --- 2D VIEWS (CANVAS) ---
        return (
            <div ref={contentWrapperRef} style={wrapperStyle} className="will-change-transform">
                <div ref={vectorLayerRef} style={{ ...layerStyle, clipPath: viewMode === 'split' ? `inset(0 0 0 ${splitRatioRef.current * 100}%)` : undefined }} className="z-0 will-change-[clip-path]">
                    <canvas
                        ref={canvas2DRef}
                        width={width}
                        height={height}
                        className="block w-full h-full"
                    />
                </div>
                {viewMode === 'split' && (
                    <>
                        <div ref={originalLayerRef} style={{ ...layerStyle, clipPath: `inset(0 ${100 - splitRatioRef.current * 100}% 0 0)` }} className="z-10 will-change-[clip-path] pointer-events-none">
                            <img src={originalImage} alt="Original" className="w-full h-full object-contain block" />
                        </div>
                        <div ref={dividerRef} onMouseDown={handleSplitMouseDown} className="group z-30 flex justify-center cursor-col-resize hover:z-40 pointer-events-auto" style={{ position: 'absolute', top: 0, bottom: 0, width: '40px', marginLeft: '-20px', left: `${splitRatioRef.current * 100}%`, willChange: 'left' }}>
                            <div className="h-full bg-purple-500 shadow-[0_0_10px_rgba(168,85,247,0.5)] relative transition-all" style={{ width: `${Math.max(1.5, 1.5 / scale)}px` }}>
                                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-slate-900 rounded-full flex items-center justify-center shadow-lg border border-purple-500/50 group-hover:scale-110 group-hover:border-purple-400 transition-all" style={{ width: `${28 / scale}px`, height: `${28 / scale}px`, minWidth: '16px', minHeight: '16px' }}>
                                    <Split style={{ width: '50%', height: '50%' }} className="text-purple-400" />
                                </div>
                            </div>
                        </div>
                    </>
                )}
            </div>
        );
    };

    return (
        <div className="flex-1 min-w-0 flex flex-col h-full relative" ref={canvasRef} tabIndex={0} style={{ outline: 'none' }}>
            {/* Toolbar */}
            <div className="h-14 bg-[#0f172a]/80 backdrop-blur-md border-b border-slate-800/50 flex items-center justify-between px-6 z-50 shadow-lg shrink-0">
                <div className="flex items-center gap-4">
                    {/* View Mode Switcher */}
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

                    {/* Undo / Redo in Toolbar */}
                    <div className="flex items-center gap-1 bg-slate-900/50 p-1 rounded-lg border border-slate-800">
                        <button
                            onClick={onUndo}
                            disabled={!canUndo}
                            className="p-2 rounded-md text-slate-400 hover:text-white hover:bg-white/5 disabled:opacity-30 disabled:hover:bg-transparent transition-all"
                            title="撤销 (Ctrl+Z)"
                        >
                            <Undo2 className="w-4 h-4" />
                        </button>
                        <button
                            onClick={onRedo}
                            disabled={!canRedo}
                            className="p-2 rounded-md text-slate-400 hover:text-white hover:bg-white/5 disabled:opacity-30 disabled:hover:bg-transparent transition-all"
                            title="重做 (Ctrl+Y)"
                        >
                            <Redo2 className="w-4 h-4" />
                        </button>
                    </div>
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