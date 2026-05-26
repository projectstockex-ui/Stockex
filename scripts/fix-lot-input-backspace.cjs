const fs = require('fs');
const path = 'd:/stockex/client/src/pages/AdminDashboard.jsx';
let c = fs.readFileSync(path, 'utf8');

if (!c.includes('SegmentNumberInput')) {
  c = c.replace(
    "import { numInputValue, parseNumInput, parseIntInput, parseNonNegativeNumInput } from '../utils/segmentFormValues.js';",
    "import { numInputValue, parseNumInput, parseIntInput, parseNonNegativeNumInput, patchSegmentField } from '../utils/segmentFormValues.js';\nimport SegmentNumberInput from '../components/admin/segment/SegmentNumberInput.jsx';"
  );
}

c = c.replace(
  /numInputValue\(s\.lotSettings\?\.intradayLeverage \?\? s\.exposureIntraday\)/g,
  '/*LOT_INTRA*/'
);
c = c.replace(
  /numInputValue\(s\.lotSettings\?\.carryForwardLeverage \?\? s\.exposureCarryForward\)/g,
  '/*LOT_CF*/'
);
c = c.replace(
  /numInputValue\(s\.quantityModeSettings\?\.intradayLeverage \?\? s\.exposureIntraday\)/g,
  '/*QTY_INTRA*/'
);
c = c.replace(
  /numInputValue\(s\.quantityModeSettings\?\.carryForwardLeverage \?\? s\.exposureCarryForward\)/g,
  '/*QTY_CF*/'
);

// Replace lot intraday input blocks (type=number pattern)
const lotIntraBlock = `<SegmentNumberInput
                                value={s.lotSettings?.intradayLeverage}
                                onChange={(v) => LOT_HANDLER_PLACEHOLDER}
                                className="w-full bg-dark-700 border border-dark-600 rounded px-3 py-2 text-sm"
                              />`;

const patterns = [
  {
    old: /                              <input\s+type="number"\s+min="0"\s+step="0\.1"\s+value=\{\/\*LOT_INTRA\*\/\}\s+onChange=\{\(e\) => ([^}]+)\}\s+className="w-full bg-dark-700 border border-dark-600 rounded px-3 py-2 text-sm"\s+\/>/g,
    handler: '$1',
    field: 'lotSettings?.intradayLeverage',
  },
];

// Simpler: restore markers to numInputValue without fallback
c = c.replace(/\/\*LOT_INTRA\*\//g, 'numInputValue(s.lotSettings?.intradayLeverage)');
c = c.replace(/\/\*LOT_CF\*\//g, 'numInputValue(s.lotSettings?.carryForwardLeverage)');
c = c.replace(/\/\*QTY_INTRA\*\//g, 'numInputValue(s.quantityModeSettings?.intradayLeverage)');
c = c.replace(/\/\*QTY_CF\*\//g, 'numInputValue(s.quantityModeSettings?.carryForwardLeverage)');

// patch setSegDefs nested assign
c = c.replace(
  /setSegDefs\(prev => \{\s+const segData = \{ \.\.\.prev\[seg\] \};\s+if \(field\.includes\('\.'\)\) \{\s+\/\/ Handle nested paths[^\n]*\n\s+const \[parent, child\] = field\.split\('\.'\);\s+segData\[parent\] = \{ \.\.\.segData\[parent\], \[child\]: value \};\s+\} else \{\s+segData\[field\] = value;\s+\}\s+return \{ \.\.\.prev, \[seg\]: segData \};\s+\}\);/g,
  "setSegDefs((prev) => ({\n      ...prev,\n      [seg]: patchSegmentField(prev[seg] || {}, field, value),\n    }));"
);

// handleAdminSegDefChange similar
c = c.replace(
  /setAdminSegDefs\(\(prev\) => \{\s+const segData = \{ \.\.\.\(prev\[seg\] \|\| \{\}\) \};\s+if \(field\.includes\('\.'\)\) \{\s+const \[parent, child\] = field\.split\('\.'\);\s+segData\[parent\] = \{ \.\.\.\(segData\[parent\] \|\| \{\}\), \[child\]: value \};\s+\} else \{\s+segData\[field\] = value;\s+\}\s+return \{ \.\.\.prev, \[seg\]: segData \};\s+\}\);/g,
  "setAdminSegDefs((prev) => ({\n      ...prev,\n      [seg]: patchSegmentField(prev[seg] || {}, field, value),\n    }));"
);

fs.writeFileSync(path, c);
console.log('AdminDashboard lot input fallbacks removed');
