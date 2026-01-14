/**
 * Screenshot Annotator
 *
 * Adds numbered overlays to screenshots so the LLM can reference
 * elements by their number (e.g., "click [5]").
 *
 * This script is injected into the page to draw number badges
 * on interactive elements before taking a screenshot.
 */

import { NumberedElement } from "./types";

/**
 * JavaScript to inject into the page to add number overlays.
 * Takes an array of NumberedElement with bounding boxes.
 */
export function getAnnotationScript(elements: NumberedElement[]): string {
  return `
(function() {
  // Remove any existing annotations
  const existing = document.querySelectorAll('.firecrawl-agent-annotation');
  existing.forEach(el => el.remove());

  const elements = ${JSON.stringify(elements)};

  // Create a container for all annotations
  const container = document.createElement('div');
  container.className = 'firecrawl-agent-annotation';
  container.style.cssText = 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none; z-index: 2147483647;';
  document.body.appendChild(container);

  // Add style for annotations
  const style = document.createElement('style');
  style.className = 'firecrawl-agent-annotation';
  style.textContent = \`
    .fc-number-badge {
      position: absolute;
      background: #ff4444;
      color: white;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 11px;
      font-weight: bold;
      padding: 2px 5px;
      border-radius: 10px;
      min-width: 16px;
      text-align: center;
      box-shadow: 0 2px 4px rgba(0,0,0,0.3);
      pointer-events: none;
      z-index: 2147483647;
    }
    .fc-element-highlight {
      position: absolute;
      border: 2px solid #ff4444;
      border-radius: 3px;
      pointer-events: none;
      z-index: 2147483646;
    }
  \`;
  document.head.appendChild(style);

  elements.forEach(el => {
    if (!el.boundingBox) return;

    const { x, y, width, height } = el.boundingBox;

    // Skip elements that are off-screen or too small
    if (x < -100 || y < -100 || width < 5 || height < 5) return;
    if (x > window.innerWidth + 100 || y > window.innerHeight + 100) return;

    // Create highlight box
    const highlight = document.createElement('div');
    highlight.className = 'fc-element-highlight firecrawl-agent-annotation';
    highlight.style.cssText = \`
      position: fixed;
      left: \${x - 2}px;
      top: \${y - 2}px;
      width: \${width + 4}px;
      height: \${height + 4}px;
    \`;
    container.appendChild(highlight);

    // Create number badge
    const badge = document.createElement('div');
    badge.className = 'fc-number-badge firecrawl-agent-annotation';
    badge.textContent = el.id.toString();

    // Position badge at top-left of element, but keep it visible
    let badgeX = x - 8;
    let badgeY = y - 12;

    // Keep badge on screen
    if (badgeX < 0) badgeX = x;
    if (badgeY < 0) badgeY = y + height;

    badge.style.cssText = \`
      position: fixed;
      left: \${badgeX}px;
      top: \${badgeY}px;
    \`;
    container.appendChild(badge);
  });

  return { success: true, annotatedCount: elements.length };
})();
`;
}

/**
 * JavaScript to remove all annotations from the page
 */
export const REMOVE_ANNOTATIONS_SCRIPT = `
(function() {
  const annotations = document.querySelectorAll('.firecrawl-agent-annotation');
  annotations.forEach(el => el.remove());
  return { success: true, removedCount: annotations.length };
})();
`;

/**
 * Filter elements to only those visible in the current viewport
 */
export function filterVisibleElements(
  elements: NumberedElement[],
  viewportWidth: number,
  viewportHeight: number,
): NumberedElement[] {
  return elements.filter(el => {
    if (!el.boundingBox) return false;

    const { x, y, width, height } = el.boundingBox;

    // Check if element is at least partially visible in viewport
    const isVisible =
      x + width > 0 &&
      y + height > 0 &&
      x < viewportWidth &&
      y < viewportHeight;

    // Check if element has reasonable size
    const hasSize = width >= 5 && height >= 5;

    return isVisible && hasSize;
  });
}

/**
 * Limit the number of annotations to avoid cluttering the screenshot
 */
export function limitAnnotations(
  elements: NumberedElement[],
  maxAnnotations: number = 50,
): NumberedElement[] {
  if (elements.length <= maxAnnotations) {
    return elements;
  }

  // Prioritize elements by type and position
  const priorityOrder = ["button", "a", "input", "select", "textarea"];

  const sorted = [...elements].sort((a, b) => {
    // First by tag priority
    const aPriority = priorityOrder.indexOf(a.tag);
    const bPriority = priorityOrder.indexOf(b.tag);

    if (aPriority !== -1 && bPriority !== -1) {
      if (aPriority !== bPriority) return aPriority - bPriority;
    } else if (aPriority !== -1) {
      return -1;
    } else if (bPriority !== -1) {
      return 1;
    }

    // Then by position (top to bottom, left to right)
    if (a.boundingBox && b.boundingBox) {
      const yDiff = a.boundingBox.y - b.boundingBox.y;
      if (Math.abs(yDiff) > 50) return yDiff;
      return a.boundingBox.x - b.boundingBox.x;
    }

    return 0;
  });

  return sorted.slice(0, maxAnnotations);
}
