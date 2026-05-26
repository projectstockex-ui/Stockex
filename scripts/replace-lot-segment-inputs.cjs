const fs = require('fs');
const p = 'd:/stockex/client/src/pages/AdminDashboard.jsx';
let c = fs.readFileSync(p, 'utf8');

if (!c.includes('SegmentNumberInput')) {
  c = c.replace(
    "import { numInputValue, parseNumInput, parseIntInput, parseNonNegativeNumInput, patchSegmentField } from '../utils/segmentFormValues.js';",
    "import { numInputValue, parseNumInput, parseIntInput, parseNonNegativeNumInput, patchSegmentField } from '../utils/segmentFormValues.js';\nimport SegmentNumberInput from '../components/admin/segment/SegmentNumberInput.jsx';"
  );
  if (!c.includes('SegmentNumberInput')) {
    c = c.replace(
      "import { numInputValue, parseNumInput, parseIntInput, parseNonNegativeNumInput } from '../utils/segmentFormValues.js';",
      "import { numInputValue, parseNumInput, parseIntInput, parseNonNegativeNumInput, patchSegmentField } from '../utils/segmentFormValues.js';\nimport SegmentNumberInput from '../components/admin/segment/SegmentNumberInput.jsx';"
    );
  }
}

const pairs = [
  ['lotSettings.intradayLeverage', 's.lotSettings?.intradayLeverage'],
  ['lotSettings.carryForwardLeverage', 's.lotSettings?.carryForwardLeverage'],
  ['quantityModeSettings.intradayLeverage', 's.quantityModeSettings?.intradayLeverage'],
  ['quantityModeSettings.carryForwardLeverage', 's.quantityModeSettings?.carryForwardLeverage'],
];

for (const [field, valuePath] of pairs) {
  const handlers = [
    `handleSegDefChange(expandedSeg, '${field}', parseNumInput(e.target.value))`,
    `handleAdminSegDefChange(adminDefExpandedSeg, '${field}', parseNumInput(e.target.value))`,
    `handleEditSegmentPermissionChange(segmentKey, '${field}', parseNumInput(e.target.value))`,
  ];
  for (const h of handlers) {
    const vHandler = h.replace('parseNumInput(e.target.value)', 'v');
    const old1 = `<input
                                type="number"
                                min="0"
                                step="0.1"
                                value={numInputValue(${valuePath})}
                                onChange={(e) => ${h}}
                                className="w-full bg-dark-700 border border-dark-600 rounded px-3 py-2 text-sm"
                              />`;
    const new1 = `<SegmentNumberInput
                                value={${valuePath}}
                                onChange={(v) => ${vHandler}}
                                className="w-full bg-dark-700 border border-dark-600 rounded px-3 py-2 text-sm"
                              />`;
    c = c.split(old1).join(new1);

    const old2 = `<input
                              type="number"
                              min="0"
                              step="0.1"
                              value={numInputValue(${valuePath})}
                              onChange={(e) => ${h}}
                              disabled={!showAdminDefLotSettingsButton}
                              className={\`w-full border rounded px-3 py-2 text-sm \${showAdminDefLotSettingsButton ? 'bg-dark-700 border-dark-600' : 'bg-dark-800 border-dark-700 opacity-50'}\`}
                            />`;
    const new2 = `<SegmentNumberInput
                              value={${valuePath}}
                              onChange={(v) => ${vHandler}}
                              className={\`w-full border rounded px-3 py-2 text-sm \${showAdminDefLotSettingsButton ? 'bg-dark-700 border-dark-600' : 'bg-dark-800 border-dark-700 opacity-50'}\`}
                            />`;
    c = c.split(old2).join(new2);

    const old3 = `<input
                            type="number"
                            min="0"
                            step="0.1"
                            value={numInputValue(${valuePath})}
                            onChange={(e) => ${h}}
                            className="w-full bg-dark-700 border border-dark-600 rounded px-3 py-2 text-sm"
                          />`;
    const new3 = `<SegmentNumberInput
                            value={${valuePath}}
                            onChange={(v) => ${vHandler}}
                            className="w-full bg-dark-700 border border-dark-600 rounded px-3 py-2 text-sm"
                          />`;
    c = c.split(old3).join(new3);
  }
}

fs.writeFileSync(p, c);
console.log('SegmentNumberInput count:', (c.match(/SegmentNumberInput/g) || []).length);
