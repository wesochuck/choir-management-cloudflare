#!/usr/bin/env node
// Enforces vertical alignment invariants across checkboxes, dropdowns (<select>
// and <details> summaries), text inputs, and inline action buttons.
//
// 1. Canonical choice controls (.checkbox-row, .checkbox-field, .checkbox-label,
//    .field-checkbox) must center single-line checkboxes with their label text
//    and match --control-height (2.5rem) when sharing a horizontal row with
//    inputs, selects, or dropdowns.
// 2. Custom <details> dropdown summaries (*picker* summary, *filter* summary)
//    must use var(--control-height) or var(--control-height-sm), never raw rem.
// 3. Inline action buttons placed in the same row as <input>, <select>, or
//    dropdown pickers must use .button--control-height (or .button--small / a
//    dedicated CSS control-height rule), and must not sit beside a .field that
//    stacks .field-help below the input without an input-row wrapper.
import fs, { globSync } from "node:fs";
import ts from "typescript";

const failures = [];

// --- 1. Check canonical CSS rules in forms-layouts.css & shell-refinements.css ---
const formsLayoutsPath = "apps/web/src/styles/components/forms-layouts.css";
const shellRefinementsPath = "apps/web/src/styles/components/shell-refinements.css";

const formsLayoutsCss = fs.readFileSync(formsLayoutsPath, "utf8");
const shellRefinementsCss = fs.readFileSync(shellRefinementsPath, "utf8");

if (
  !/\.choice-field,\s*\.checkbox-row,\s*\.checkbox-field,\s*\.checkbox-label,\s*\.field-checkbox\s*\{[^}]*align-items:\s*center;/s.test(
    formsLayoutsCss,
  )
) {
  failures.push(
    `${formsLayoutsPath}: canonical single-line choice controls (.checkbox-row, .checkbox-field, .checkbox-label, .field-checkbox) must default to align-items: center;`,
  );
}

if (
  !/\.checkbox-label input\[type="radio"\],\s*\.field-checkbox input\[type="checkbox"\],\s*\.field-checkbox input\[type="radio"\]\s*\{[^}]*margin:\s*0;/s.test(
    formsLayoutsCss,
  )
) {
  failures.push(
    `${formsLayoutsPath}: canonical single-line choice inputs must use margin: 0 (scoping margin-top: var(--spacing-3xs) only to multi-line choice descriptions).`,
  );
}

if (
  !/label:has\(> input\[type="checkbox"\]\)\s*\):not\(:has\(\.choice-field__content,\s*\.field-help,\s*small\)\):not\(\.checkbox-row--compact\)\s*\{\s*min-height:\s*var\(--control-height\);\s*align-items:\s*center;/s.test(
    shellRefinementsCss,
  )
) {
  failures.push(
    `${shellRefinementsPath}: single-line checkbox controls in inline control rows must enforce min-height: var(--control-height) and align-items: center.`,
  );
}

// --- 1b. Check modal sticky action bar / footer full-bleed geometry in overlays.css & music-library.css ---
const overlaysPath = "apps/web/src/styles/components/overlays.css";
const musicLibraryPath = "apps/web/src/styles/components/music-library.css";
const overlaysCss = fs.readFileSync(overlaysPath, "utf8");
const musicLibraryCss = fs.readFileSync(musicLibraryPath, "utf8");

if (
  !/\.dialog:not\(\.dialog--confirmation\)\s*\.dialog__body:has\(\.dialog__actions,\s*\.track-import-review-footer,\s*\.sticky-form-actions\)\s*\{\s*padding-bottom:\s*0;/s.test(
    overlaysCss,
  )
) {
  failures.push(
    `${overlaysPath}: .dialog__body containing a sticky action bar must set padding-bottom: 0 so content cannot peek below the sticky footer.`,
  );
}

if (
  !/\.dialog__actions\s*\{[^}]*margin-inline:\s*calc\(-1\s*\*\s*var\(--spacing-lg\)\);[^}]*padding:\s*var\(--spacing-sm\)\s+var\(--spacing-lg\)\s+var\(--spacing-lg\);/s.test(
    overlaysCss,
  )
) {
  failures.push(
    `${overlaysPath}: .dialog__actions must use full-bleed margin-inline: calc(-1 * var(--spacing-lg)) and padding: var(--spacing-sm) var(--spacing-lg) var(--spacing-lg) so scrolled content cannot peek around or below the action bar.`,
  );
}

