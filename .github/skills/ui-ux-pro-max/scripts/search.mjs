#!/usr/bin/env node
// @ts-check
/**
 * UI/UX Pro Max Search — Node port of the original Python BM25 search engine.
 * Pure Node (no dependencies). Works anywhere Node >= 16 is available.
 *
 * Usage:
 *   node search.mjs "<query>" [--domain <domain>] [--stack <stack>] [--max-results 3] [--json]
 *   node search.mjs "<query>" --design-system [-p "Project Name"] [-f markdown|ascii]
 *   node search.mjs "<query>" --design-system --persist [-p "Project Name"] [--page "dashboard"] [-o <dir>]
 *
 * Domains: style, color, chart, landing, product, ux, typography, icons, react, web
 * Stacks:  html-tailwind, react, nextjs, astro, vue, nuxtjs, nuxt-ui, svelte,
 *          swiftui, react-native, flutter, shadcn, jetpack-compose
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, '..', 'data');
const MAX_RESULTS = 3;
const REASONING_FILE = 'ui-reasoning.csv';

// ============ DOMAIN / STACK CONFIG ============
const CSV_CONFIG = {
  style: {
    file: 'styles.csv',
    search_cols: ['Style Category', 'Keywords', 'Best For', 'Type', 'AI Prompt Keywords'],
    output_cols: ['Style Category', 'Type', 'Keywords', 'Primary Colors', 'Effects & Animation', 'Best For', 'Performance', 'Accessibility', 'Framework Compatibility', 'Complexity', 'AI Prompt Keywords', 'CSS/Technical Keywords', 'Implementation Checklist', 'Design System Variables'],
  },
  color: {
    file: 'colors.csv',
    search_cols: ['Product Type', 'Notes'],
    output_cols: ['Product Type', 'Primary (Hex)', 'Secondary (Hex)', 'CTA (Hex)', 'Background (Hex)', 'Text (Hex)', 'Notes'],
  },
  chart: {
    file: 'charts.csv',
    search_cols: ['Data Type', 'Keywords', 'Best Chart Type', 'Accessibility Notes'],
    output_cols: ['Data Type', 'Keywords', 'Best Chart Type', 'Secondary Options', 'Color Guidance', 'Accessibility Notes', 'Library Recommendation', 'Interactive Level'],
  },
  landing: {
    file: 'landing.csv',
    search_cols: ['Pattern Name', 'Keywords', 'Conversion Optimization', 'Section Order'],
    output_cols: ['Pattern Name', 'Keywords', 'Section Order', 'Primary CTA Placement', 'Color Strategy', 'Conversion Optimization'],
  },
  product: {
    file: 'products.csv',
    search_cols: ['Product Type', 'Keywords', 'Primary Style Recommendation', 'Key Considerations'],
    output_cols: ['Product Type', 'Keywords', 'Primary Style Recommendation', 'Secondary Styles', 'Landing Page Pattern', 'Dashboard Style (if applicable)', 'Color Palette Focus'],
  },
  ux: {
    file: 'ux-guidelines.csv',
    search_cols: ['Category', 'Issue', 'Description', 'Platform'],
    output_cols: ['Category', 'Issue', 'Platform', 'Description', 'Do', "Don't", 'Code Example Good', 'Code Example Bad', 'Severity'],
  },
  typography: {
    file: 'typography.csv',
    search_cols: ['Font Pairing Name', 'Category', 'Mood/Style Keywords', 'Best For', 'Heading Font', 'Body Font'],
    output_cols: ['Font Pairing Name', 'Category', 'Heading Font', 'Body Font', 'Mood/Style Keywords', 'Best For', 'Google Fonts URL', 'CSS Import', 'Tailwind Config', 'Notes'],
  },
  icons: {
    file: 'icons.csv',
    search_cols: ['Category', 'Icon Name', 'Keywords', 'Best For'],
    output_cols: ['Category', 'Icon Name', 'Keywords', 'Library', 'Import Code', 'Usage', 'Best For', 'Style'],
  },
  react: {
    file: 'react-performance.csv',
    search_cols: ['Category', 'Issue', 'Keywords', 'Description'],
    output_cols: ['Category', 'Issue', 'Platform', 'Description', 'Do', "Don't", 'Code Example Good', 'Code Example Bad', 'Severity'],
  },
  web: {
    file: 'web-interface.csv',
    search_cols: ['Category', 'Issue', 'Keywords', 'Description'],
    output_cols: ['Category', 'Issue', 'Platform', 'Description', 'Do', "Don't", 'Code Example Good', 'Code Example Bad', 'Severity'],
  },
};

const STACK_FILES = {
  'html-tailwind': 'stacks/html-tailwind.csv',
  react: 'stacks/react.csv',
  nextjs: 'stacks/nextjs.csv',
  astro: 'stacks/astro.csv',
  vue: 'stacks/vue.csv',
  nuxtjs: 'stacks/nuxtjs.csv',
  'nuxt-ui': 'stacks/nuxt-ui.csv',
  svelte: 'stacks/svelte.csv',
  swiftui: 'stacks/swiftui.csv',
  'react-native': 'stacks/react-native.csv',
  flutter: 'stacks/flutter.csv',
  shadcn: 'stacks/shadcn.csv',
  'jetpack-compose': 'stacks/jetpack-compose.csv',
};

const STACK_COLS = {
  search_cols: ['Category', 'Guideline', 'Description', 'Do', "Don't"],
  output_cols: ['Category', 'Guideline', 'Description', 'Do', "Don't", 'Code Good', 'Code Bad', 'Severity', 'Docs URL'],
};

const AVAILABLE_STACKS = Object.keys(STACK_FILES);

// ============ CSV PARSER (RFC 4180-ish) ============
/** @param {string} text @returns {string[][]} */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field); field = '';
    } else if (c === '\n') {
      row.push(field); field = '';
      rows.push(row); row = [];
    } else if (c === '\r') {
      // ignore; handled by \n
    } else field += c;
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

