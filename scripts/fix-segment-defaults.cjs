const fs = require('fs');
const path = process.argv[2];
if (!path) {
  console.error('Usage: node fix-segment-defaults.js <file>');
  process.exit(1);
}
let c = fs.readFileSync(path, 'utf8');

if (path.includes('AdminDashboard') && !c.includes('segmentFormValues')) {
  c = c.replace(
    "import SegmentBrokerageFields from '../components/admin/segment/SegmentBrokerageFields.jsx';",
    "import SegmentBrokerageFields from '../components/admin/segment/SegmentBrokerageFields.jsx';\nimport { numInputValue, parseNumInput, parseIntInput } from '../utils/segmentFormValues.js';"
  );
}

const valueReplacements = [
  [/value=\{s\.intradayOnlyLeverage \?\? 1\}/g, 'value={numInputValue(s.intradayOnlyLeverage)}'],
  [/value=\{s\.intradayOnlyMaxQty \?\? 1000\}/g, 'value={numInputValue(s.intradayOnlyMaxQty)}'],
  [/value=\{s\.lotSettings\?\.intradayLeverage \?\? s\.exposureIntraday \?\? 1\}/g, 'value={numInputValue(s.lotSettings?.intradayLeverage ?? s.exposureIntraday)}'],
  [/value=\{s\.lotSettings\?\.carryForwardLeverage \?\? s\.exposureCarryForward \?\? 1\}/g, 'value={numInputValue(s.lotSettings?.carryForwardLeverage ?? s.exposureCarryForward)}'],
  [/value=\{s\.maxLots \?\? 100\}/g, 'value={numInputValue(s.maxLots)}'],
  [/value=\{s\.minLots \?\? 1\}/g, 'value={numInputValue(s.minLots)}'],
  [/value=\{s\.lotSettings\?\.breakupLots \?\? 0\}/g, 'value={numInputValue(s.lotSettings?.breakupLots)}'],
  [/value=\{s\.lotSettings\?\.notificationPercent \?\? 70\}/g, 'value={numInputValue(s.lotSettings?.notificationPercent)}'],
  [/value=\{s\.lotSettings\?\.autosquarePercent \?\? 90\}/g, 'value={numInputValue(s.lotSettings?.autosquarePercent)}'],
  [/value=\{s\.quantityModeSettings\?\.intradayLeverage \?\? s\.exposureIntraday \?\? 1\}/g, 'value={numInputValue(s.quantityModeSettings?.intradayLeverage ?? s.exposureIntraday)}'],
  [/value=\{s\.quantityModeSettings\?\.carryForwardLeverage \?\? s\.exposureCarryForward \?\? 1\}/g, 'value={numInputValue(s.quantityModeSettings?.carryForwardLeverage ?? s.exposureCarryForward)}'],
  [/value=\{s\.quantityModeSettings\?\.maxQuantity \?\? 1000\}/g, 'value={numInputValue(s.quantityModeSettings?.maxQuantity)}'],
  [/value=\{s\.quantityModeSettings\?\.minQuantity \?\? 1\}/g, 'value={numInputValue(s.quantityModeSettings?.minQuantity)}'],
  [/value=\{s\.quantityModeSettings\?\.breakupQuantity \?\? 0\}/g, 'value={numInputValue(s.quantityModeSettings?.breakupQuantity)}'],
  [/value=\{s\.minExchangeQty \?\? 0\}/g, 'value={numInputValue(s.minExchangeQty)}'],
  [/value=\{s\.maxExchangeQty \?\? 0\}/g, 'value={numInputValue(s.maxExchangeQty)}'],
  [/value=\{s\.quantityModeSettings\?\.notificationPercent \?\? 70\}/g, 'value={numInputValue(s.quantityModeSettings?.notificationPercent)}'],
  [/value=\{s\.quantityModeSettings\?\.autosquarePercent \?\? 90\}/g, 'value={numInputValue(s.quantityModeSettings?.autosquarePercent)}'],
  [/value=\{segmentPermissions\[segment\]\?\.lotSettings\?\.intradayLeverage \?\? 1\}/g, 'value={numInputValue(segmentPermissions[segment]?.lotSettings?.intradayLeverage)}'],
  [/value=\{segmentPermissions\[segment\]\?\.lotSettings\?\.carryForwardLeverage \?\? 1\}/g, 'value={numInputValue(segmentPermissions[segment]?.lotSettings?.carryForwardLeverage)}'],
  [/value=\{segmentPermissions\[segment\]\?\.lotSettings\?\.maxLots \?\? 50\}/g, 'value={numInputValue(segmentPermissions[segment]?.lotSettings?.maxLots)}'],
  [/value=\{segmentPermissions\[segment\]\?\.lotSettings\?\.minLots \?\? 1\}/g, 'value={numInputValue(segmentPermissions[segment]?.lotSettings?.minLots)}'],
  [/value=\{segmentPermissions\[segment\]\?\.quantityModeSettings\?\.intradayLeverage \?\? 1\}/g, 'value={numInputValue(segmentPermissions[segment]?.quantityModeSettings?.intradayLeverage)}'],
  [/value=\{segmentPermissions\[segment\]\?\.quantityModeSettings\?\.carryForwardLeverage \?\? 1\}/g, 'value={numInputValue(segmentPermissions[segment]?.quantityModeSettings?.carryForwardLeverage)}'],
  [/value=\{segmentPermissions\[segment\]\?\.quantityModeSettings\?\.maxQuantity \?\? 1000\}/g, 'value={numInputValue(segmentPermissions[segment]?.quantityModeSettings?.maxQuantity)}'],
  [/value=\{segmentPermissions\[segment\]\?\.quantityModeSettings\?\.minQuantity \?\? 1\}/g, 'value={numInputValue(segmentPermissions[segment]?.quantityModeSettings?.minQuantity)}'],
  [/value=\{segmentPermissions\[segment\]\?\.intradayLeverage \?\? 1\}/g, 'value={numInputValue(segmentPermissions[segment]?.intradayLeverage)}'],
  [/value=\{segmentPermissions\[segment\]\?\.carryForwardLeverage \?\? 1\}/g, 'value={numInputValue(segmentPermissions[segment]?.carryForwardLeverage)}'],
  [/value=\{segmentPermissions\[segment\]\?\.exposureIntraday \?\? 1\}/g, 'value={numInputValue(segmentPermissions[segment]?.exposureIntraday)}'],
  [/value=\{segmentPermissions\[segment\]\?\.exposureCarryForward \?\? 1\}/g, 'value={numInputValue(segmentPermissions[segment]?.exposureCarryForward)}'],
];
for (const [re, rep] of valueReplacements) c = c.replace(re, rep);