if (
  !/\.track-import-review-footer\s*\{[^}]*margin-inline:\s*calc\(-1\s*\*\s*var\(--spacing-lg\)\);[^}]*padding:\s*var\(--spacing-sm\)\s+var\(--spacing-lg\)\s+var\(--spacing-lg\);/s.test(
    musicLibraryCss,
  ) ||
  /\.track-import-review-footer\s*\{[^}]*border-radius:/s.test(musicLibraryCss)
) {
  failures.push(
    `${musicLibraryPath}: .track-import-review-footer must be full-bleed without border-radius so scrolled content cannot peek around or below the footer.`,
  );
}

// --- 2. Scan CSS files for dropdown summary & filter row geometry regressions ---
const cssFiles = globSync("apps/web/src/styles/**/*.css");
const summaryBlockRe = /([^{}\n]+summary)\s*\{([^}]*)\}/g;

for (const file of cssFiles) {
  const content = fs.readFileSync(file, "utf8");

  if (file.endsWith("signed-in-workspace.css")) {
    const rosterFilterMatch = content.match(/\.roster-filter-row\s*\{([^}]*)\}/s);
    if (rosterFilterMatch && /align-items:\s*(flex-)?end/.test(rosterFilterMatch[1])) {
      failures.push(
        `${file}: .roster-filter-row must use align-items: center (not flex-end/end) so checkboxes and dropdowns share a vertical midline.`,
      );
    }
  }

  for (const match of content.matchAll(summaryBlockRe)) {
    const selector = match[1].trim();
    const body = match[2];
    if (!/(picker|filter)/.test(selector)) continue;
    const minHeightMatch = body.match(/min-height:\s*([^;]+);/);
    if (!minHeightMatch) continue;
    const value = minHeightMatch[1].trim();
    if (!value.includes("var(--control-height")) {
      const lineNum = content.slice(0, match.index).split("\n").length;
      failures.push(
        `${file}:${lineNum}: "${selector}" sets min-height: ${value}; custom dropdown summaries must use var(--control-height) or var(--control-height-sm).`,
      );
    }
  }

  // Generic .field input rules in stylesheets must exclude checkboxes and radios
  const genericFieldInputRe =
    /(?:^|\n)\s*(?:\.signed-in-main\s+)?\.field\s+input(?!\s*:\s*not\([^)]*checkbox)/g;
  for (const match of content.matchAll(genericFieldInputRe)) {
    const lineNum = content.slice(0, match.index).split("\n").length;
    failures.push(
      `${file}:${lineNum}: generic ".field input" rules must exclude checkboxes and radios with :not([type="checkbox"]):not([type="radio"]).`,
    );
  }
}

// --- 3. Scan TSX files for inline control rows with unaligned buttons or help text ---
const tsxFiles = [
  ...globSync("apps/web/src/**/*.tsx"),
  ...globSync("packages/ui/src/**/*.tsx"),
].filter((file) => !file.includes(".test.") && !file.includes(".spec."));

// Container classes that already enforce height: var(--control-height) on descendant .button in CSS
const cssControlHeightContainers = new Set([
  "ticket-scanner__toolbar",
  "music-piece-performance-actions",
  "calendar-feed-url-row",
]);

const inlineControlRowClassRe =
  /(^|\s)(roster-filter-row|roster-configuration-row|music-catalog-toolbar|reports-toolbar|platform-email-suppressions__filters|platform-dead-letter-toolbar|platform-reconciliation-controls|set-list-copy-row|inline-contact-list-creator|contacts-bulk-actions|profile-folder-row)(\s|$)/;

function getStaticClassName(attributes) {
  for (const prop of attributes.properties) {
    if (!ts.isJsxAttribute(prop) || prop.name.text !== "className" || !prop.initializer) {
      continue;
    }
    if (ts.isStringLiteral(prop.initializer)) {
      return prop.initializer.text;
    }
    if (
      ts.isJsxExpression(prop.initializer) &&
      prop.initializer.expression &&
      ts.isStringLiteral(prop.initializer.expression)
    ) {
      return prop.initializer.expression.text;
    }
    if (
      ts.isJsxExpression(prop.initializer) &&
      prop.initializer.expression &&
      ts.isTemplateExpression(prop.initializer.expression)
    ) {
      return prop.initializer.expression.head.text;
    }
  }
  return "";
}

function getTagName(node) {
  if (ts.isJsxElement(node)) {
    return node.openingElement.tagName.getText();
  }
  if (ts.isJsxSelfClosingElement(node)) {
    return node.tagName.getText();
  }
  return "";
}