/** @param {string} filepath @returns {Record<string,string>[]} */
function loadCsv(filepath) {
  const text = fs.readFileSync(filepath, 'utf-8');
  const rows = parseCsv(text);
  if (rows.length === 0) return [];
  const header = rows[0];
  const out = [];
  for (let r = 1; r < rows.length; r++) {
    const cells = rows[r];
    if (cells.length === 1 && cells[0] === '') continue;
    const obj = {};
    for (let c = 0; c < header.length; c++) obj[header[c]] = cells[c] ?? '';
    out.push(obj);
  }
  return out;
}

// ============ BM25 ============
class BM25 {
  constructor(k1 = 1.5, b = 0.75) {
    this.k1 = k1; this.b = b;
    this.corpus = []; this.docLengths = []; this.avgdl = 0;
    this.idf = new Map(); this.N = 0;
  }
  /** @param {string} text @returns {string[]} */
  tokenize(text) {
    return String(text).toLowerCase().replace(/[^\w\s]/g, ' ').split(/\s+/).filter((w) => w.length > 2);
  }
  /** @param {string[]} documents */
  fit(documents) {
    this.corpus = documents.map((d) => this.tokenize(d));
    this.N = this.corpus.length;
    if (this.N === 0) return;
    this.docLengths = this.corpus.map((d) => d.length);
    this.avgdl = this.docLengths.reduce((a, b) => a + b, 0) / this.N;
    const docFreqs = new Map();
    for (const doc of this.corpus) {
      const seen = new Set();
      for (const w of doc) {
        if (!seen.has(w)) { docFreqs.set(w, (docFreqs.get(w) || 0) + 1); seen.add(w); }
      }
    }
    for (const [w, freq] of docFreqs) {
      this.idf.set(w, Math.log((this.N - freq + 0.5) / (freq + 0.5) + 1));
    }
  }
  /** @param {string} query @returns {[number, number][]} */
  score(query) {
    const queryTokens = this.tokenize(query);
    const scores = [];
    for (let idx = 0; idx < this.corpus.length; idx++) {
      const doc = this.corpus[idx];
      const docLen = this.docLengths[idx];
      const termFreqs = new Map();
      for (const w of doc) termFreqs.set(w, (termFreqs.get(w) || 0) + 1);
      let score = 0;
      for (const token of queryTokens) {
        const idf = this.idf.get(token);
        if (idf !== undefined) {
          const tf = termFreqs.get(token) || 0;
          const numerator = tf * (this.k1 + 1);
          const denominator = tf + this.k1 * (1 - this.b + (this.b * docLen) / this.avgdl);
          score += (idf * numerator) / denominator;
        }
      }
      scores.push([idx, score]);
    }
    scores.sort((a, b) => b[1] - a[1]);
    return scores;
  }
}

