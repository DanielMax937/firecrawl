/**
 * DOM Distiller
 *
 * Extracts a simplified representation of the DOM for LLM analysis:
 * 1. Accessibility tree with numbered interactive elements
 * 2. Simplified HTML with number tags for clickable elements
 *
 * This runs as JavaScript injected into the page via Playwright.
 */

import { DOMDistillation, NumberedElement, A11yNode } from "./types";

/**
 * JavaScript to inject into the page to extract DOM distillation.
 * Returns a DOMDistillation object.
 */
export const DOM_DISTILL_SCRIPT = `
(function() {
  const INTERACTIVE_ROLES = new Set([
    'button', 'link', 'menuitem', 'menuitemcheckbox', 'menuitemradio',
    'option', 'radio', 'switch', 'tab', 'treeitem', 'checkbox',
    'combobox', 'listbox', 'searchbox', 'slider', 'spinbutton', 'textbox'
  ]);

  const INTERACTIVE_TAGS = new Set([
    'A', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'DETAILS', 'SUMMARY'
  ]);

  let elementCounter = 0;
  const numberedElements = [];
  const elementIdMap = new WeakMap();

  function isVisible(el) {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
      return false;
    }
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function isInteractive(el) {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return false;

    // Check tag name
    if (INTERACTIVE_TAGS.has(el.tagName)) return true;

    // Check role attribute
    const role = el.getAttribute('role');
    if (role && INTERACTIVE_ROLES.has(role)) return true;

    // Check for click handlers or tabindex
    if (el.onclick || el.getAttribute('tabindex') !== null) return true;

    // Check for contenteditable
    if (el.isContentEditable) return true;

    // Check cursor style
    const style = window.getComputedStyle(el);
    if (style.cursor === 'pointer') return true;

    return false;
  }

  function getElementText(el) {
    // Get visible text content, truncated
    let text = '';

    // For inputs, get value or placeholder
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
      text = el.value || el.placeholder || el.getAttribute('aria-label') || '';
    } else if (el.tagName === 'SELECT') {
      const selected = el.options[el.selectedIndex];
      text = selected ? selected.text : '';
    } else {
      // Get text content, but not from children that are themselves interactive
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null, false);
      let node;
      while (node = walker.nextNode()) {
        if (isVisible(node.parentElement)) {
          text += node.textContent + ' ';
        }
      }
    }

    return text.trim().substring(0, 100);
  }

  function getSelector(el) {
    // Generate a unique CSS selector for the element
    if (el.id) {
      return '#' + CSS.escape(el.id);
    }

    const path = [];
    let current = el;

    while (current && current !== document.body) {
      let selector = current.tagName.toLowerCase();

      if (current.className && typeof current.className === 'string') {
        const classes = current.className.trim().split(/\\s+/).filter(c => c);
        if (classes.length > 0) {
          selector += '.' + classes.slice(0, 2).map(c => CSS.escape(c)).join('.');
        }
      }

      // Add nth-child if needed for uniqueness
      const parent = current.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter(c => c.tagName === current.tagName);
        if (siblings.length > 1) {
          const index = siblings.indexOf(current) + 1;
          selector += ':nth-of-type(' + index + ')';
        }
      }

      path.unshift(selector);
      current = current.parentElement;
    }

    return path.join(' > ');
  }

  function assignNumber(el) {
    if (elementIdMap.has(el)) {
      return elementIdMap.get(el);
    }

    elementCounter++;
    const id = elementCounter;
    elementIdMap.set(el, id);

    const rect = el.getBoundingClientRect();

    numberedElements.push({
      id: id,
      tag: el.tagName.toLowerCase(),
      text: getElementText(el),
      selector: getSelector(el),
      role: el.getAttribute('role') || undefined,
      attributes: {
        href: el.getAttribute('href') || undefined,
        type: el.getAttribute('type') || undefined,
        name: el.getAttribute('name') || undefined,
        placeholder: el.getAttribute('placeholder') || undefined,
        'aria-label': el.getAttribute('aria-label') || undefined,
      },
      boundingBox: {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height)
      }
    });

    return id;
  }

  function buildA11yTree(el, depth = 0) {
    if (!el || !isVisible(el) || depth > 10) return null;

    const role = el.getAttribute('role') || getImplicitRole(el);
    const name = getAccessibleName(el);

    const node = {
      role: role,
      name: name
    };

    // Assign number if interactive
    if (isInteractive(el) && isVisible(el)) {
      node.id = assignNumber(el);
    }

    // Add value for form elements
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') {
      node.value = el.value || '';
    }

    // Process children
    const children = [];
    for (const child of el.children) {
      const childNode = buildA11yTree(child, depth + 1);
      if (childNode) {
        children.push(childNode);
      }
    }

    if (children.length > 0) {
      node.children = children;
    }

    // Skip nodes that have no meaningful content
    if (!node.name && !node.id && (!node.children || node.children.length === 0)) {
      return null;
    }

    return node;
  }

  function getImplicitRole(el) {
    const roleMap = {
      'A': el.hasAttribute('href') ? 'link' : 'generic',
      'ARTICLE': 'article',
      'ASIDE': 'complementary',
      'BUTTON': 'button',
      'DIALOG': 'dialog',
      'FOOTER': 'contentinfo',
      'FORM': 'form',
      'H1': 'heading',
      'H2': 'heading',
      'H3': 'heading',
      'H4': 'heading',
      'H5': 'heading',
      'H6': 'heading',
      'HEADER': 'banner',
      'IMG': 'img',
      'INPUT': getInputRole(el),
      'LI': 'listitem',
      'MAIN': 'main',
      'NAV': 'navigation',
      'OL': 'list',
      'OPTION': 'option',
      'PROGRESS': 'progressbar',
      'SECTION': 'region',
      'SELECT': 'combobox',
      'TABLE': 'table',
      'TBODY': 'rowgroup',
      'TD': 'cell',
      'TEXTAREA': 'textbox',
      'TH': 'columnheader',
      'TR': 'row',
      'UL': 'list',
    };
    return roleMap[el.tagName] || 'generic';
  }

  function getInputRole(el) {
    const type = el.getAttribute('type') || 'text';
    const inputRoles = {
      'button': 'button',
      'checkbox': 'checkbox',
      'email': 'textbox',
      'number': 'spinbutton',
      'radio': 'radio',
      'range': 'slider',
      'search': 'searchbox',
      'submit': 'button',
      'tel': 'textbox',
      'text': 'textbox',
      'url': 'textbox',
    };
    return inputRoles[type] || 'textbox';
  }

  function getAccessibleName(el) {
    // aria-label takes precedence
    const ariaLabel = el.getAttribute('aria-label');
    if (ariaLabel) return ariaLabel.substring(0, 100);

    // aria-labelledby
    const labelledBy = el.getAttribute('aria-labelledby');
    if (labelledBy) {
      const labelEl = document.getElementById(labelledBy);
      if (labelEl) return labelEl.textContent.trim().substring(0, 100);
    }

    // For images, use alt
    if (el.tagName === 'IMG') {
      return (el.getAttribute('alt') || '').substring(0, 100);
    }

    // For inputs, check associated label
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') {
      const id = el.getAttribute('id');
      if (id) {
        const label = document.querySelector('label[for="' + CSS.escape(id) + '"]');
        if (label) return label.textContent.trim().substring(0, 100);
      }
      return el.getAttribute('placeholder') || '';
    }

    // Default to text content
    return getElementText(el);
  }

  function buildSimplifiedHtml(el, depth = 0) {
    if (!el || !isVisible(el) || depth > 8) return '';

    let html = '';

    // Add number tag if interactive
    const id = elementIdMap.get(el);
    if (id) {
      html += '[' + id + ']';
    }

    // Add text content for leaf nodes
    if (el.children.length === 0) {
      const text = getElementText(el);
      if (text) {
        html += text + ' ';
      }
    } else {
      // Process children
      for (const child of el.children) {
        html += buildSimplifiedHtml(child, depth + 1);
      }
    }

    return html;
  }

  // Main execution
  const a11yTree = buildA11yTree(document.body) || { role: 'document', name: document.title };
  const simplifiedHtml = buildSimplifiedHtml(document.body).trim();

  return {
    a11yTree: a11yTree,
    numberedElements: numberedElements,
    simplifiedHtml: simplifiedHtml.substring(0, 50000), // Limit size
    pageTitle: document.title,
    pageUrl: window.location.href
  };
})();
`;

