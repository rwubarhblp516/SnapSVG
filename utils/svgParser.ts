import { VectorPath } from '../types';

/**
 * Parses a raw SVG string and extracts paths, preserving grouping information (IDs).
 * This allows the AI-generated Semantic Groups (Head, Body, etc.) to be visualized in the 3D view.
 */
export const parseSvgToPaths = (svgString: string): VectorPath[] => {
    const parser = new DOMParser();
    const doc = parser.parseFromString(svgString, "image/svg+xml");
    const errorNode = doc.querySelector("parsererror");
    if (errorNode) {
        console.error("SVG Parse Error:", errorNode);
        return [];
    }

    const paths: VectorPath[] = [];
    let pathCounter = 0;

    // Helper to traverse and capture context (group ID)
    const traverse = (element: Element, currentGroupId: string | null) => {
        const tagName = element.tagName.toLowerCase();
        
        // If it's a group, update the currentGroupId
        let nextGroupId = currentGroupId;
        if (tagName === 'g' && element.hasAttribute('id')) {
            nextGroupId = element.getAttribute('id');
        }

        if (tagName === 'path') {
            const d = element.getAttribute('d');
            let fill = element.getAttribute('fill') || '#000000';
            
            // Handle "none" fill
            if (fill.toLowerCase() === 'none') return;
            
            // Basic hex normalization if needed, mostly browser handles this
            
            if (d) {
                // Determine a meaningful ID
                // If we are in a named group (e.g., 'head'), the ID becomes 'head-1', 'head-2'
                const semanticId = nextGroupId ? `${nextGroupId}-${pathCounter}` : `path-${pathCounter}`;
                
                // For the 3D view grouping logic (which groups by fill color usually), 
                // we might want to hack it: 
                // The current Canvas.tsx groups by *Fill Color*. 
                // To force the 3D view to separate by *Body Part* instead of *Color*, 
                // we need to ensure the Canvas component knows about the Group ID.
                // However, without changing Canvas.tsx deeply, we can map the 'fill' to be unique per group 
                // OR just accept that the app currently groups by color.
                
                // *Better Strategy for this App*:
                // The prompt asks to "Split into different parts".
                // We will store the `id` in the path object.
                
                paths.push({
                    id: semanticId,
                    d: d,
                    fill: fill,
                    stroke: element.getAttribute('stroke') || fill,
                    strokeWidth: 0.5,
                    x: 0,
                    y: 0,
                    // We can encode the group name into the ID, which is useful for debugging
                });
                pathCounter++;
            }
        }

        // Recursively check children
        for (let i = 0; i < element.children.length; i++) {
            traverse(element.children[i], nextGroupId);
        }
    };

    traverse(doc.documentElement, null);
    return paths;
};