/** @param {string} filepath @param {string[]} searchCols @param {string[]} outputCols @param {string} query @param {number} maxResults */
function searchCsv(filepath, searchCols, outputCols, query, maxResults) {
  if (!fs.existsSync(filepath)) return [];
  const data = loadCsv(filepath);
  const documents = data.map((row) => searchCols.map((col) => row[col] ?? '').join(' '));
  const bm25 = new BM25();
  bm25.fit(documents);
  const ranked = bm25.score(query);
  const results = [];
  for (const [idx, score] of ranked.slice(0, maxResults)) {
    if (score > 0) {
      const row = data[idx];
      const picked = {};
      for (const col of outputCols) if (col in row) picked[col] = row[col];
      results.push(picked);
    }
  }
  return results;
}

// ============ DOMAIN DETECTION ============
const DOMAIN_KEYWORDS = {
  color: ['color', 'palette', 'hex', '#', 'rgb'],
  chart: ['chart', 'graph', 'visualization', 'trend', 'bar', 'pie', 'scatter', 'heatmap', 'funnel'],
  landing: ['landing', 'page', 'cta', 'conversion', 'hero', 'testimonial', 'pricing', 'section'],
  product: ['saas', 'ecommerce', 'e-commerce', 'fintech', 'healthcare', 'gaming', 'portfolio', 'crypto', 'dashboard'],
  style: ['style', 'design', 'ui', 'minimalism', 'glassmorphism', 'neumorphism', 'brutalism', 'dark mode', 'flat', 'aurora', 'prompt', 'css', 'implementation', 'variable', 'checklist', 'tailwind'],
  ux: ['ux', 'usability', 'accessibility', 'wcag', 'touch', 'scroll', 'animation', 'keyboard', 'navigation', 'mobile'],
  typography: ['font', 'typography', 'heading', 'serif', 'sans'],
  icons: ['icon', 'icons', 'lucide', 'heroicons', 'symbol', 'glyph', 'pictogram', 'svg icon'],
  react: ['react', 'next.js', 'nextjs', 'suspense', 'memo', 'usecallback', 'useeffect', 'rerender', 'bundle', 'waterfall', 'barrel', 'dynamic import', 'rsc', 'server component'],
  web: ['aria', 'focus', 'outline', 'semantic', 'virtualize', 'autocomplete', 'form', 'input type', 'preconnect'],
};

/** @param {string} query @returns {string} */
function detectDomain(query) {
  const q = query.toLowerCase();
  let best = 'style';
  let bestScore = 0;
  for (const [domain, keywords] of Object.entries(DOMAIN_KEYWORDS)) {
    const score = keywords.reduce((acc, kw) => acc + (q.includes(kw) ? 1 : 0), 0);
    if (score > bestScore) { bestScore = score; best = domain; }
  }
  return bestScore > 0 ? best : 'style';
}