/**
 * Parse the result from the injected script
 */
export function parseDOMDistillation(result: any): DOMDistillation {
  return {
    a11yTree: result.a11yTree || { role: "document", name: "" },
    numberedElements: result.numberedElements || [],
    simplifiedHtml: result.simplifiedHtml || "",
    pageTitle: result.pageTitle || "",
    pageUrl: result.pageUrl || "",
  };
}

/**
 * Format DOM distillation for LLM consumption
 */
export function formatDOMForLLM(dom: DOMDistillation): string {
  const lines: string[] = [];

  lines.push(`## Page: ${dom.pageTitle}`);
  lines.push(`URL: ${dom.pageUrl}`);
  lines.push("");

  lines.push("## Interactive Elements");
  lines.push("");

  for (const el of dom.numberedElements) {
    const attrs: string[] = [];
    if (el.role) attrs.push(`role=${el.role}`);
    if (el.attributes?.href)
      attrs.push(`href=${el.attributes.href.substring(0, 50)}`);
    if (el.attributes?.type) attrs.push(`type=${el.attributes.type}`);
    if (el.attributes?.placeholder)
      attrs.push(`placeholder="${el.attributes.placeholder}"`);

    const attrStr = attrs.length > 0 ? ` (${attrs.join(", ")})` : "";
    lines.push(`[${el.id}] <${el.tag}>${attrStr}: "${el.text}"`);
  }

  lines.push("");
  lines.push("## Page Content (simplified)");
  lines.push("");
  lines.push(dom.simplifiedHtml.substring(0, 10000));

  return lines.join("\n");
}