function getAttributes(node) {
  if (ts.isJsxElement(node)) {
    return node.openingElement.attributes;
  }
  if (ts.isJsxSelfClosingElement(node)) {
    return node.attributes;
  }
  return null;
}

function collectJsxDescendants(node, predicate, stopAtNestedControlRow = false) {
  const matches = [];
  function visit(current) {
    if (current !== node && (ts.isJsxElement(current) || ts.isJsxSelfClosingElement(current))) {
      const attrs = getAttributes(current);
      const cls = attrs ? getStaticClassName(attrs) : "";
      if (stopAtNestedControlRow && inlineControlRowClassRe.test(cls)) {
        return;
      }
      if (predicate(current, cls)) {
        matches.push({ node: current, className: cls });
      }
    }
    ts.forEachChild(current, visit);
  }
  visit(node);
  return matches;
}

for (const file of tsxFiles) {
  const sourceText = fs.readFileSync(file, "utf8");
  const sourceFile = ts.createSourceFile(
    file,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );

  function visitNode(node) {
    if (ts.isJsxElement(node)) {
      const className = getStaticClassName(node.openingElement.attributes);
      const classTokens = new Set(className.split(/\s+/).filter(Boolean));
      const isKnownRow = inlineControlRowClassRe.test(className);
      const hasCssControlHeight = [...classTokens].some((t) => cssControlHeightContainers.has(t));

      // Also check .form-actions inside membership/invitation rows that pair a .field <select> with buttons
      const isFormActionsWithField =
        classTokens.has("form-actions") &&
        node.children.some(
          (child) =>
            ts.isJsxElement(child) &&
            getStaticClassName(child.openingElement.attributes).split(/\s+/).includes("field"),
        );

      if ((isKnownRow || isFormActionsWithField) && !hasCssControlHeight) {
        // Check that any button.button / a.button inside this inline control row has button--control-height or button--small
        const buttons = collectJsxDescendants(
          node,
          (el, cls) => {
            const tag = getTagName(el);
            const tokens = cls.split(/\s+/);
            return (tag === "button" || tag === "a") && tokens.includes("button");
          },
          true,
        );

        for (const btn of buttons) {
          const btnTokens = btn.className.split(/\s+/);
          if (
            !btnTokens.includes("button--control-height") &&
            !btnTokens.includes("button--small")
          ) {
            const { line } = sourceFile.getLineAndCharacterOfPosition(btn.node.getStart());
            failures.push(
              `${file}:${line + 1}: inline control row "${className}" contains <${getTagName(btn.node)} className="${btn.className}"> without "button--control-height" (or "button--small").`,
            );
          }
        }

        // Check that a direct-child .field containing .field-help does not sit beside a direct-child button without an input-row wrapper
        const directFieldWithHelp = node.children.some((child) => {
          if (!ts.isJsxElement(child)) return false;
          const childTokens = getStaticClassName(child.openingElement.attributes).split(/\s+/);
          if (!childTokens.includes("field")) return false;
          const helpNodes = collectJsxDescendants(child, (_el, cls) =>
            cls.split(/\s+/).includes("field-help"),
          );
          return helpNodes.length > 0;
        });
        const directButton = node.children.find((child) => {
          if (!ts.isJsxElement(child) && !ts.isJsxSelfClosingElement(child)) return false;
          const tag = getTagName(child);
          const attrs = getAttributes(child);
          const cls = attrs ? getStaticClassName(attrs) : "";
          return (tag === "button" || tag === "a") && cls.split(/\s+/).includes("button");
        });
        if (directFieldWithHelp && directButton) {
          const { line } = sourceFile.getLineAndCharacterOfPosition(directButton.getStart());
          failures.push(
            `${file}:${line + 1}: inline control row "${className}" places a direct <button> sibling next to a .field containing .field-help, which pushes the button below the input. Wrap the input and button in an input-row above .field-help.`,
          );
        }
      }
    }
    ts.forEachChild(node, visitNode);
  }

  visitNode(sourceFile);
}

if (failures.length > 0) {
  console.error(
    `check:control-alignment failed — ${failures.length} control alignment violation(s) found:\n` +
      failures.map((f) => `  - ${f}`).join("\n"),
  );
  process.exit(1);
} else {
  console.log(
    "check:control-alignment passed — checkboxes, dropdowns, inputs, and inline buttons follow shared control geometry.",
  );
}