/** @param {string} query @param {string|null} domain @param {number} maxResults */
function search(query, domain = null, maxResults = MAX_RESULTS) {
  const d = domain || detectDomain(query);
  const config = CSV_CONFIG[d] || CSV_CONFIG.style;
  const filepath = path.join(DATA_DIR, config.file);
  if (!fs.existsSync(filepath)) return { error: `File not found: ${filepath}`, domain: d };
  const results = searchCsv(filepath, config.search_cols, config.output_cols, query, maxResults);
  return { domain: d, query, file: config.file, count: results.length, results };
}

/** @param {string} query @param {string} stack @param {number} maxResults */
function searchStack(query, stack, maxResults = MAX_RESULTS) {
  if (!STACK_FILES[stack]) return { error: `Unknown stack: ${stack}. Available: ${AVAILABLE_STACKS.join(', ')}` };
  const filepath = path.join(DATA_DIR, STACK_FILES[stack]);
  if (!fs.existsSync(filepath)) return { error: `Stack file not found: ${filepath}`, stack };
  const results = searchCsv(filepath, STACK_COLS.search_cols, STACK_COLS.output_cols, query, maxResults);
  return { domain: 'stack', stack, query, file: STACK_FILES[stack], count: results.length, results };
}

// ============ DESIGN SYSTEM GENERATOR ============
const DS_SEARCH_CONFIG = {
  product: 1, style: 3, color: 2, landing: 2, typography: 2,
};

let _reasoningCache = null;
function loadReasoning() {
  if (_reasoningCache) return _reasoningCache;
  const filepath = path.join(DATA_DIR, REASONING_FILE);
  _reasoningCache = fs.existsSync(filepath) ? loadCsv(filepath) : [];
  return _reasoningCache;
}

/** @param {string} category */
function findReasoningRule(category) {
  const cat = category.toLowerCase();
  const rules = loadReasoning();
  for (const rule of rules) if ((rule['UI_Category'] || '').toLowerCase() === cat) return rule;
  for (const rule of rules) {
    const ui = (rule['UI_Category'] || '').toLowerCase();
    if (ui && (ui.includes(cat) || cat.includes(ui))) return rule;
  }
  for (const rule of rules) {
    const ui = (rule['UI_Category'] || '').toLowerCase();
    const keywords = ui.replace(/[/-]/g, ' ').split(/\s+/).filter(Boolean);
    if (keywords.some((kw) => cat.includes(kw))) return rule;
  }
  return {};
}

/** @param {string} category */
function applyReasoning(category) {
  const rule = findReasoningRule(category);
  if (!rule || Object.keys(rule).length === 0) {
    return {
      pattern: 'Hero + Features + CTA',
      style_priority: ['Minimalism', 'Flat Design'],
      color_mood: 'Professional',
      typography_mood: 'Clean',
      key_effects: 'Subtle hover transitions',
      anti_patterns: '',
      decision_rules: {},
      severity: 'MEDIUM',
    };
  }
  let decisionRules = {};
  try { decisionRules = JSON.parse(rule['Decision_Rules'] || '{}'); } catch { /* ignore */ }
  return {
    pattern: rule['Recommended_Pattern'] || '',
    style_priority: (rule['Style_Priority'] || '').split('+').map((s) => s.trim()),
    color_mood: rule['Color_Mood'] || '',
    typography_mood: rule['Typography_Mood'] || '',
    key_effects: rule['Key_Effects'] || '',
    anti_patterns: rule['Anti_Patterns'] || '',
    decision_rules: decisionRules,
    severity: rule['Severity'] || 'MEDIUM',
  };
}

