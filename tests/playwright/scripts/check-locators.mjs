// Fails when a spec file creates or selects a Playwright locator directly.
// Uses the TypeScript type checker, so it flags real calls on Page/Frame/Locator values only;
// comments, strings and same-named methods on other types (e.g. Array.filter) are ignored.
// Page objects and components (pages/**) are not scanned: that is where locators belong.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const specDirs = ['api', 'ui', 'hybrid'].map((d) => path.join(root, d) + path.sep);
// Optional explicit files (used to self-test the checker); default: every *.spec.ts under api/, ui/, hybrid/.
const explicit = process.argv.slice(2).map((f) => path.resolve(f));

const LOCATOR_METHODS = new Set([
  // create
  'locator', 'frameLocator', 'getByTestId', 'getByRole', 'getByLabel', 'getByText',
  'getByPlaceholder', 'getByAltText', 'getByTitle',
  // select / refine
  'nth', 'first', 'last', 'filter', 'and', 'or',
  // element-handle selectors
  '$', '$$', '$eval', '$$eval', 'waitForSelector',
]);
const OWNER_TYPES = new Set(['Page', 'Frame', 'Locator', 'FrameLocator']);

const config = ts.getParsedCommandLineOfConfigFile(path.join(root, 'tsconfig.json'), {}, { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => {} });
const files = explicit.length ? explicit : config.fileNames.map((f) => path.resolve(f));
const program = ts.createProgram({ rootNames: [...new Set([...config.fileNames, ...files])], options: config.options });
const checker = program.getTypeChecker();

const isSpec = (file) =>
  explicit.length ? explicit.includes(path.resolve(file)) : file.endsWith('.spec.ts') && specDirs.some((d) => path.resolve(file).startsWith(d));

const violations = [];
for (const source of program.getSourceFiles()) {
  if (!isSpec(source.fileName)) continue;
  const visit = (node) => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const name = node.expression.name.text;
      if (LOCATOR_METHODS.has(name)) {
        const owner = checker.getTypeAtLocation(node.expression.expression);
        const ownerName = (owner.aliasSymbol ?? owner.getSymbol())?.getName();
        if (ownerName && OWNER_TYPES.has(ownerName)) {
          const { line, character } = source.getLineAndCharacterOfPosition(node.getStart(source));
          violations.push(`${path.relative(root, source.fileName)}:${line + 1}:${character + 1}  ${ownerName}.${name}() — move it into a page object or component accessor`);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
}

if (violations.length) {
  console.error(`check:locators found ${violations.length} direct locator call(s) in spec files:\n  ${violations.join('\n  ')}`);
  process.exit(1);
}
console.log('check:locators: no direct locator calls in spec files.');