const handlerFns = path.includes('UserSegmentSettingsModal')
  ? ['handleNestedChange']
  : ['handleSegDefChange', 'handleAdminSegDefChange', 'handleEditSegmentPermissionChange'];

for (const fn of handlerFns) {
  c = c.replace(
    new RegExp(
      `onChange=\\{\\(e\\) => \\{\\s*const val = parseFloat\\(e\\.target\\.value\\);\\s*${fn}\\(([^,]+), '([^']+)', isNaN\\(val\\) \\? \\d+ : val\\);\\s*\\}\\}`,
      'g'
    ),
    (m, arg1, field) => `onChange={(e) => ${fn}(${arg1}, '${field}', parseNumInput(e.target.value))}`
  );
  c = c.replace(
    new RegExp(
      `onChange=\\{\\(e\\) => \\{\\s*const val = parseInt\\(e\\.target\\.value, 10\\);\\s*${fn}\\(([^,]+), '([^']+)', isNaN\\(val\\) \\? \\d+ : val\\);\\s*\\}\\}`,
      'g'
    ),
    (m, arg1, field) => `onChange={(e) => ${fn}(${arg1}, '${field}', parseIntInput(e.target.value))}`
  );
  // UserSegmentSettingsModal nested: handleNestedChange(segment, 'lotSettings', 'intradayLeverage', ...)
  c = c.replace(
    new RegExp(
      `onChange=\\{\\(e\\) => \\{\\s*const val = parseFloat\\(e\\.target\\.value\\);\\s*${fn}\\(([^,]+), '([^']+)', '([^']+)', isNaN\\(val\\) \\? \\d+ : val\\);\\s*\\}\\}`,
      'g'
    ),
    (m, arg1, parent, child) => `onChange={(e) => ${fn}(${arg1}, '${parent}', '${child}', parseNumInput(e.target.value))}`
  );
  c = c.replace(
    new RegExp(
      `onChange=\\{\\(e\\) => \\{\\s*const val = parseInt\\(e\\.target\\.value, 10\\);\\s*${fn}\\(([^,]+), '([^']+)', '([^']+)', isNaN\\(val\\) \\? \\d+ : val\\);\\s*\\}\\}`,
      'g'
    ),
    (m, arg1, parent, child) => `onChange={(e) => ${fn}(${arg1}, '${parent}', '${child}', parseIntInput(e.target.value))}`
  );
}

if (path.includes('AdminDashboard')) {
  c = c.replace(/const defaultSegmentSettings = \{[\s\S]*?optionSell: \{[^}]+\}\s*\};/g, 'const defaultSegmentSettings = { enabled: false };');
}

fs.writeFileSync(path, c);
console.log('Patched', path);