/** @param {Record<string,string>[]} results @param {string[]} priorityKeywords */
function selectBestMatch(results, priorityKeywords) {
  if (!results || results.length === 0) return {};
  if (!priorityKeywords || priorityKeywords.length === 0) return results[0];
  for (const priority of priorityKeywords) {
    const p = priority.toLowerCase().trim();
    for (const result of results) {
      const styleName = (result['Style Category'] || '').toLowerCase();
      if (p && (styleName.includes(p) || (styleName && p.includes(styleName)))) return result;
    }
  }
  const scored = [];
  for (const result of results) {
    const resultStr = JSON.stringify(result).toLowerCase();
    let score = 0;
    for (const kw of priorityKeywords) {
      const k = kw.toLowerCase().trim();
      if (!k) continue;
      if ((result['Style Category'] || '').toLowerCase().includes(k)) score += 10;
      else if ((result['Keywords'] || '').toLowerCase().includes(k)) score += 3;
      else if (resultStr.includes(k)) score += 1;
    }
    scored.push([score, result]);
  }
  scored.sort((a, b) => b[0] - a[0]);
  return scored.length && scored[0][0] > 0 ? scored[0][1] : results[0];
}

/** @param {string} query @param {string|null} projectName */
function generateDesignSystem(query, projectName = null) {
  const productResult = search(query, 'product', 1);
  const productResults = productResult.results || [];
  const category = productResults.length ? productResults[0]['Product Type'] || 'General' : 'General';

  const reasoning = applyReasoning(category);
  const stylePriority = reasoning.style_priority || [];

  const styleQuery = stylePriority.length ? `${query} ${stylePriority.slice(0, 2).join(' ')}` : query;
  const styleResults = (search(styleQuery, 'style', DS_SEARCH_CONFIG.style).results) || [];
  const colorResults = (search(query, 'color', DS_SEARCH_CONFIG.color).results) || [];
  const typographyResults = (search(query, 'typography', DS_SEARCH_CONFIG.typography).results) || [];
  const landingResults = (search(query, 'landing', DS_SEARCH_CONFIG.landing).results) || [];

  const bestStyle = selectBestMatch(styleResults, reasoning.style_priority || []);
  const bestColor = colorResults[0] || {};
  const bestTypography = typographyResults[0] || {};
  const bestLanding = landingResults[0] || {};

  const styleEffects = bestStyle['Effects & Animation'] || '';
  const combinedEffects = styleEffects || reasoning.key_effects || '';

  return {
    project_name: projectName || query.toUpperCase(),
    category,
    pattern: {
      name: bestLanding['Pattern Name'] || reasoning.pattern || 'Hero + Features + CTA',
      sections: bestLanding['Section Order'] || 'Hero > Features > CTA',
      cta_placement: bestLanding['Primary CTA Placement'] || 'Above fold',
      color_strategy: bestLanding['Color Strategy'] || '',
      conversion: bestLanding['Conversion Optimization'] || '',
    },
    style: {
      name: bestStyle['Style Category'] || 'Minimalism',
      type: bestStyle['Type'] || 'General',
      effects: styleEffects,
      keywords: bestStyle['Keywords'] || '',
      best_for: bestStyle['Best For'] || '',
      performance: bestStyle['Performance'] || '',
      accessibility: bestStyle['Accessibility'] || '',
    },
    colors: {
      primary: bestColor['Primary (Hex)'] || '#2563EB',
      secondary: bestColor['Secondary (Hex)'] || '#3B82F6',
      cta: bestColor['CTA (Hex)'] || '#F97316',
      background: bestColor['Background (Hex)'] || '#F8FAFC',
      text: bestColor['Text (Hex)'] || '#1E293B',
      notes: bestColor['Notes'] || '',
    },
    typography: {
      heading: bestTypography['Heading Font'] || 'Inter',
      body: bestTypography['Body Font'] || 'Inter',
      mood: bestTypography['Mood/Style Keywords'] || reasoning.typography_mood || '',
      best_for: bestTypography['Best For'] || '',
      google_fonts_url: bestTypography['Google Fonts URL'] || '',
      css_import: bestTypography['CSS Import'] || '',
    },
    key_effects: combinedEffects,
    anti_patterns: reasoning.anti_patterns || '',
    decision_rules: reasoning.decision_rules || {},
    severity: reasoning.severity || 'MEDIUM',
  };
}

const CHECKLIST = [
  'No emojis as icons (use SVG: Heroicons/Lucide)',
  'cursor-pointer on all clickable elements',
  'Hover states with smooth transitions (150-300ms)',
  'Light mode: text contrast 4.5:1 minimum',
  'Focus states visible for keyboard nav',
  'prefers-reduced-motion respected',
  'Responsive: 375px, 768px, 1024px, 1440px',
];

/** @param {ReturnType<typeof generateDesignSystem>} ds */
function formatMarkdown(ds) {
  const { pattern, style, colors, typography } = ds;
  const lines = [];
  lines.push(`## Design System: ${ds.project_name}`, '');
  lines.push('### Pattern');
  lines.push(`- **Name:** ${pattern.name}`);
  if (pattern.conversion) lines.push(`- **Conversion Focus:** ${pattern.conversion}`);
  if (pattern.cta_placement) lines.push(`- **CTA Placement:** ${pattern.cta_placement}`);
  if (pattern.color_strategy) lines.push(`- **Color Strategy:** ${pattern.color_strategy}`);
  lines.push(`- **Sections:** ${pattern.sections}`, '');
  lines.push('### Style');
  lines.push(`- **Name:** ${style.name}`);
  if (style.keywords) lines.push(`- **Keywords:** ${style.keywords}`);
  if (style.best_for) lines.push(`- **Best For:** ${style.best_for}`);
  if (style.performance || style.accessibility) lines.push(`- **Performance:** ${style.performance} | **Accessibility:** ${style.accessibility}`);
  lines.push('');
  lines.push('### Colors', '| Role | Hex |', '|------|-----|');
  lines.push(`| Primary | ${colors.primary} |`);
  lines.push(`| Secondary | ${colors.secondary} |`);
  lines.push(`| CTA | ${colors.cta} |`);
  lines.push(`| Background | ${colors.background} |`);
  lines.push(`| Text | ${colors.text} |`);
  if (colors.notes) lines.push('', `*Notes: ${colors.notes}*`);
  lines.push('');
  lines.push('### Typography');
  lines.push(`- **Heading:** ${typography.heading}`);
  lines.push(`- **Body:** ${typography.body}`);
  if (typography.mood) lines.push(`- **Mood:** ${typography.mood}`);
  if (typography.best_for) lines.push(`- **Best For:** ${typography.best_for}`);
  if (typography.google_fonts_url) lines.push(`- **Google Fonts:** ${typography.google_fonts_url}`);
  if (typography.css_import) lines.push('- **CSS Import:**', '```css', typography.css_import, '```');
  lines.push('');
  if (ds.key_effects) lines.push('### Key Effects', ds.key_effects, '');
  if (ds.anti_patterns) {
    lines.push('### Avoid (Anti-patterns)');
    lines.push(`- ${ds.anti_patterns.split(' + ').join('\n- ')}`, '');
  }
  lines.push('### Pre-Delivery Checklist');
  for (const item of CHECKLIST) lines.push(`- [ ] ${item}`);
  lines.push('');
  return lines.join('\n');
}

/** @param {ReturnType<typeof generateDesignSystem>} ds */
function formatAsciiBox(ds) {
  const W = 90;
  const { pattern, style, colors, typography } = ds;
  const lines = [];
  const bar = '+' + '-'.repeat(W - 1) + '+';
  const pad = (s) => '|' + s.slice(1).padEnd(W - 1) + '|';
  const blank = '|' + ' '.repeat(W) + '|';
  const wrap = (text, prefix) => {
    if (!text) return [];
    const words = String(text).split(/\s+/);
    const out = [];
    let cur = prefix;
    for (const w of words) {
      if (cur.length + w.length + 1 <= W - 2) cur += (cur !== prefix ? ' ' : '') + w;
      else { if (cur !== prefix) out.push(cur); cur = prefix + w; }
    }
    if (cur !== prefix) out.push(cur);
    return out;
  };
  const sections = (pattern.sections || '').split('>').map((s) => s.trim()).filter(Boolean);

  lines.push(bar);
  lines.push('|' + `  TARGET: ${ds.project_name} - RECOMMENDED DESIGN SYSTEM`.padEnd(W) + '|');
  lines.push(bar, blank);
  lines.push('|' + `  PATTERN: ${pattern.name}`.padEnd(W) + '|');
  if (pattern.conversion) lines.push('|' + `     Conversion: ${pattern.conversion}`.padEnd(W) + '|');
  if (pattern.cta_placement) lines.push('|' + `     CTA: ${pattern.cta_placement}`.padEnd(W) + '|');
  lines.push('|' + '     Sections:'.padEnd(W) + '|');
  sections.forEach((s, i) => lines.push('|' + `       ${i + 1}. ${s}`.padEnd(W) + '|'));
  lines.push(blank);
  lines.push('|' + `  STYLE: ${style.name}`.padEnd(W) + '|');
  if (style.keywords) for (const l of wrap(`Keywords: ${style.keywords}`, '|     ')) lines.push(pad(l));
  if (style.best_for) for (const l of wrap(`Best For: ${style.best_for}`, '|     ')) lines.push(pad(l));
  if (style.performance || style.accessibility) lines.push('|' + `     Performance: ${style.performance} | Accessibility: ${style.accessibility}`.padEnd(W) + '|');
  lines.push(blank);
  lines.push('|' + '  COLORS:'.padEnd(W) + '|');
  lines.push('|' + `     Primary:    ${colors.primary}`.padEnd(W) + '|');
  lines.push('|' + `     Secondary:  ${colors.secondary}`.padEnd(W) + '|');
  lines.push('|' + `     CTA:        ${colors.cta}`.padEnd(W) + '|');
  lines.push('|' + `     Background: ${colors.background}`.padEnd(W) + '|');
  lines.push('|' + `     Text:       ${colors.text}`.padEnd(W) + '|');
  if (colors.notes) for (const l of wrap(`Notes: ${colors.notes}`, '|     ')) lines.push(pad(l));
  lines.push(blank);
  lines.push('|' + `  TYPOGRAPHY: ${typography.heading} / ${typography.body}`.padEnd(W) + '|');
  if (typography.mood) for (const l of wrap(`Mood: ${typography.mood}`, '|     ')) lines.push(pad(l));
  if (typography.best_for) for (const l of wrap(`Best For: ${typography.best_for}`, '|     ')) lines.push(pad(l));
  if (typography.google_fonts_url) lines.push('|' + `     Google Fonts: ${typography.google_fonts_url}`.padEnd(W) + '|');
  lines.push(blank);
  if (ds.key_effects) {
    lines.push('|' + '  KEY EFFECTS:'.padEnd(W) + '|');
    for (const l of wrap(ds.key_effects, '|     ')) lines.push(pad(l));
    lines.push(blank);
  }
  if (ds.anti_patterns) {
    lines.push('|' + '  AVOID (Anti-patterns):'.padEnd(W) + '|');
    for (const l of wrap(ds.anti_patterns, '|     ')) lines.push(pad(l));
    lines.push(blank);
  }
  lines.push('|' + '  PRE-DELIVERY CHECKLIST:'.padEnd(W) + '|');
  for (const item of CHECKLIST) lines.push('|' + `     [ ] ${item}`.padEnd(W) + '|');
  lines.push(blank, bar);
  return lines.join('\n');
}

/** Persist the design system markdown to design-system/<slug>/MASTER.md */
function persistDesignSystem(ds, page, outputDir) {
  const baseDir = outputDir ? path.resolve(outputDir) : process.cwd();
  const slug = (ds.project_name || 'default').toLowerCase().replace(/\s+/g, '-');
  const dsDir = path.join(baseDir, 'design-system', slug);
  const pagesDir = path.join(dsDir, 'pages');
  fs.mkdirSync(pagesDir, { recursive: true });
  const master = [
    '# Design System Master File', '',
    '> **LOGIC:** When building a specific page, first check `design-system/pages/[page-name].md`.',
    '> If that file exists, its rules **override** this Master file. If not, follow the rules below.',
    '', '---', '', formatMarkdown(ds),
  ].join('\n');
  const masterFile = path.join(dsDir, 'MASTER.md');
  fs.writeFileSync(masterFile, master, 'utf-8');
  const created = [masterFile];
  if (page) {
    const pageFile = path.join(pagesDir, `${page.toLowerCase().replace(/\s+/g, '-')}.md`);
    const title = page.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    fs.writeFileSync(pageFile, `# ${title} Page Overrides\n\n> **PROJECT:** ${ds.project_name}\n\n_Add page-specific deviations from MASTER.md here. Rules in this file override the Master._\n`, 'utf-8');
    created.push(pageFile);
  }
  return created;
}

// ============ OUTPUT FORMATTER (domain/stack) ============
function formatOutput(result) {
  if (result.error) return `Error: ${result.error}`;
  const out = [];
  if (result.stack) {
    out.push('## UI Pro Max Stack Guidelines');
    out.push(`**Stack:** ${result.stack} | **Query:** ${result.query}`);
  } else {
    out.push('## UI Pro Max Search Results');
    out.push(`**Domain:** ${result.domain} | **Query:** ${result.query}`);
  }
  out.push(`**Source:** ${result.file} | **Found:** ${result.count} results\n`);
  result.results.forEach((row, i) => {
    out.push(`### Result ${i + 1}`);
    for (const [key, value] of Object.entries(row)) {
      let v = String(value);
      if (v.length > 300) v = v.slice(0, 300) + '...';
      out.push(`- **${key}:** ${v}`);
    }
    out.push('');
  });
  return out.join('\n');
}

// ============ CLI ============
function parseArgs(argv) {
  const args = { query: null, domain: null, stack: null, maxResults: MAX_RESULTS, json: false, designSystem: false, projectName: null, format: 'ascii', persist: false, page: null, outputDir: null };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '--domain': case '-d': args.domain = argv[++i]; break;
      case '--stack': case '-s': args.stack = argv[++i]; break;
      case '--max-results': case '-n': args.maxResults = parseInt(argv[++i], 10) || MAX_RESULTS; break;
      case '--json': args.json = true; break;
      case '--design-system': case '-ds': args.designSystem = true; break;
      case '--project-name': case '-p': args.projectName = argv[++i]; break;
      case '--format': case '-f': args.format = argv[++i]; break;
      case '--persist': args.persist = true; break;
      case '--page': args.page = argv[++i]; break;
      case '--output-dir': case '-o': args.outputDir = argv[++i]; break;
      default: positional.push(a);
    }
  }
  args.query = positional.join(' ');
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.query) {
    console.error('Usage: node search.mjs "<query>" [--domain <d>] [--stack <s>] [--design-system] [-p "Name"] [-f markdown] [--json]');
    process.exit(1);
  }
  if (args.designSystem) {
    const ds = generateDesignSystem(args.query, args.projectName);
    console.log(args.format === 'markdown' ? formatMarkdown(ds) : formatAsciiBox(ds));
    if (args.persist) {
      const created = persistDesignSystem(ds, args.page, args.outputDir);
      const slug = (ds.project_name || 'default').toLowerCase().replace(/\s+/g, '-');
      console.log('\n' + '='.repeat(60));
      console.log(`Design system persisted to design-system/${slug}/`);
      for (const f of created) console.log(`   - ${path.relative(process.cwd(), f)}`);
      console.log('='.repeat(60));
    }
    return;
  }
  let result;
  if (args.stack) result = searchStack(args.query, args.stack, args.maxResults);
  else result = search(args.query, args.domain, args.maxResults);
  if (args.json) console.log(JSON.stringify(result, null, 2));
  else console.log(formatOutput(result));
}

main();
